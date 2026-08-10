"""Size-bucketed, recall-first evaluation for aerial person detection.

WHY NOT JUST USE `model.val()`?

Because headline mAP50-95 will make a bad model look fine here, for two
reasons:

  1. AVERAGING HIDES THE FAILURE. A val set where most persons are 60 px and a
     few are 15 px produces a respectable mAP that is carried entirely by the
     easy boxes. But the 15 px boxes ARE the product -- they are what 100 m
     altitude looks like. This script reports AP and recall separately per
     pixel-size bucket so the number you optimise is the number that matters.

  2. IoU 0.5+ IS THE WRONG BAR FOR THIS MISSION. At 20 px, a 3-pixel offset
     drops IoU below 0.5 and the detection is scored as both a miss AND a
     false positive -- double-punished for being 3 px off on a target it
     genuinely found. But operationally that detection is a total success: the
     drone descends to 10-15 m and re-acquires before releasing. So we report
     recall at IoU 0.25 as the mission metric, alongside standard IoU 0.5.

  3. RECALL >> PRECISION. A false alarm costs a wasted flower. A missed
     detection is a person left in the water. We therefore pick the operating
     threshold for a recall target and report what precision that costs,
     rather than picking the F1-optimal point. False positives are suppressed
     downstream by temporal confirmation across frames (see infer.py), which
     is the right place to do it -- a rock does not move, but it also does not
     get re-confirmed with consistent geometry across a moving camera.

Outputs a table plus `eval_report.json` you can quote directly in the SIH
submission.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent.parent

# Buckets chosen from src/gsd.py output for a RPi Cam 3 at 50-100 m.
# Regenerate these for YOUR camera before quoting numbers.
SIZE_BUCKETS: list[tuple[str, float, float]] = [
    ("tiny   <16px  (~100m nadir)", 0, 16),
    ("small  16-32px (~100m slant / 50m nadir)", 16, 32),
    ("medium 32-64px (~50m slant)", 32, 64),
    ("large  >=64px  (<30m)", 64, 1e9),
]


def load_labels(lbl_path: Path, w: int, h: int) -> np.ndarray:
    """YOLO txt -> (N,4) absolute xyxy."""
    if not lbl_path.exists():
        return np.zeros((0, 4), np.float32)
    out = []
    for line in lbl_path.read_text(encoding="utf-8-sig").splitlines():
        p = line.split()
        if len(p) != 5:
            continue
        _, cx, cy, bw, bh = (float(v) for v in p)
        out.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
    return np.array(out, np.float32) if out else np.zeros((0, 4), np.float32)


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), np.float32)
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    wh = (rb - lt).clip(min=0)
    inter = wh[..., 0] * wh[..., 1]
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(aa[:, None] + ab[None, :] - inter, 1e-9)


def match(preds: np.ndarray, scores: np.ndarray, gts: np.ndarray, thr: float):
    """Greedy highest-score-first matching. Returns (tp_flags, matched_gt_idx)."""
    order = np.argsort(-scores)
    tp = np.zeros(len(preds), bool)
    gt_match = np.full(len(gts), -1)
    if len(gts) == 0 or len(preds) == 0:
        return tp, gt_match
    ious = iou_matrix(preds, gts)
    taken = np.zeros(len(gts), bool)
    for pi in order:
        cand = np.where((~taken) & (ious[pi] >= thr))[0]
        if len(cand):
            gi = cand[np.argmax(ious[pi][cand])]
            taken[gi] = True
            tp[pi] = True
            gt_match[gi] = pi
    return tp, gt_match


def average_precision(tp: np.ndarray, scores: np.ndarray, n_gt: int) -> float:
    """101-point interpolated AP, COCO style."""
    if n_gt == 0:
        return float("nan")
    if len(tp) == 0:
        return 0.0
    order = np.argsort(-scores)
    tp = tp[order]
    ctp = np.cumsum(tp)
    cfp = np.cumsum(~tp)
    rec = ctp / n_gt
    prec = ctp / np.maximum(ctp + cfp, 1e-9)
    # make precision monotonically decreasing
    prec = np.maximum.accumulate(prec[::-1])[::-1]
    return float(np.mean(np.interp(np.linspace(0, 1, 101), rec, prec, left=prec[0], right=0)))


def evaluate(weights: Path, img_dir: Path, lbl_dir: Path, conf: float,
             sliced: bool, tile: int, overlap: float, device) -> dict:
    from ultralytics import YOLO
    import cv2

    model = YOLO(str(weights))
    if sliced:
        from src.infer import sliced_predict

    all_p, all_s, all_gt_size, all_tp = [], [], [], {}
    gt_sizes_all: list[float] = []
    pred_sizes_all: list[float] = []
    # per IoU threshold: list of (tp_flag, score, gt_size_of_match or nan)
    records: dict[float, list] = {0.25: [], 0.5: []}
    n_gt_by_bucket: dict[str, int] = {b[0]: 0 for b in SIZE_BUCKETS}
    tp_by_bucket: dict[float, dict[str, int]] = {t: {b[0]: 0 for b in SIZE_BUCKETS} for t in records}

    paths = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not paths:
        raise SystemExit(f"no images in {img_dir}")

    # GUARD: full-frame inference on large frames is the exact failure this
    # whole repo exists to prevent, and it fails *quietly* -- it reports
    # plausible-looking near-zero recall rather than erroring, so the reader
    # concludes the model is broken when in fact the evaluation is.
    # Measured on 12 VisDrone frames with identical weights:
    #     sliced      overall recall 0.336, 16-32px recall 0.296
    #     full-frame  overall recall 0.054, 16-32px recall 0.020   <- 15x worse
    if not sliced:
        probe = cv2.imread(str(paths[0]))
        if probe is not None and max(probe.shape[:2]) > 1.5 * tile:
            raise SystemExit(
                f"\nRefusing to run full-frame inference on {probe.shape[1]}x{probe.shape[0]} images.\n"
                f"They will be downscaled to {tile}px, destroying every small target, and the\n"
                f"resulting numbers will look like a broken model rather than a broken eval.\n"
                f"(Measured: 15x worse recall in the 16-32px bucket.)\n\n"
                f"  Either:  add --sliced          (evaluate full frames the way you fly them)\n"
                f"  Or:      point --images at a pre-tiled directory, e.g. data/tiled/val/images\n"
            )

    for ip in tqdm(paths, desc="eval"):
        img = cv2.imread(str(ip))
        if img is None:
            continue
        h, w = img.shape[:2]
        gts = load_labels(lbl_dir / f"{ip.stem}.txt", w, h)
        gsz = np.maximum(gts[:, 2] - gts[:, 0], gts[:, 3] - gts[:, 1]) if len(gts) else np.zeros(0)
        gt_sizes_all.extend(gsz.tolist())
        for s in gsz:
            n_gt_by_bucket[bucket_of(s)] += 1

        if sliced:
            boxes, scores = sliced_predict(model, img, tile, overlap, conf, device)
        else:
            r = model.predict(img, conf=conf, verbose=False, device=device)[0]
            boxes = r.boxes.xyxy.cpu().numpy() if len(r.boxes) else np.zeros((0, 4), np.float32)
            scores = r.boxes.conf.cpu().numpy() if len(r.boxes) else np.zeros(0, np.float32)

        if len(boxes):
            pred_sizes_all.extend(np.maximum(boxes[:, 2] - boxes[:, 0], boxes[:, 3] - boxes[:, 1]).tolist())

        for thr in records:
            tp, gt_match = match(boxes, scores, gts, thr)
            for i, flag in enumerate(tp):
                records[thr].append((bool(flag), float(scores[i])))
            for gi, pi in enumerate(gt_match):
                if pi >= 0:
                    tp_by_bucket[thr][bucket_of(gsz[gi])] += 1

    total_gt = int(sum(n_gt_by_bucket.values()))
    report = {
        "weights": str(weights),
        "images": len(paths),
        "gt_instances": total_gt,
        "conf_threshold": conf,
        "inference": "sliced" if sliced else "full-frame",
        "tile": tile if sliced else None,
        "gt_size_px": {
            "p10": round(float(np.percentile(gt_sizes_all, 10)), 1) if gt_sizes_all else None,
            "median": round(float(np.median(gt_sizes_all)), 1) if gt_sizes_all else None,
            "p90": round(float(np.percentile(gt_sizes_all, 90)), 1) if gt_sizes_all else None,
        },
        "by_iou": {},
        "recall_by_size": {},
    }
    for thr, recs in records.items():
        if recs:
            tps = np.array([r[0] for r in recs])
            scs = np.array([r[1] for r in recs])
            ap = average_precision(tps, scs, total_gt)
            prec = float(tps.mean())
            rec = float(tps.sum() / max(total_gt, 1))
        else:
            ap = prec = rec = 0.0
        report["by_iou"][f"IoU{thr}"] = {
            "AP": round(ap, 4), "precision": round(prec, 4), "recall": round(rec, 4),
            "predictions": len(recs), "false_positives": int(len(recs) - sum(r[0] for r in recs)),
        }
        report["recall_by_size"][f"IoU{thr}"] = {
            name: {
                "gt": n_gt_by_bucket[name],
                "found": tp_by_bucket[thr][name],
                "recall": round(tp_by_bucket[thr][name] / n_gt_by_bucket[name], 4)
                if n_gt_by_bucket[name] else None,
            }
            for name, _, _ in SIZE_BUCKETS
        }
    return report


def bucket_of(size_px: float) -> str:
    for name, lo, hi in SIZE_BUCKETS:
        if lo <= size_px < hi:
            return name
    return SIZE_BUCKETS[-1][0]


def print_report(rep: dict) -> None:
    print("\n" + "=" * 78)
    print(f"  AERIAL PERSON DETECTION -- {rep['inference'].upper()} INFERENCE")
    print("=" * 78)
    print(f"  images {rep['images']}   gt persons {rep['gt_instances']}   conf {rep['conf_threshold']}")
    s = rep["gt_size_px"]
    print(f"  gt box size px: p10={s['p10']}  median={s['median']}  p90={s['p90']}")

    print("\n  OVERALL")
    print(f"  {'':10} {'AP':>8} {'precision':>10} {'recall':>8} {'FPs':>7}")
    for k, v in rep["by_iou"].items():
        star = "  <-- mission metric" if k == "IoU0.25" else ""
        print(f"  {k:10} {v['AP']:8.3f} {v['precision']:10.3f} {v['recall']:8.3f} "
              f"{v['false_positives']:7d}{star}")

    print("\n  RECALL BY TARGET SIZE @ IoU0.25   (this is the table that matters)")
    print(f"  {'bucket':42} {'gt':>6} {'found':>6} {'recall':>8}")
    for name, v in rep["recall_by_size"]["IoU0.25"].items():
        r = f"{v['recall']:.3f}" if v["recall"] is not None else "  n/a"
        print(f"  {name:42} {v['gt']:6d} {v['found']:6d} {r:>8}")

    tiny = rep["recall_by_size"]["IoU0.25"][SIZE_BUCKETS[0][0]]["recall"]
    small = rep["recall_by_size"]["IoU0.25"][SIZE_BUCKETS[1][0]]["recall"]
    print()
    if tiny is not None and tiny < 0.3:
        print("  <16px recall is poor. That is expected and mostly physics, not model quality.")
        print("  Operational answer: fly lower, use a longer lens, or add thermal. Do not")
        print("  claim 100 m nadir performance you do not have.")
    if small is not None and small >= 0.6:
        print("  16-32px recall is solid -- this is the 50-100m slant regime. Lead with this.")
    print("=" * 78 + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", type=Path, required=True)
    # Default to the TILED val set: full-frame eval on untiled frames silently
    # reports garbage (see the guard in evaluate()). To evaluate untiled frames
    # the way the drone actually sees them, pass --images data/yolo/val/images --sliced
    ap.add_argument("--images", type=Path, default=ROOT / "data" / "tiled" / "val" / "images")
    ap.add_argument("--labels", type=Path, default=None)
    ap.add_argument("--conf", type=float, default=0.15,
                    help="low by design: recall-first. Tune off the PR curve, not by feel.")
    ap.add_argument("--sliced", action="store_true", help="SAHI-style sliced inference (use on full frames)")
    ap.add_argument("--tile", type=int, default=640)
    ap.add_argument("--overlap", type=float, default=0.2)
    ap.add_argument("--device", default=None)
    ap.add_argument("--out", type=Path, default=ROOT / "eval_report.json")
    args = ap.parse_args()

    import torch
    device = args.device if args.device is not None else (0 if torch.cuda.is_available() else "cpu")
    labels = args.labels or args.images.parent / "labels"

    rep = evaluate(args.weights, args.images, labels, args.conf,
                   args.sliced, args.tile, args.overlap, device)
    print_report(rep)
    args.out.write_text(json.dumps(rep, indent=2))
    print(f"  written: {args.out}")


if __name__ == "__main__":
    main()
