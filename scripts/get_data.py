"""Download and stage the aerial-person datasets.

DATASET NOTES (verified 2026-08-10):

  VisDrone2019-DET  [PRIMARY, freely downloadable]
      Drone imagery, ~10k images, includes `pedestrian` and `people` classes
      at genuinely small scale. Hosted on Google Drive by the VisDrone team;
      also mirrored on AWS. This is the workhorse.
      Caveat: mostly urban, mostly 20-60 m altitude, mostly nadir-ish. It is
      NOT a disaster dataset. Say so in the submission rather than implying
      you trained on flood footage.

  TinyPerson  [SECONDARY, worth the effort]
      Purpose-built for persons at 10-30 px -- exactly the 100 m regime.
      Seaside/beach scenes, many people in water, which is the closest public
      proxy for flood victims. Requires a manual download from the
      PointTinyBenchmark repo's linked Baidu/Google drive.

  HERIDAL  [GATED, server was unreachable on 2026-08-10]
      The most on-point dataset (wilderness search and rescue, humans at tiny
      scale from a real SAR drone). Access is by email request to the
      University of Split. Worth requesting NOW in parallel -- if it lands
      before the deadline it is the strongest single addition. Do not block on
      it.

  SARD  [check Kaggle -- the URL moves]
      Search-and-rescue actors in non-urban terrain. Small but on-theme.

  YOUR OWN FOOTAGE  [the highest-value dataset you can get]
      200-500 annotated frames from YOUR drone at YOUR altitude with YOUR
      camera will beat 10k VisDrone images for demo-day performance, because
      it removes the domain gap entirely. Fly the college ground at 50/75/100 m
      with people lying and standing, annotate in Label Studio or CVAT, and
      fine-tune on it last. Budget a day for this. It is the difference
      between a model that works in the demo and one that does not.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

# VisDrone2019-DET official Google Drive file ids.
VISDRONE = {
    "train": ("1a2oHjcEcwXP8oUF95qiwrqzACb2YlUhn", "VisDrone2019-DET-train.zip", "~1.4 GB"),
    "val": ("1bxK5zgLn0_L8x276eKkuYA_FzwCIjb59", "VisDrone2019-DET-val.zip", "~78 MB"),
    "test": ("1PFdW_VFSCfZ_sTSZAGjQdifF_Xd5mf0V", "VisDrone2019-DET-test-dev.zip", "~297 MB"),
}


def download_gdrive(file_id: str, dest: Path) -> bool:
    try:
        import gdown
    except ImportError:
        print("  gdown not installed. Run: pip install gdown")
        return False
    if dest.exists():
        print(f"  already present: {dest.name}")
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        gdown.download(id=file_id, output=str(dest), quiet=False)
        return dest.exists()
    except Exception as e:  # noqa: BLE001 -- Drive quota errors are opaque and varied
        print(f"  download failed: {e}")
        print("  Google Drive rate-limits popular files. Either retry later, or")
        print("  download manually from https://github.com/VisDrone/VisDrone-Dataset")
        print(f"  and place the zip at {dest}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--splits", nargs="+", default=["train", "val"], choices=list(VISDRONE))
    ap.add_argument("--no-extract", action="store_true")
    args = ap.parse_args()

    ok = True
    for split in args.splits:
        fid, name, size = VISDRONE[split]
        print(f"\nVisDrone {split} ({size})")
        zp = RAW / name
        if not download_gdrive(fid, zp):
            ok = False
            continue
        if args.no_extract:
            continue
        out = RAW / zp.stem
        if out.exists():
            print(f"  already extracted: {out.name}")
            continue
        print(f"  extracting -> {out}")
        with zipfile.ZipFile(zp) as z:
            z.extractall(RAW)

    print("\nNext:")
    print("  python -m src.prepare_visdrone --src data/raw/VisDrone2019-DET-train --dst data/yolo/train")
    print("  python -m src.prepare_visdrone --src data/raw/VisDrone2019-DET-val   --dst data/yolo/val")
    print("  python -m src.tile --src data/yolo/train --dst data/tiled/train")
    print("  python -m src.tile --src data/yolo/val   --dst data/tiled/val --keep-empty-ratio 1.0")
    print("\n  (val keeps ALL tiles -- you must evaluate on the true frame distribution,")
    print("   including the empty tiles where false positives actually happen.)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
