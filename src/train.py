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


def resolve_data_yaml(path: Path) -> str:
    """Rewrite the dataset yaml with an ABSOLUTE `path`, next to the original.

    Ultralytics resolves a relative dataset `path:` against its own
    `datasets_dir` setting (~/AppData/Roaming/Ultralytics/settings.json), NOT
    against the yaml's own location -- which is what everyone assumes. Our
    `path: ../data/tiled` therefore resolves to C:/Users/<you>/data/tiled and
    the run dies with a confusing "images not found" pointing at a directory
    nobody created.

    Resolving relative to the yaml file is the behaviour users expect, so we
    materialise a resolved copy and hand ultralytics that instead.
    """
    import yaml

    path = path.resolve()
    if not path.exists():
        raise SystemExit(f"dataset config not found: {path}")
    # utf-8-sig: strips a BOM if someone edited the yaml in Notepad, which
    # otherwise makes the first key parse as "﻿path" and silently ignores it.
    cfg = yaml.safe_load(path.read_text(encoding="utf-8-sig"))

    raw = Path(str(cfg.get("path", ".")))
    resolved = raw if raw.is_absolute() else (path.parent / raw).resolve()
    if not resolved.exists():
        raise SystemExit(
            f"\nDataset root does not exist: {resolved}\n"
            f"  (from '{cfg.get('path')}' in {path})\n\n"
            f"Build it first:\n"
            f"  python scripts/get_data.py --splits train val\n"
            f"  python -m src.prepare_visdrone --src data/raw/VisDrone2019-DET-train --dst data/yolo/train\n"
            f"  python -m src.tile --src data/yolo/train --dst data/tiled/train\n"
        )

    for split in ("train", "val"):
        if split in cfg and not (resolved / cfg[split]).exists():
            raise SystemExit(f"missing {split} images: {resolved / cfg[split]}")

    cfg["path"] = str(resolved).replace("\\", "/")
    out = path.parent / f".resolved_{path.name}"
    out.write_text(yaml.safe_dump(cfg, sort_keys=False))
    print(f"[data] {path.name} -> {cfg['path']}")
    return str(out)


def safe_batch(free_bytes: int, imgsz: int) -> int:
    """Largest batch that reliably survives a long run at this image size.

    Calibrated against two measured points on an RTX 4050 (yolo11n, 640, AMP),
    not against a formula from a blog post:

        batch 8   -> ~2.3 GiB of training memory   (ran clean)
        batch 16  -> ~3.7 GiB                      (OOMed at epoch 7)

    Those give ~0.175 GiB per image and ~0.9 GiB fixed (CUDA context, model,
    optimiser state). We budget 80% of free memory and assume 1.2 GiB fixed,
    because batch 16 did not fail on arithmetic -- it fit, ran for 35 minutes,
    and then died when the desktop compositor grew a few hundred MB. Headroom
    is the whole point; a batch that "just fits" does not survive a long run.

    Scaling with imgsz**2 is right for activations, which dominate here.
    """
    free_gib = free_bytes / 2**30
    per_img = 0.175 * (imgsz / 640) ** 2
    usable = max(0.0, free_gib * 0.80 - 1.2)
    n = int(usable / per_img)
    # Clamp to powers of two for predictable BN behaviour; never below 2.
    for b in (64, 32, 16, 8, 4, 2):
        if n >= b:
            return b
    return 2


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "configs" / "person_aerial.yaml"))
    ap.add_argument("--model", default="yolo11s.pt",
                    help="yolo11n for RPi deployment, yolo11s for Jetson/GCS accuracy")
    ap.add_argument("--imgsz", type=int, default=640, help="must equal the tile size used in tile.py")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=None,
                    help="omit to auto-size from free VRAM (recommended); "
                         "an explicit value over the safe ceiling requires --force-batch")
    ap.add_argument("--force-batch", action="store_true",
                    help="override the VRAM ceiling. You will probably OOM mid-run.")
    ap.add_argument("--workers", type=int, default=4,
                    help="drop to 2 if Windows dataloader workers crash")
    ap.add_argument("--name", default="aerial_person")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    from ultralytics import YOLO

    args.data = resolve_data_yaml(Path(args.data))

    if args.device is None:
        args.device = 0 if torch.cuda.is_available() else "cpu"
    if args.device == "cpu":
        print("WARNING: training on CPU. This will take days, not hours.")
        args.batch = args.batch or 8
    else:
        name = torch.cuda.get_device_name(0)
        free, total = torch.cuda.mem_get_info(0)
        print(f"GPU: {name}  free {free/2**30:.1f} / {total/2**30:.1f} GiB")
        safe = safe_batch(free, args.imgsz)

        if args.batch is None:
            args.batch = safe
            print(f"[batch] auto-sized to {safe} from {free/2**30:.1f} GiB free")
        elif args.batch > safe and not args.force_batch:
            raise SystemExit(
                f"\nbatch={args.batch} exceeds the safe ceiling of {safe} for "
                f"{free/2**30:.1f} GiB free VRAM at imgsz={args.imgsz}.\n\n"
                f"This is not a hypothetical: batch=16 on a 6 GB RTX 4050 survived 7 epochs\n"
                f"of this exact dataset and then died with CUDA OOM in the backward pass,\n"
                f"because the desktop compositor grew by a few hundred MB. A warning was\n"
                f"printed at startup and was useless -- by the time it matters you are\n"
                f"35 minutes in and not watching.\n\n"
                f"  Drop --batch (auto-sizes), use --batch {safe}, or pass --force-batch.\n"
            )
        # Headroom check even for an in-range batch: other apps can grow.
        if free / 2**30 < 3.0:
            print(f"  only {free/2**30:.1f} GiB free -- close Chrome before a long run.")

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
