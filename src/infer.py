"""Sliced inference, temporal confirmation, and pixel->ground geo-location.

Three things live here, in the order the drone uses them:

  1. sliced_predict()  -- SAHI-style tiled inference. MUST use the same tile
     size and overlap as training (src/tile.py), or the apparent object scale
     shifts between train and test and recall collapses. This is the single
     most common failure mode in aerial detection projects.

  2. TemporalConfirmer -- the false-alarm killer. Rather than raising the
     confidence threshold (which throws away real detections at the pixel
     sizes we care about), we run at LOW confidence for high recall and
     require a detection to persist across N consecutive frames in a
     consistent ground location before declaring a target. A rock does not
     move, but neither does its projected ground position -- so we cluster in
     GROUND coordinates, not image coordinates, which survives the camera
     moving. Random noise fails to reproduce; a real human does not.

  3. pixel_to_ground() -- converts a detection's image position into a GPS
     coordinate using drone lat/lon/altitude and gimbal pitch/yaw/roll. This
     is what the payload-drop and the ground station both consume. It assumes
     locally flat terrain, which is fine over 100-200 m and wrong in
     mountains -- documented, not hidden.

The two-stage architecture (why it is built this way):
  Sliced inference multiplies cost by tile count -- ~10x on a 2304x1296 frame.
  That is fatal on a Raspberry Pi. So: run the NANO model full-frame at low
  FPS as a continuous cheap scan; when it fires even weakly, run the SLICED
  high-recall pass on that keyframe. You get Pi-viable continuous operation
  with tiled accuracy exactly when it matters.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
EARTH_R = 6378137.0


# --------------------------------------------------------------------------
# 1. Sliced inference
# --------------------------------------------------------------------------

def nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float = 0.5):
    """Plain greedy NMS. Merging tiles produces duplicates in overlap strips."""
    if len(boxes) == 0:
        return np.zeros((0, 4), np.float32), np.zeros(0, np.float32)
    idx = np.argsort(-scores)
    keep = []
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    while len(idx):
        i = idx[0]
        keep.append(i)
        if len(idx) == 1:
            break
        rest = idx[1:]
        lt = np.maximum(boxes[i, :2], boxes[rest, :2])
        rb = np.minimum(boxes[i, 2:], boxes[rest, 2:])
        wh = (rb - lt).clip(min=0)
        inter = wh[:, 0] * wh[:, 1]
        iou = inter / np.maximum(areas[i] + areas[rest] - inter, 1e-9)
        idx = rest[iou < iou_thr]
    keep = np.array(keep)
    return boxes[keep], scores[keep]


def sliced_predict(model, img: np.ndarray, tile: int = 640, overlap: float = 0.2,
                   conf: float = 0.15, device=None, batch: int = 4):
    """Tile the frame, run the model on each tile, merge back to frame coords."""
    from src.tile import tile_positions

    h, w = img.shape[:2]
    crops, offsets = [], []
    for y0 in tile_positions(h, tile, overlap):
        for x0 in tile_positions(w, tile, overlap):
            crops.append(img[y0:y0 + tile, x0:x0 + tile])
            offsets.append((x0, y0))

    boxes_all, scores_all = [], []
    for i in range(0, len(crops), batch):
        chunk = crops[i:i + batch]
        results = model.predict(chunk, conf=conf, verbose=False, device=device)
        for r, (x0, y0) in zip(results, offsets[i:i + batch]):
            if not len(r.boxes):
                continue
            b = r.boxes.xyxy.cpu().numpy().copy()
            b[:, [0, 2]] += x0
            b[:, [1, 3]] += y0
            boxes_all.append(b)
            scores_all.append(r.boxes.conf.cpu().numpy())

    if not boxes_all:
        return np.zeros((0, 4), np.float32), np.zeros(0, np.float32)
    return nms(np.concatenate(boxes_all), np.concatenate(scores_all))


# --------------------------------------------------------------------------
# 2. Pixel -> ground GPS
# --------------------------------------------------------------------------

@dataclass
class CameraModel:
    """Pinhole camera + gimbal pose. Angles in degrees."""
    hfov_deg: float
    width: int
    height: int

    @property
    def fx(self) -> float:
        return self.width / (2 * math.tan(math.radians(self.hfov_deg) / 2))

    @property
    def fy(self) -> float:
        return self.fx  # square pixels


def pixel_to_ground(
    u: float, v: float, cam: CameraModel,
    drone_lat: float, drone_lon: float, alt_agl_m: float,
    gimbal_pitch_deg: float, yaw_deg: float, roll_deg: float = 0.0,
) -> tuple[float, float, float] | None:
    """Project image point (u,v) onto flat ground. Returns (lat, lon, slant_range_m).

    gimbal_pitch_deg: 0 = horizon, -90 = straight down (nadir). This matches
        MAVLink / DJI gimbal conventions -- do not pass a positive number for
        a downward-looking camera.
    yaw_deg: drone heading, 0 = North, clockwise positive.
    alt_agl_m: height ABOVE GROUND, not above sea level. Use a rangefinder or
        barometer-minus-takeoff-elevation. Using AMSL here is a classic bug
        that puts the payload hundreds of metres off target in hilly terrain.

    Returns None if the ray points at or above the horizon (no ground
    intersection) -- the caller must handle this rather than dropping a
    payload into the sky.

    ASSUMPTION: locally flat ground. Error grows with terrain relief; over a
    200 m footprint on flat/flooded terrain this is well under a metre, in
    mountains it can be tens of metres. Documented, not hidden.
    """
    # Ray in camera frame: x = right in image, y = down in image, z = forward
    # along the optical axis.
    x = (u - cam.width / 2) / cam.fx
    y = (v - cam.height / 2) / cam.fy
    ray = np.array([x, y, 1.0])
    ray /= np.linalg.norm(ray)

    # Gimbal roll spins the image about the optical axis, so it acts in the
    # camera frame, before any reorientation.
    cr, sr = math.cos(math.radians(roll_deg)), math.sin(math.radians(roll_deg))
    ray = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]]) @ ray

    # Camera axes -> NED body axes for a LEVEL camera (pitch = 0):
    #   optical axis (z) -> North,  image-right (x) -> East,  image-down (y) -> Down
    m0 = np.array([[0, 0, 1],
                   [1, 0, 0],
                   [0, 1, 0]], float)

    # Then pitch the camera down by theta about the East axis.
    # theta = 0 -> level; theta = 90 (gimbal_pitch = -90) -> nadir, which must
    # send the optical axis to Down and image-down to South.
    th = math.radians(-gimbal_pitch_deg)
    ct, st = math.cos(th), math.sin(th)
    r_pitch = np.array([[ct, 0, -st],
                        [0,  1,   0],
                        [st, 0,  ct]])

    d = r_pitch @ m0 @ ray  # (north, east, down) in the drone's own heading frame

    # Heading frame -> world: rotate by yaw about the Down axis.
    yaw = math.radians(yaw_deg)
    north = d[0] * math.cos(yaw) - d[1] * math.sin(yaw)
    east = d[0] * math.sin(yaw) + d[1] * math.cos(yaw)
    down = d[2]

    if down <= 1e-6:
        return None  # ray at or above horizon

    t = alt_agl_m / down          # scale to reach the ground plane
    dn, de = north * t, east * t  # metre offsets
    slant = float(np.linalg.norm([dn, de, alt_agl_m]))

    lat = drone_lat + math.degrees(dn / EARTH_R)
    lon = drone_lon + math.degrees(de / (EARTH_R * math.cos(math.radians(drone_lat))))
    return lat, lon, slant


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p = math.pi / 180
    a = (0.5 - math.cos((lat2 - lat1) * p) / 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2)
    return 2 * EARTH_R * math.asin(math.sqrt(a))


# --------------------------------------------------------------------------
# 3. Temporal confirmation
# --------------------------------------------------------------------------

@dataclass
class Track:
    lat: float
    lon: float
    hits: int = 1
    misses: int = 0
    best_conf: float = 0.0
    confirmed: bool = False
    history: list = field(default_factory=list)


class TemporalConfirmer:
    """Confirm targets by persistence in GROUND coordinates across frames.

    Clustering in ground space rather than image space is the point: the drone
    is moving, so a stationary human sweeps across the image, but their ground
    position is constant. Anything that fails to hold a consistent ground
    position across `min_hits` frames was noise.

    This lets you run detection at conf=0.15 (high recall, many false
    positives) and still report almost no false alarms -- which is strictly
    better than running at conf=0.5 and silently missing half the victims.
    """

    def __init__(self, assoc_radius_m: float = 8.0, min_hits: int = 3, max_misses: int = 5):
        self.assoc_radius_m = assoc_radius_m
        self.min_hits = min_hits
        self.max_misses = max_misses
        self.tracks: list[Track] = []

    def update(self, detections: list[tuple[float, float, float]]) -> list[Track]:
        """detections: list of (lat, lon, conf). Returns newly-confirmed tracks."""
        for t in self.tracks:
            t.misses += 1

        newly: list[Track] = []
        for lat, lon, conf in detections:
            best, best_d = None, self.assoc_radius_m
            for t in self.tracks:
                d = haversine_m(lat, lon, t.lat, t.lon)
                if d < best_d:
                    best, best_d = t, d
            if best is None:
                self.tracks.append(Track(lat, lon, best_conf=conf, history=[(lat, lon)]))
                continue
            # Running mean keeps the estimate stable as more sightings arrive.
            n = best.hits
            best.lat = (best.lat * n + lat) / (n + 1)
            best.lon = (best.lon * n + lon) / (n + 1)
            best.hits += 1
            best.misses = 0
            best.best_conf = max(best.best_conf, conf)
            best.history.append((lat, lon))
            if not best.confirmed and best.hits >= self.min_hits:
                best.confirmed = True
                newly.append(best)

        self.tracks = [t for t in self.tracks if t.misses <= self.max_misses or t.confirmed]
        return newly

    @property
    def confirmed(self) -> list[Track]:
        return [t for t in self.tracks if t.confirmed]


# --------------------------------------------------------------------------
# CLI: run over a video or image folder
# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", type=Path, required=True)
    ap.add_argument("--source", required=True, help="video file, image folder, or webcam index")
    ap.add_argument("--conf", type=float, default=0.15)
    ap.add_argument("--tile", type=int, default=640)
    ap.add_argument("--overlap", type=float, default=0.2)
    ap.add_argument("--full-frame", action="store_true", help="skip slicing (Pi scan mode)")
    ap.add_argument("--save", type=Path, default=ROOT / "runs" / "predict")
    # Telemetry -- in flight these come from MAVLink, here they are static so
    # the geo-location path can be demonstrated on recorded footage.
    ap.add_argument("--lat", type=float, default=None)
    ap.add_argument("--lon", type=float, default=None)
    ap.add_argument("--alt", type=float, default=80.0, help="AGL metres")
    ap.add_argument("--pitch", type=float, default=-45.0, help="gimbal, -90 = nadir")
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--hfov", type=float, default=66.0)
    args = ap.parse_args()

    import cv2
    import torch
    from ultralytics import YOLO

    device = 0 if torch.cuda.is_available() else "cpu"
    model = YOLO(str(args.weights))
    args.save.mkdir(parents=True, exist_ok=True)

    src = args.source
    cap = cv2.VideoCapture(int(src) if str(src).isdigit() else str(src))
    if not cap.isOpened():
        raise SystemExit(f"cannot open source: {src}")

    confirmer = TemporalConfirmer()
    cam = None
    frame_i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_i += 1
        h, w = frame.shape[:2]
        if cam is None:
            cam = CameraModel(args.hfov, w, h)

        if args.full_frame:
            r = model.predict(frame, conf=args.conf, verbose=False, device=device)[0]
            boxes = r.boxes.xyxy.cpu().numpy() if len(r.boxes) else np.zeros((0, 4), np.float32)
            scores = r.boxes.conf.cpu().numpy() if len(r.boxes) else np.zeros(0, np.float32)
        else:
            boxes, scores = sliced_predict(model, frame, args.tile, args.overlap, args.conf, device)

        dets = []
        for (x0, y0, x1, y1), sc in zip(boxes, scores):
            # Bottom-centre of the box is where the person meets the ground.
            u, v = (x0 + x1) / 2, y1
            if args.lat is not None:
                g = pixel_to_ground(u, v, cam, args.lat, args.lon, args.alt,
                                    args.pitch, args.yaw)
                if g:
                    dets.append((g[0], g[1], float(sc)))
            cv2.rectangle(frame, (int(x0), int(y0)), (int(x1), int(y1)), (0, 0, 255), 2)
            cv2.putText(frame, f"{sc:.2f}", (int(x0), int(y0) - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

        for t in confirmer.update(dets):
            print(f"[frame {frame_i}] CONFIRMED TARGET  lat={t.lat:.6f} lon={t.lon:.6f} "
                  f"conf={t.best_conf:.2f} hits={t.hits}  -> alarm + descend + release")

        cv2.putText(frame, f"det:{len(boxes)} confirmed:{len(confirmer.confirmed)}",
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imwrite(str(args.save / f"{frame_i:06d}.jpg"), frame)

    cap.release()
    print(f"\n{frame_i} frames. {len(confirmer.confirmed)} confirmed targets. -> {args.save}")


if __name__ == "__main__":
    main()
