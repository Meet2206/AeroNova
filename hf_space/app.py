"""Gradio demo Space: aerial person detection for disaster relief.

DESIGNED FOR FREE CPU HARDWARE (2 vCPU, 16 GB, no GPU).
The Siddh10 account is free tier -- no ZeroGPU, no GPU Space. That is a hard
constraint on this app, so it is built around CPU rather than fighting it:

  * Single image in, single image out. No video: a 30 s clip is ~750 frames
    and would blow the Gradio request timeout many times over.
  * Sliced inference is OFF by default and shows an explicit tile count and
    time estimate before you enable it. A 2304x1296 frame at 640/0.2 is
    ~10 tiles; on 2 vCPUs that is roughly 8-15 s. Acceptable for a demo,
    fatal if it were automatic.
  * The nano model is the default. The small model is offered but flagged.
  * Input images are capped at 2560 px on the long side.

WHAT THE JUDGES SHOULD SEE, and why each panel exists:
  1. Detections drawn with per-box pixel height -- makes the "these are 20 px
     targets" claim concrete and visible rather than asserted.
  2. A size histogram against the operating-regime buckets -- shows we know
     which regime we work in and which we do not.
  3. The geo-location panel -- turns a bounding box into the GPS coordinate
     the payload drop actually consumes. This is the part that connects CV to
     the mission, and it is what most SIH drone entries are missing.

Deploy:
    huggingface-cli login
    huggingface-cli repo create sih-drone-rescue --type space --space_sdk gradio
    git clone https://huggingface.co/spaces/Siddh10/sih-drone-rescue
    cp hf_space/* sih-drone-rescue/ && cd sih-drone-rescue
    git add -A && git commit -m "aerial person detection demo" && git push
"""

from __future__ import annotations

import os
import time

import cv2
import gradio as gr
import numpy as np

MODEL_REPO = os.environ.get("MODEL_REPO", "Siddh10/sih-aerial-person")
MAX_SIDE = 2560
_cache: dict[str, object] = {}


# --------------------------------------------------------------------------
# Model loading
# --------------------------------------------------------------------------

def get_model(which: str):
    """Load from the Hub, falling back to a stock COCO model.

    The fallback matters: before the Kaggle run finishes there is no fine-tuned
    checkpoint on the Hub, and a Space that 500s on load looks broken to a
    judge. Stock yolo11n detects `person` (COCO class 0) badly at altitude --
    which is itself an honest, useful baseline to show alongside the fine-tune.
    """
    if which in _cache:
        return _cache[which]
    from ultralytics import YOLO

    try:
        from huggingface_hub import hf_hub_download
        path = hf_hub_download(MODEL_REPO, filename="best.pt")
        model, tag = YOLO(path), "fine-tuned on aerial data"
    except Exception as e:  # noqa: BLE001 -- repo may not exist yet
        print(f"[model] Hub load failed ({e}); falling back to stock COCO weights")
        model, tag = YOLO(f"{which}.pt"), "STOCK COCO baseline (not fine-tuned)"
    _cache[which] = (model, tag)
    return model, tag


# --------------------------------------------------------------------------
# Geometry (mirrors src/gsd.py and src/infer.py -- kept inline so the Space
# is self-contained and does not need the training repo installed)
# --------------------------------------------------------------------------

def gsd_cm_per_px(hfov_deg: float, width: int, alt_m: float, slant_deg: float) -> float:
    slant_range = alt_m / np.cos(np.radians(slant_deg))
    ifov = 2 * np.tan(np.radians(hfov_deg) / 2) / width
    return ifov * slant_range * 100


def tile_positions(total: int, tile: int, overlap: float) -> list[int]:
    if total <= tile:
        return [0]
    step = max(1, int(tile * (1 - overlap)))
    pos = list(range(0, total - tile + 1, step))
    if pos[-1] != total - tile:
        pos.append(total - tile)
    return pos


def nms(boxes: np.ndarray, scores: np.ndarray, thr: float = 0.5):
    if len(boxes) == 0:
        return boxes, scores
    idx = np.argsort(-scores)
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    keep = []
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
        idx = rest[inter / np.maximum(areas[i] + areas[rest] - inter, 1e-9) < thr]
    k = np.array(keep)
    return boxes[k], scores[k]


def pixel_to_ground(u, v, hfov_deg, w, h, lat, lon, alt, pitch, yaw):
    """See src/infer.py for the full derivation and the unit tests that pin
    the sign conventions. pitch = -90 is nadir."""
    fx = w / (2 * np.tan(np.radians(hfov_deg) / 2))
    ray = np.array([(u - w / 2) / fx, (v - h / 2) / fx, 1.0])
    ray /= np.linalg.norm(ray)
    m0 = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]], float)
    th = np.radians(-pitch)
    ct, st = np.cos(th), np.sin(th)
    d = np.array([[ct, 0, -st], [0, 1, 0], [st, 0, ct]]) @ m0 @ ray
    y = np.radians(yaw)
    north = d[0] * np.cos(y) - d[1] * np.sin(y)
    east = d[0] * np.sin(y) + d[1] * np.cos(y)
    if d[2] <= 1e-6:
        return None
    t = alt / d[2]
    R = 6378137.0
    return (lat + np.degrees(north * t / R),
            lon + np.degrees(east * t / (R * np.cos(np.radians(lat)))))


# --------------------------------------------------------------------------
# Main inference
# --------------------------------------------------------------------------

def detect(image, model_name, conf, use_slicing, tile, overlap,
           hfov, alt, pitch, yaw, lat, lon):
    if image is None:
        return None, "Upload an aerial image first.", None

    img = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        s = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)))
        h, w = img.shape[:2]

    model, tag = get_model(model_name)
    t0 = time.time()

    if use_slicing:
        xs, ys = tile_positions(w, tile, overlap), tile_positions(h, tile, overlap)
        boxes_all, scores_all = [], []
        for y0 in ys:
            for x0 in xs:
                r = model.predict(img[y0:y0 + tile, x0:x0 + tile], conf=conf,
                                  verbose=False, classes=[0])[0]
                if not len(r.boxes):
                    continue
                b = r.boxes.xyxy.cpu().numpy().copy()
                b[:, [0, 2]] += x0
                b[:, [1, 3]] += y0
                boxes_all.append(b)
                scores_all.append(r.boxes.conf.cpu().numpy())
        if boxes_all:
            boxes, scores = nms(np.concatenate(boxes_all), np.concatenate(scores_all))
        else:
            boxes, scores = np.zeros((0, 4)), np.zeros(0)
        mode = f"sliced ({len(xs) * len(ys)} tiles)"
    else:
        r = model.predict(img, conf=conf, verbose=False, classes=[0])[0]
        boxes = r.boxes.xyxy.cpu().numpy() if len(r.boxes) else np.zeros((0, 4))
        scores = r.boxes.conf.cpu().numpy() if len(r.boxes) else np.zeros(0)
        mode = "full-frame"

    dt = time.time() - t0
    gsd = gsd_cm_per_px(hfov, w, alt, abs(90 + pitch))

    vis = img.copy()
    rows, heights = [], []
    for i, ((x0, y0, x1, y1), sc) in enumerate(zip(boxes, scores)):
        px = max(y1 - y0, x1 - x0)
        heights.append(px)
        cv2.rectangle(vis, (int(x0), int(y0)), (int(x1), int(y1)), (0, 0, 255), 2)
        cv2.putText(vis, f"{px:.0f}px {sc:.2f}", (int(x0), max(12, int(y0) - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
        g = pixel_to_ground((x0 + x1) / 2, y1, hfov, w, h, lat, lon, alt, pitch, yaw)
        rows.append([i + 1, f"{sc:.2f}", f"{px:.0f}",
                     f"{px * gsd / 100:.2f}",
                     f"{g[0]:.6f}" if g else "-", f"{g[1]:.6f}" if g else "-"])

    hist = ""
    if heights:
        a = np.array(heights)
        for name, lo, hi in [("<16px  (~100m nadir)", 0, 16), ("16-32px (~100m slant)", 16, 32),
                             ("32-64px (~50m slant)", 32, 64), (">=64px  (<30m)", 64, 1e9)]:
            n = int(((a >= lo) & (a < hi)).sum())
            hist += f"  {name:24} {'#' * min(n, 40)} {n}\n"

    summary = f"""### {len(boxes)} person(s) detected

**Model:** {tag}
**Mode:** {mode} · {dt:.1f}s on free CPU
**Image:** {w}x{h} · **GSD:** {gsd:.2f} cm/px at {alt:.0f} m, {abs(90+pitch):.0f}° off nadir

**Target size distribution** (this is the number that matters):
```
{hist or '  (none)'}
```
A 1.7 m human at this altitude and angle should be about
**{170 / gsd:.0f} px** tall. If detections are far from that, your telemetry
inputs and the image do not match.
"""
    if use_slicing is False and len(boxes) == 0:
        summary += "\n> No detections full-frame. Try **sliced inference** — small targets often only appear when tiled."

    return cv2.cvtColor(vis, cv2.COLOR_BGR2RGB), summary, rows


CSS = ".gradio-container{max-width:1200px!important}"

with gr.Blocks(title="Drone SAR — Aerial Person Detection", css=CSS) as demo:
    gr.Markdown("""
# Aerial Person Detection for Disaster Relief
### SIH — automatic alarm generation and payload dropping

Detects humans in drone imagery at the pixel scales produced by **50–100 m
altitude**, and converts each detection into the **GPS coordinate** a payload
drop needs.

**The core problem:** a 1.7 m person at 100 m is 9–34 px depending on camera
angle. Standard detection training downscales that to nothing. This model is
trained on **tiles** at native resolution so the target survives.

> Running on free CPU hardware. Sliced inference takes ~10 s — it is off by
> default and worth turning on for small targets.
""")

    with gr.Row():
        with gr.Column(scale=3):
            img_in = gr.Image(type="pil", label="Aerial / drone image")
            with gr.Row():
                model_name = gr.Dropdown(["yolo11n", "yolo11s"], value="yolo11n",
                                         label="Model (n = faster on CPU)")
                conf = gr.Slider(0.05, 0.9, 0.15, step=0.01,
                                 label="Confidence (low by design — recall first)")
            with gr.Accordion("Sliced inference (SAHI-style)", open=True):
                gr.Markdown("Tiles the image so small targets stay full-size. "
                            "**~10 s on free CPU.** Must match the training tile size.")
                use_slicing = gr.Checkbox(False, label="Enable slicing")
                with gr.Row():
                    tile = gr.Slider(320, 1024, 640, step=64, label="Tile size")
                    overlap = gr.Slider(0.0, 0.5, 0.2, step=0.05, label="Overlap")
            with gr.Accordion("Drone telemetry (drives the GPS output)", open=False):
                gr.Markdown("In flight these come from MAVLink. Set them to match "
                            "the image or the coordinates will be confidently wrong.")
                with gr.Row():
                    hfov = gr.Number(66.0, label="Camera HFOV (deg)")
                    alt = gr.Number(80.0, label="Altitude AGL (m)")
                with gr.Row():
                    pitch = gr.Number(-45.0, label="Gimbal pitch (-90 = nadir)")
                    yaw = gr.Number(0.0, label="Heading (0 = North)")
                with gr.Row():
                    lat = gr.Number(23.022500, label="Drone latitude")
                    lon = gr.Number(72.571400, label="Drone longitude")
            btn = gr.Button("Detect", variant="primary")

        with gr.Column(scale=4):
            img_out = gr.Image(label="Detections (labelled with pixel height)")
            summary = gr.Markdown()
            table = gr.Dataframe(
                headers=["#", "conf", "px", "est. height (m)", "latitude", "longitude"],
                label="Targets — feed these coordinates to the payload drop",
                wrap=True,
            )

    btn.click(detect,
              [img_in, model_name, conf, use_slicing, tile, overlap,
               hfov, alt, pitch, yaw, lat, lon],
              [img_out, summary, table])

    gr.Markdown("""
---
**Honest limitations** — stated because judges ask, and because they are real:

* Trained on **VisDrone**, which is urban drone footage, not disaster footage.
  There is a domain gap to flood and earthquake scenes. Fine-tuning on our own
  captured footage is the fix and is the highest-value remaining work.
* Below ~16 px (100 m looking straight down) recall is genuinely poor. That is
  **optics, not model quality** — the answer is a longer lens, lower altitude,
  or a thermal camera, not more epochs.
* Geo-location assumes **locally flat terrain**. Accurate over flooded plains,
  degrades in hills.
* Payload release should happen after descending to 10–15 m, not from 100 m —
  wind drift at altitude is larger than the accuracy of any detection.
""")

if __name__ == "__main__":
    demo.launch()
