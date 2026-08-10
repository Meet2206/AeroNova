"""Train the aerial person detector on tiled imagery.

Hyperparameters here are deliberately different from the ultralytics defaults,
because the defaults are tuned for COCO -- photos of large, centred, upright
objects taken from human eye level. Aerial SAR is the opposite problem.

WHAT IS CHANGED AND WHY:

  scale=0.3 (default 0.5)
      Random resize augmentation. At default, a 20 px person gets scaled to
      10 px and the model wastes capacity on targets that are below its own
      detection limit. We keep the scale jitter tight so training stays in the
      pixel regime we actually fly in.

  mosaic=1.0 but close_mosaic=15
      Mosaic helps small-object density enormously, but it also produces
      unrealistic tile seams. Disabling it for the last 15 epochs lets the
      model settle on clean, real-looking imagery -- this reliably buys a
      point or two of AP on small objects.

  degrees=180, flipud=0.5
      Nadir/slanted aerial imagery has NO canonical up direction. A person
      photographed from above can be rotated arbitrarily. Standard COCO
      training uses degrees=0 and flipud=0.0 because a photo of a person is
      always upright -- that assumption is simply false here.

  hsv_v=0.5, hsv_s=0.8
      Disaster imagery spans harsh noon sun, smoke, dust and overcast. Wider
      photometric jitter than COCO defaults.

  perspective=0.0005
      Small but nonzero -- simulates the slant-angle variation the problem
      statement explicitly calls out.

  cls=0.3 (default 0.5)
      Single class. There is no classification problem to solve, so we shift
      loss weight toward localisation and objectness.

  translate=0.2, erasing=0.0
      Random erasing deletes small objects entirely. Off.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "configs" / "person_aerial.yaml"))
    ap.add_argument("--model", default="yolo11s.pt",
                    help="yolo11n for RPi deployment, yolo11s for Jetson/GCS accuracy")
    ap.add_argument("--imgsz", type=int, default=640, help="must equal the tile size used in tile.py")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=8, help="8 fits 6GB VRAM at 640 with AMP")
    ap.add_argument("--workers", type=int, default=4,
                    help="drop to 2 if Windows dataloader workers crash")
    ap.add_argument("--name", default="aerial_person")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    from ultralytics import YOLO

    if args.device is None:
        args.device = 0 if torch.cuda.is_available() else "cpu"
    if args.device == "cpu":
        print("WARNING: training on CPU. This will take days, not hours.")
    else:
        name = torch.cuda.get_device_name(0)
        free, total = torch.cuda.mem_get_info(0)
        print(f"GPU: {name}  free {free/2**30:.1f} / {total/2**30:.1f} GiB")
        if total / 2**30 < 7 and args.batch > 8:
            print(f"  batch={args.batch} will likely OOM on this card; 8 is the safe ceiling at 640.")

    model = YOLO(args.model)
    model.train(
        data=args.data,
        imgsz=args.imgsz,
        epochs=args.epochs,
        batch=args.batch,
        workers=args.workers,
        device=args.device,
        project=str(ROOT / "runs"),
        name=args.name,
        resume=args.resume,
        exist_ok=True,

        amp=True,
        cache=False,           # 15 GB RAM cannot cache a tiled dataset
        patience=30,
        optimizer="auto",
        cos_lr=True,
        seed=0,
        deterministic=False,   # ~15% faster; we are not publishing a paper

        # --- loss weighting: single class, localisation matters most ---
        cls=0.3,
        box=7.5,
        dfl=1.5,

        # --- geometric augmentation for overhead imagery ---
        degrees=180.0,         # no canonical up direction from above
        flipud=0.5,
        fliplr=0.5,
        scale=0.3,             # tight -- do not shrink targets below detectability
        translate=0.2,
        shear=2.0,
        perspective=0.0005,    # slant-angle variation

        # --- photometric: smoke, dust, glare, overcast ---
        hsv_h=0.015,
        hsv_s=0.8,
        hsv_v=0.5,

        mosaic=1.0,
        close_mosaic=15,
        mixup=0.05,
        copy_paste=0.1,        # duplicates rare small persons into new contexts
        erasing=0.0,           # would delete whole targets
    )

    print(f"\nDone. Weights: runs/{args.name}/weights/best.pt")
    print("Now run size-bucketed evaluation -- overall mAP will flatter this model:")
    print(f"  python -m src.eval --weights runs/{args.name}/weights/best.pt")


if __name__ == "__main__":
    main()
