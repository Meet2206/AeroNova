"""Convert VisDrone2019-DET annotations to a single-class YOLO `person` dataset.

VisDrone's annotation format has two traps that will silently poison training:

  1. Class 0 is `ignored-regions` -- large blobs marking crowds/areas the
     benchmark refuses to score. Training on them as objects is garbage; but
     naively dropping them is also wrong, because real unlabelled people live
     inside them and the model gets punished for finding them. We mask them
     out of the pixels instead.
  2. Column 7 is `occlusion` and column 6 is `truncation`. Heavily occluded
     boxes (occlusion==2, i.e. 50-100% hidden) are unlearnable at 20 px and
     mostly add label noise.

Annotation line format (VisDrone DET):
    x, y, w, h, score, category, truncation, occlusion

Categories: 0 ignored, 1 pedestrian, 2 people, 3 bicycle, 4 car, 5 van,
6 truck, 7 tricycle, 8 awning-tricycle, 9 bus, 10 motor, 11 others

`pedestrian` (walking/standing) and `people` (any other human pose) both
collapse to our single `person` class -- a rescue drone does not care whether
the victim is upright.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

PERSON_CATS = {1, 2}
IGNORE_CAT = 0
MIN_BOX_PX = 4  # boxes smaller than this are annotation noise, not targets


def convert_split(
    src: Path,
    dst: Path,
    max_occlusion: int = 1,
    mask_ignored: bool = True,
    drop_empty_ratio: float = 0.5,
) -> dict:
    """Convert one VisDrone split directory into YOLO layout.

    Args:
        src: dir containing `images/` and `annotations/`
        dst: output dir; gets `images/` and `labels/`
        max_occlusion: keep boxes with occlusion <= this (0=none, 1=partial, 2=heavy)
        mask_ignored: paint ignored-regions black so the model is not penalised
            for people it correctly finds inside an unlabelled crowd blob
        drop_empty_ratio: fraction of person-free images to discard. Some
            negatives are essential (they teach the model what is NOT a human,
            which is how you kill false alarms on rocks and bushes) but
            VisDrone is full of car-only frames that just waste epochs.
    """
    img_dir, ann_dir = src / "images", src / "annotations"
    if not img_dir.is_dir() or not ann_dir.is_dir():
        raise FileNotFoundError(f"expected {img_dir} and {ann_dir}")

    out_img, out_lbl = dst / "images", dst / "labels"
    out_img.mkdir(parents=True, exist_ok=True)
    out_lbl.mkdir(parents=True, exist_ok=True)

    stats = {"images": 0, "boxes": 0, "dropped_occluded": 0, "dropped_tiny": 0,
             "ignored_regions": 0, "empty_kept": 0, "empty_dropped": 0}
    rng = np.random.default_rng(0)
    sizes: list[float] = []

    for ann_path in tqdm(sorted(ann_dir.glob("*.txt")), desc=f"convert {src.name}"):
        img_path = img_dir / f"{ann_path.stem}.jpg"
        if not img_path.exists():
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]

        boxes, ignores = [], []
        for line in ann_path.read_text().splitlines():
            parts = [p for p in line.strip().replace(",", " ").split() if p]
            if len(parts) < 6:
                continue
            x, y, bw, bh = (int(float(v)) for v in parts[:4])
            cat = int(float(parts[5]))
            occ = int(float(parts[7])) if len(parts) > 7 else 0

            if cat == IGNORE_CAT:
                ignores.append((x, y, bw, bh))
                stats["ignored_regions"] += 1
                continue
            if cat not in PERSON_CATS:
                continue
            if occ > max_occlusion:
                stats["dropped_occluded"] += 1
                continue
            if bw < MIN_BOX_PX or bh < MIN_BOX_PX:
                stats["dropped_tiny"] += 1
                continue

            x, y = max(0, x), max(0, y)
            bw, bh = min(bw, w - x), min(bh, h - y)
            if bw <= 0 or bh <= 0:
                continue
            boxes.append((x, y, bw, bh))
            sizes.append(max(bw, bh))

        if not boxes:
            if rng.random() < drop_empty_ratio:
                stats["empty_dropped"] += 1
                continue
            stats["empty_kept"] += 1

        if mask_ignored and ignores:
            for x, y, bw, bh in ignores:
                # Only mask regions that do not swallow a labelled person.
                if any(_iou_xywh((x, y, bw, bh), b) > 0.05 for b in boxes):
                    continue
                img[max(0, y):y + bh, max(0, x):x + bw] = 0

        cv2.imwrite(str(out_img / f"{ann_path.stem}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        lines = [
            f"0 {(x + bw / 2) / w:.6f} {(y + bh / 2) / h:.6f} {bw / w:.6f} {bh / h:.6f}"
            for x, y, bw, bh in boxes
        ]
        (out_lbl / f"{ann_path.stem}.txt").write_text("\n".join(lines))
        stats["images"] += 1
        stats["boxes"] += len(boxes)

    if sizes:
        arr = np.array(sizes)
        stats["box_px_p10"] = round(float(np.percentile(arr, 10)), 1)
        stats["box_px_median"] = round(float(np.median(arr)), 1)
        stats["box_px_p90"] = round(float(np.percentile(arr, 90)), 1)
        stats["frac_under_32px"] = round(float((arr < 32).mean()), 3)
    return stats


def _iou_xywh(a: tuple, b: tuple) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True, help="VisDrone split dir (has images/ annotations/)")
    ap.add_argument("--dst", type=Path, required=True, help="output YOLO dir")
    ap.add_argument("--max-occlusion", type=int, default=1, choices=[0, 1, 2])
    ap.add_argument("--no-mask-ignored", action="store_true")
    ap.add_argument("--drop-empty-ratio", type=float, default=0.5)
    args = ap.parse_args()

    stats = convert_split(
        args.src, args.dst,
        max_occlusion=args.max_occlusion,
        mask_ignored=not args.no_mask_ignored,
        drop_empty_ratio=args.drop_empty_ratio,
    )
    print("\n--- conversion stats ---")
    for k, v in stats.items():
        print(f"  {k:22} {v}")
    if stats.get("frac_under_32px", 0) > 0.5:
        print("\n  >50% of persons are under 32 px. Tiled training is mandatory. Run src/tile.py next.")


if __name__ == "__main__":
    main()
