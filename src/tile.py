"""Slice large aerial frames into overlapping tiles, remapping YOLO labels.

WHY THIS EXISTS -- the single most important file in the repo.

A 2304x1296 frame fed to YOLO at imgsz=640 is downscaled ~3.6x. A person who
was 20 px tall becomes 5.5 px. The network's stride-8 detection head sees
them as less than one feature cell. They are gone before training starts.
No amount of epochs, augmentation, or model size recovers information that
was destroyed by the resize.

Tiling fixes this: cut the frame into 640x640 patches, feed each at native
resolution. The 20 px person stays 20 px. Relative to the network input they
are now 3.6x larger.

THE MATCHING RULE: whatever tile size and overlap you train with, you must
slice with the same scale at inference (see infer.py). Train on 640 tiles and
then run full-frame inference and your recall collapses -- not because the
model is bad, but because you changed the apparent object scale between
train and test. This is the most common way people get aerial detection wrong.

Boxes straddling a tile edge are clipped. If clipping destroys more than
`min_visibility` of the original box, the remnant is dropped -- a 15%-visible
sliver of a human is not a learnable person, it is label noise. The overlap
between tiles guarantees that any object smaller than the overlap appears
whole in at least one tile, so nothing is truly lost.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def tile_positions(total: int, tile: int, overlap: float) -> list[int]:
    """Start offsets covering [0, total) with tiles of size `tile`.

    The last tile is snapped flush to the edge rather than padded, so we never
    train on synthetic black borders that do not occur at inference.
    """
    if total <= tile:
        return [0]
    step = max(1, int(tile * (1 - overlap)))
    pos = list(range(0, total - tile + 1, step))
    if pos[-1] != total - tile:
        pos.append(total - tile)
    return pos


def tile_image(
    img: np.ndarray,
    boxes: np.ndarray,
    tile: int,
    overlap: float,
    min_visibility: float,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Yield (tile_image, tile_boxes_xyxy_abs) pairs.

    `boxes` is (N,4) absolute xyxy in the source frame.
    """
    h, w = img.shape[:2]
    out = []
    if boxes.size:
        areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    else:
        areas = np.zeros(0)

    for y0 in tile_positions(h, tile, overlap):
        for x0 in tile_positions(w, tile, overlap):
            x1, y1 = x0 + tile, y0 + tile
            crop = img[y0:y1, x0:x1]
            if boxes.size == 0:
                out.append((crop, np.zeros((0, 4), np.float32)))
                continue

            clipped = boxes.copy()
            clipped[:, [0, 2]] = clipped[:, [0, 2]].clip(x0, x1)
            clipped[:, [1, 3]] = clipped[:, [1, 3]].clip(y0, y1)
            cw = clipped[:, 2] - clipped[:, 0]
            ch = clipped[:, 3] - clipped[:, 1]
            keep = (cw > 1) & (ch > 1) & ((cw * ch) / np.maximum(areas, 1e-6) >= min_visibility)

            kept = clipped[keep]
            kept[:, [0, 2]] -= x0
            kept[:, [1, 3]] -= y0
            out.append((crop, kept.astype(np.float32)))
    return out


def run(
    src: Path,
    dst: Path,
    tile: int = 640,
    overlap: float = 0.2,
    min_visibility: float = 0.3,
    keep_empty_ratio: float = 0.08,
    seed: int = 0,
) -> dict:
    """Tile a YOLO-format dataset directory (`images/`, `labels/`).

    `keep_empty_ratio`: fraction of person-free tiles to retain. Tiling an
    aerial frame produces overwhelmingly empty tiles (a 2304x1296 frame gives
    ~10 tiles, maybe 2 with people). Keeping them all buries the positives and
    trains the model to predict nothing. Keeping *none* removes all background
    context and the model fires on every rock. ~8% is a workable middle.
    """
    img_dir, lbl_dir = src / "images", src / "labels"
    out_img, out_lbl = dst / "images", dst / "labels"
    out_img.mkdir(parents=True, exist_ok=True)
    out_lbl.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(seed)
    stats = {"src_images": 0, "tiles_written": 0, "tiles_empty_kept": 0,
             "tiles_empty_dropped": 0, "boxes_out": 0, "boxes_dropped_sliver": 0}
    sizes: list[float] = []

    paths = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    for img_path in tqdm(paths, desc=f"tile {src.name}"):
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]
        stats["src_images"] += 1

        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        boxes = []
        if lbl_path.exists():
            for line in lbl_path.read_text().splitlines():
                parts = line.split()
                if len(parts) != 5:
                    continue
                _, cx, cy, bw, bh = (float(v) for v in parts)
                boxes.append([(cx - bw / 2) * w, (cy - bh / 2) * h,
                              (cx + bw / 2) * w, (cy + bh / 2) * h])
        src_n = len(boxes)
        arr = np.array(boxes, np.float32) if boxes else np.zeros((0, 4), np.float32)

        placed = 0
        for i, (crop, tb) in enumerate(tile_image(img, arr, tile, overlap, min_visibility)):
            if len(tb) == 0:
                if rng.random() >= keep_empty_ratio:
                    stats["tiles_empty_dropped"] += 1
                    continue
                stats["tiles_empty_kept"] += 1

            th, tw = crop.shape[:2]
            name = f"{img_path.stem}_t{i:03d}"
            cv2.imwrite(str(out_img / f"{name}.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
            lines = []
            for x0, y0, x1, y1 in tb:
                lines.append(
                    f"0 {(x0 + x1) / 2 / tw:.6f} {(y0 + y1) / 2 / th:.6f} "
                    f"{(x1 - x0) / tw:.6f} {(y1 - y0) / th:.6f}"
                )
                sizes.append(max(x1 - x0, y1 - y0))
            (out_lbl / f"{name}.txt").write_text("\n".join(lines))
            stats["tiles_written"] += 1
            stats["boxes_out"] += len(tb)
            placed += len(tb)

        # Overlap should mean every source box lands whole somewhere; a box can
        # legitimately appear in 2 tiles, so we only flag under-counting.
        if placed < src_n:
            stats["boxes_dropped_sliver"] += src_n - placed

    if sizes:
        a = np.array(sizes)
        stats["tile_box_px_median"] = round(float(np.median(a)), 1)
        stats["tile_box_px_p10"] = round(float(np.percentile(a, 10)), 1)
        stats["frac_under_32px"] = round(float((a < 32).mean()), 3)
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--dst", type=Path, required=True)
    ap.add_argument("--tile", type=int, default=640)
    ap.add_argument("--overlap", type=float, default=0.2)
    ap.add_argument("--min-visibility", type=float, default=0.3)
    ap.add_argument("--keep-empty-ratio", type=float, default=0.08)
    args = ap.parse_args()

    stats = run(args.src, args.dst, args.tile, args.overlap,
                args.min_visibility, args.keep_empty_ratio)
    print("\n--- tiling stats ---")
    for k, v in stats.items():
        print(f"  {k:24} {v}")
    print(f"\n  REMEMBER: infer.py must slice at tile={args.tile} overlap={args.overlap} to match.")


if __name__ == "__main__":
    main()
