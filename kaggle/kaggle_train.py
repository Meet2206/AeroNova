"""End-to-end training on a Kaggle notebook (free P100 / 2x T4).

WHY KAGGLE AND NOT HF SPACES:
    HF Spaces has no free GPU. ZeroGPU caps a function call at a few minutes,
    which is fine for inference and useless for a 100-epoch run. Paid GPU
    Spaces have ephemeral storage and restart on push, so a crash loses the
    run. Kaggle gives 30 free GPU-hours/week, 12-hour sessions, and persistent
    /kaggle/working output. Train here, host on HF.

KAGGLE SETUP (do these in the notebook UI first):
    1. Settings -> Accelerator -> GPU P100   (or T4 x2)
    2. Settings -> Internet -> ON            (needed to fetch VisDrone + push to Hub)
    3. Add-ons -> Secrets -> add `HF_TOKEN`  (a WRITE token from
       huggingface.co/settings/tokens). Without this the upload step is
       skipped and your weights die with the session.

THE 12-HOUR WALL IS REAL. A 100-epoch run on ~30k tiles takes roughly 6-9 h on
a P100. This script checkpoints to the Hub every `push_every` epochs so that
if the session is cut you resume instead of starting over. Do not skip that.

Run in a notebook cell:
    !git clone https://github.com/<you>/sih-drone-vision /kaggle/working/repo
    %cd /kaggle/working/repo
    !pip install -q ultralytics gdown
    !python kaggle/kaggle_train.py --epochs 100 --hf-repo <you>/sih-aerial-person
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

WORK = Path("/kaggle/working") if Path("/kaggle/working").exists() else Path.cwd() / "kaggle_work"
DATA = WORK / "data"
REPO_ROOT = Path(__file__).resolve().parent.parent

VISDRONE = {
    "train": ("1a2oHjcEcwXP8oUF95qiwrqzACb2YlUhn", "VisDrone2019-DET-train.zip"),
    "val": ("1bxK5zgLn0_L8x276eKkuYA_FzwCIjb59", "VisDrone2019-DET-val.zip"),
}


def sh(cmd: str) -> None:
    print(f"$ {cmd}", flush=True)
    if subprocess.call(cmd, shell=True) != 0:
        raise SystemExit(f"failed: {cmd}")


def stage_data(tile: int, overlap: float) -> Path:
    """Download -> convert -> tile. Skips any stage whose output already exists,
    so re-running after a session restart is cheap."""
    sys.path.insert(0, str(REPO_ROOT))
    import gdown

    from src.prepare_visdrone import convert_split
    from src.tile import run as tile_run

    raw = DATA / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for split, (fid, name) in VISDRONE.items():
        out = raw / Path(name).stem
        if out.exists():
            print(f"[data] {split} already extracted")
            continue
        zp = raw / name
        if not zp.exists():
            gdown.download(id=fid, output=str(zp), quiet=False)
        with zipfile.ZipFile(zp) as z:
            z.extractall(raw)
        zp.unlink()  # Kaggle gives ~20 GB of working disk; do not waste it on zips

    for split in ("train", "val"):
        yolo_dir = DATA / "yolo" / split
        if (yolo_dir / "labels").exists():
            print(f"[data] {split} already converted")
        else:
            stats = convert_split(
                raw / f"VisDrone2019-DET-{split}", yolo_dir,
                max_occlusion=1, mask_ignored=True,
                # Keep more negatives in val: false positives happen on empty
                # ground, and an eval set with no empty ground cannot measure them.
                drop_empty_ratio=0.5 if split == "train" else 0.0,
            )
            print(f"[convert {split}] {stats}")

        tiled = DATA / "tiled" / split
        if (tiled / "labels").exists():
            print(f"[data] {split} already tiled")
        else:
            stats = tile_run(
                yolo_dir, tiled, tile=tile, overlap=overlap,
                keep_empty_ratio=0.08 if split == "train" else 1.0,
            )
            print(f"[tile {split}] {stats}")

    yaml_path = DATA / "person_aerial.yaml"
    yaml_path.write_text(
        f"path: {DATA / 'tiled'}\ntrain: train/images\nval: val/images\n\nnames:\n  0: person\n"
    )
    return yaml_path


class HubCheckpoint:
    """Push weights to the HF Hub during training so a killed session is survivable.

    Kaggle will terminate you at 12 h, or sooner if the browser tab dies on a
    flaky connection. Weights written only to /kaggle/working survive a
    *notebook save*, but not an unsaved timeout. The Hub is the durable store.
    """

    def __init__(self, repo_id: str | None, run_dir: Path, every: int = 10):
        self.repo_id, self.run_dir, self.every = repo_id, run_dir, every
        self.api = None
        if not repo_id:
            print("[hub] no --hf-repo given; checkpoints stay local only (risky)")
            return
        token = os.environ.get("HF_TOKEN") or self._kaggle_secret("HF_TOKEN")
        if not token:
            print("[hub] HF_TOKEN not found in env or Kaggle Secrets -- upload disabled.")
            print("[hub] Add-ons -> Secrets -> HF_TOKEN (a WRITE token). Do this now, not later.")
            return
        from huggingface_hub import HfApi
        self.api = HfApi(token=token)
        self.api.create_repo(repo_id, repo_type="model", exist_ok=True, private=False)
        print(f"[hub] checkpointing to https://huggingface.co/{repo_id}")

    @staticmethod
    def _kaggle_secret(name: str):
        try:
            from kaggle_secrets import UserSecretsClient
            return UserSecretsClient().get_secret(name)
        except Exception:  # noqa: BLE001 -- not on Kaggle, or secret not set
            return None

    def push(self, tag: str = "checkpoint") -> None:
        if self.api is None:
            return
        best = self.run_dir / "weights" / "best.pt"
        if not best.exists():
            return
        try:
            self.api.upload_file(path_or_fileobj=str(best), path_in_repo="best.pt",
                                 repo_id=self.repo_id, repo_type="model",
                                 commit_message=f"{tag}")
            print(f"[hub] pushed best.pt ({tag})")
        except Exception as e:  # noqa: BLE001 -- never let an upload hiccup kill training
            print(f"[hub] upload failed (training continues): {e}")


def _try_fetch_hub_checkpoint(repo_id: str | None, run_dir: Path) -> Path | None:
    """Pull best.pt back from the Hub after Kaggle wipes /kaggle/working."""
    if not repo_id:
        return None
    try:
        from huggingface_hub import hf_hub_download
        p = hf_hub_download(repo_id, filename="best.pt")
        dest = run_dir / "weights"
        dest.mkdir(parents=True, exist_ok=True)
        target = dest / "hub_best.pt"
        shutil.copy(p, target)
        return target
    except Exception as e:  # noqa: BLE001 -- repo may not exist yet
        print(f"[resume] no Hub checkpoint available: {e}")
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolo11s.pt")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=32, help="P100 16GB handles 32 at 640; 2xT4 use 32 too")
    ap.add_argument("--tile", type=int, default=640)
    ap.add_argument("--overlap", type=float, default=0.2)
    ap.add_argument("--hf-repo", default="Siddh10/sih-aerial-person",
                    help="HF Hub model repo to checkpoint into; pass '' to disable")
    ap.add_argument("--push-every", type=int, default=10)
    ap.add_argument("--name", default="aerial_person")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if args.tile != args.imgsz:
        print(f"WARNING: tile={args.tile} != imgsz={args.imgsz}. Training scale will not")
        print("match inference slicing scale and recall will suffer. Make them equal.")

    import torch
    if not torch.cuda.is_available():
        raise SystemExit(
            "No GPU. On Kaggle: Settings -> Accelerator -> GPU P100. "
            "Do not train this on CPU."
        )
    print(f"[gpu] {torch.cuda.get_device_name(0)}  "
          f"{torch.cuda.get_device_properties(0).total_memory / 2**30:.1f} GiB")

    data_yaml = stage_data(args.tile, args.overlap)
    sys.path.insert(0, str(REPO_ROOT))
    from ultralytics import YOLO

    run_dir = WORK / "runs" / args.name
    ckpt = HubCheckpoint(args.hf_repo, run_dir, args.push_every)

    # Resume must fail LOUDLY. The 12-hour wall is the entire reason this
    # script exists; silently restarting a run the user believes is resuming
    # burns another 8 GPU-hours and they only find out at the end.
    weights = args.model
    last = run_dir / "weights" / "last.pt"
    resuming = False
    if args.resume:
        if last.exists():
            print(f"[resume] continuing from {last}")
            weights, resuming = str(last), True
        else:
            hub_last = _try_fetch_hub_checkpoint(args.hf_repo, run_dir)
            if hub_last:
                print(f"[resume] no local checkpoint; pulled {hub_last} from the Hub")
                print("[resume] NOTE: this restarts the LR schedule -- the Hub only holds")
                print("[resume] best.pt, not optimiser state. Weights are preserved.")
                weights = str(hub_last)
            else:
                raise SystemExit(
                    f"\n--resume passed but there is nothing to resume from.\n"
                    f"  looked for: {last}\n"
                    f"  and on the Hub: {args.hf_repo or '(no --hf-repo)'}\n\n"
                    f"Kaggle wipes /kaggle/working between sessions, so a local last.pt\n"
                    f"does not survive. Either drop --resume to start fresh, or make sure\n"
                    f"HF_TOKEN is set so checkpoints actually reach the Hub next time.\n"
                )

    model = YOLO(weights)

    # Ultralytics fires this after every epoch -- our hook into the run.
    def on_epoch_end(trainer):
        ep = trainer.epoch + 1
        if ep % args.push_every == 0:
            ckpt.push(tag=f"epoch {ep}")

    model.add_callback("on_fit_epoch_end", on_epoch_end)

    model.train(
        data=str(data_yaml), imgsz=args.imgsz, epochs=args.epochs, batch=args.batch,
        device=0, workers=4, project=str(WORK / "runs"), name=args.name,
        exist_ok=True, resume=resuming,
        amp=True, cache=False, patience=30, cos_lr=True, seed=0, deterministic=False,
        # See src/train.py for the full rationale behind each of these.
        cls=0.3, box=7.5, dfl=1.5,
        degrees=180.0, flipud=0.5, fliplr=0.5,
        scale=0.3, translate=0.2, shear=2.0, perspective=0.0005,
        hsv_h=0.015, hsv_s=0.8, hsv_v=0.5,
        mosaic=1.0, close_mosaic=15, mixup=0.05, copy_paste=0.1, erasing=0.0,
    )

    ckpt.push(tag="final")

    # Honest evaluation -- overall mAP will flatter this model, so print the
    # size-bucketed table too.
    from src.eval import evaluate, print_report
    import json
    rep = evaluate(run_dir / "weights" / "best.pt",
                   DATA / "tiled" / "val" / "images",
                   DATA / "tiled" / "val" / "labels",
                   conf=0.15, sliced=False, tile=args.tile, overlap=args.overlap, device=0)
    print_report(rep)
    (WORK / "eval_report.json").write_text(json.dumps(rep, indent=2))

    # Export a Pi-ready model while we still have the environment set up.
    try:
        YOLO(str(run_dir / "weights" / "best.pt")).export(format="onnx", imgsz=args.imgsz,
                                                          opset=12, simplify=True)
    except Exception as e:  # noqa: BLE001
        print(f"[export] onnx export failed (not fatal): {e}")

    if ckpt.api:
        for f, name in [(WORK / "eval_report.json", "eval_report.json"),
                        (run_dir / "weights" / "best.onnx", "best.onnx")]:
            if f.exists():
                try:
                    ckpt.api.upload_file(path_or_fileobj=str(f), path_in_repo=name,
                                         repo_id=args.hf_repo, repo_type="model")
                except Exception as e:  # noqa: BLE001
                    print(f"[hub] {name} upload failed: {e}")

    # Kaggle only persists /kaggle/working, and only up to 20 GB. Drop the
    # dataset so the notebook output can actually be saved.
    if WORK.name == "working":
        shutil.rmtree(DATA, ignore_errors=True)
        print("[cleanup] removed staged dataset so the notebook output can save")

    print(f"\nDone. Weights at {run_dir / 'weights' / 'best.pt'}")
    if args.hf_repo:
        print(f"And on the Hub: https://huggingface.co/{args.hf_repo}")


if __name__ == "__main__":
    main()
