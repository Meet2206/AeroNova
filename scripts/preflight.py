"""Exercise every code path before burning GPU hours or standing in front of judges.

Run this after any change and before any Kaggle run:

    python scripts/preflight.py --weights runs/aerial_person/weights/best.pt

Without --weights it runs everything that does not need a trained model, so it
is still useful on a fresh clone.

WHY THIS EXISTS: three separate bugs in this repo were "the documented happy
path was never actually executed" -- a dataset config that resolved to the
wrong directory, an eval default that silently reported garbage, and a
--resume flag that quietly restarted from scratch. None of them raised an
error. Unit tests did not catch them because they were integration paths.
This script runs the paths.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail else ""))
    return ok


def run_py(args: list[str], timeout: int = 900) -> tuple[int, str]:
    p = subprocess.run([PY, *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n  {title}\n{'=' * 72}")


# --------------------------------------------------------------------------

def check_unit_tests() -> None:
    section("1. UNIT TESTS")
    for mod in ("src.test_geo", "src.test_tile", "src.test_space_parity"):
        rc, out = run_py(["-m", mod])
        record(mod, rc == 0, "" if rc == 0 else out.strip().splitlines()[-1][:120])


def check_gsd() -> None:
    section("2. GSD CALCULATOR")
    rc, out = run_py(["-m", "src.gsd", "--preset", "picam3", "--alt", "100", "--slant", "45"])
    record("gsd runs", rc == 0)
    record("gsd flags the hard regime", "HARD" in out or "VERY HARD" in out,
           "should classify 100m/45deg as hard")
    rc2, _ = run_py(["-m", "src.gsd", "--hfov", "82", "--width", "3840", "--height", "2160"])
    record("gsd accepts custom camera", rc2 == 0)
    rc3, out3 = run_py(["-m", "src.gsd"])
    record("gsd rejects missing args", rc3 != 0, "must error, not guess a camera")


def check_dataset_config() -> None:
    section("3. DATASET CONFIG RESOLUTION")
    sys.path.insert(0, str(ROOT))
    from src.train import resolve_data_yaml

    tiled = ROOT / "data" / "tiled"
    have_train = (tiled / "train" / "images").exists()
    have_val = (tiled / "val" / "images").exists()

    if have_train and have_val:
        try:
            p = resolve_data_yaml(ROOT / "configs" / "person_aerial.yaml")
            from ultralytics.data.utils import check_det_dataset
            d = check_det_dataset(p)
            inside = str(ROOT).lower() in str(d["val"]).lower()
            record("committed config resolves inside the repo", inside, str(d["val"]))
        except Exception as e:  # noqa: BLE001
            record("committed config resolves", False, str(e)[:140])
    else:
        record("committed config resolves", True, "SKIPPED - data/tiled not built yet")

    # The failure path must be loud, since a silent wrong path was a real bug.
    tmp = Path(tempfile.mkdtemp())
    try:
        bad = tmp / "bad.yaml"
        bad.write_text("path: ../nonexistent\ntrain: train/images\nval: val/images\nnames:\n  0: person\n")
        try:
            resolve_data_yaml(bad)
            record("missing dataset root fails loudly", False, "it returned instead of erroring")
        except SystemExit as e:
            record("missing dataset root fails loudly", "does not exist" in str(e), str(e)[:80])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_eval_guard(weights: Path | None) -> None:
    section("4. EVAL GUARD (the 15x silent-failure footgun)")
    full = ROOT / "data" / "yolo" / "val" / "images"
    if not weights or not full.exists():
        record("eval guard", True, "SKIPPED - needs --weights and data/yolo/val")
        return
    rc, out = run_py(["-m", "src.eval", "--weights", str(weights), "--images", str(full)])
    record("refuses full-frame on large images", rc != 0 and "Refusing" in out)
    record("error message names both fixes", "--sliced" in out and "tiled" in out)


def check_sliced_inference(weights: Path | None) -> None:
    section("5. SLICED INFERENCE")
    if not weights:
        record("sliced inference", True, "SKIPPED - needs --weights")
        return
    sys.path.insert(0, str(ROOT))
    import numpy as np
    from ultralytics import YOLO

    from src.infer import sliced_predict

    model = YOLO(str(weights))
    # Odd shapes are where tile snapping and mixed-size batching break.
    for h, w in [(1296, 2304), (1080, 1920), (480, 800), (300, 300), (700, 640), (641, 639)]:
        try:
            b, s = sliced_predict(model, np.random.randint(0, 80, (h, w, 3), np.uint8),
                                  640, 0.2, 0.15, None)
            record(f"slices {w}x{h}", True, f"{len(b)} boxes")
        except Exception as e:  # noqa: BLE001
            record(f"slices {w}x{h}", False, f"{type(e).__name__}: {e}"[:120])


def check_infer_cli(weights: Path | None) -> None:
    section("6. INFER CLI (end to end, with geo-location)")
    if not weights:
        record("infer CLI", True, "SKIPPED - needs --weights")
        return
    src_imgs = ROOT / "data" / "yolo" / "val" / "images"
    if not src_imgs.exists():
        record("infer CLI", True, "SKIPPED - no val images")
        return

    tmp = Path(tempfile.mkdtemp())
    try:
        clip = tmp / "clip.mp4"
        import cv2
        frames = sorted(src_imgs.glob("*.jpg"))[:6]
        if not frames:
            record("infer CLI", True, "SKIPPED - no frames")
            return
        first = cv2.imread(str(frames[0]))
        h, w = first.shape[:2]
        vw = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), 5, (w, h))
        for f in frames:
            im = cv2.imread(str(f))
            vw.write(cv2.resize(im, (w, h)))
        vw.release()

        out = tmp / "pred"
        rc, log = run_py(["-m", "src.infer", "--weights", str(weights), "--source", str(clip),
                          "--full-frame", "--save", str(out),
                          "--lat", "23.0225", "--lon", "72.5714",
                          "--alt", "80", "--pitch", "-45"], timeout=600)
        record("infer CLI completes", rc == 0, "" if rc == 0 else log.strip().splitlines()[-1][:140])
        n = len(list(out.glob("*.jpg"))) if out.exists() else 0
        record("infer CLI writes annotated frames", n == len(frames), f"{n}/{len(frames)}")
        record("infer CLI reports a summary", "confirmed targets" in log)
    except Exception as e:  # noqa: BLE001
        record("infer CLI", False, f"{type(e).__name__}: {e}"[:140])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_export(weights: Path | None) -> None:
    section("7. DEPLOYMENT EXPORT")
    if not weights:
        record("export", True, "SKIPPED - needs --weights")
        return
    # onnx and torchscript are the two that must work anywhere. ncnn/openvino
    # pull extra deps that may not be installed on a dev box; a missing
    # dependency is a different failure from broken code, so report it as such.
    for target in ("onnx", "torchscript"):
        rc, out = run_py(["-m", "src.export", "--weights", str(weights), "--target", target],
                         timeout=900)
        record(f"export {target}", rc == 0, "" if rc == 0 else out.strip().splitlines()[-1][:120])
    for target in ("ncnn", "openvino"):
        rc, out = run_py(["-m", "src.export", "--weights", str(weights), "--target", target],
                         timeout=900)
        if rc == 0:
            record(f"export {target}", True)
        else:
            missing = any(k in out.lower() for k in ("no module", "pip install", "requirements"))
            record(f"export {target}", missing,
                   "missing optional dep (expected on a dev box)" if missing
                   else out.strip().splitlines()[-1][:120])


def check_kaggle_script() -> None:
    section("8. KAGGLE SCRIPT")
    k = ROOT / "kaggle" / "kaggle_train.py"
    rc, out = run_py([str(k), "--help"])
    record("kaggle_train --help", rc == 0)
    # Check the source, not --help: argparse line-wraps long defaults, so
    # grepping the help text produces a false failure.
    # NOTE: encoding="utf-8" everywhere. Windows defaults read_text() to cp1252,
    # which blows up on the em-dashes in these files. This bit the preflight
    # itself before it was pinned.
    src_k = k.read_text(encoding="utf-8")
    record("defaults to Siddh10 hub repo",
           'default="Siddh10/sih-aerial-person"' in src_k)

    import ast
    tree = ast.parse(src_k)
    names = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
    for fn in ("stage_data", "HubCheckpoint", "_try_fetch_hub_checkpoint", "main"):
        record(f"kaggle defines {fn}", fn in names)

    # The resume-fails-loudly guarantee, checked structurally: we cannot run it
    # without a GPU, but we can assert the SystemExit branch exists and that
    # resume is no longer the silent `args.resume and last.exists()` form.
    src = k.read_text(encoding="utf-8")
    record("resume raises instead of silently restarting",
           "raise SystemExit" in src and "resume=resuming" in src)
    record("resume falls back to the Hub", "_try_fetch_hub_checkpoint(args.hf_repo" in src)


def check_hf_space() -> None:
    section("9. HF SPACE")
    sys.path.insert(0, str(ROOT / "hf_space"))
    try:
        import numpy as np
        from PIL import Image

        import app
        record("space imports", True)

        rc = (ROOT / "hf_space" / "requirements.txt").read_text(encoding="utf-8")
        record("space pins CPU torch", "whl/cpu" in rc,
               "the default wheel is 2.5GB of unusable CUDA and blows the size limit")
        record("space uses headless opencv", "opencv-python-headless" in rc,
               "plain opencv needs libGL, which Spaces images lack")

        meta = (ROOT / "hf_space" / "README.md").read_text(encoding="utf-8")
        for key in ("sdk: gradio", "app_file: app.py"):
            record(f"space README has '{key}'", key in meta)

        img = Image.fromarray(np.random.randint(0, 80, (720, 1280, 3), np.uint8))
        out, summary, rows = app.detect(img, "yolo11n", 0.15, False, 640, 0.2,
                                        66.0, 80.0, -45.0, 0.0, 23.0225, 72.5714)
        record("space detect() full-frame", out is not None and isinstance(rows, list))
        out2, s2, r2 = app.detect(img, "yolo11n", 0.15, True, 640, 0.2,
                                  66.0, 80.0, -45.0, 0.0, 23.0225, 72.5714)
        record("space detect() sliced", out2 is not None and "sliced" in s2)
        record("space handles empty input", app.detect(None, "yolo11n", 0.15, False, 640, 0.2,
                                                       66.0, 80.0, -45.0, 0.0, 23.0, 72.5)[0] is None)
    except Exception:  # noqa: BLE001
        record("space checks", False, traceback.format_exc().strip().splitlines()[-1][:140])


def check_repo_hygiene() -> None:
    section("10. REPO HYGIENE")
    import subprocess as sp
    tracked = sp.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    bad = [f for f in tracked
           if f.endswith((".pt", ".onnx", ".engine", ".zip"))
           or f.startswith(("data/", "runs/"))]
    record("no weights or datasets tracked", not bad, ", ".join(bad[:5]))

    gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for pat in ("data/", "runs/", "*.pt", ".venv/"):
        record(f".gitignore covers {pat}", pat in gi)

    # A leaked HF or GitHub token in a pushed repo is unrecoverable -- it must
    # be rotated, not just deleted. Cheap to check, expensive to miss.
    import re
    leaked = []
    for f in tracked:
        p = ROOT / f
        if not p.is_file() or p.suffix not in {".py", ".md", ".txt", ".yaml", ".yml", ".json"}:
            continue
        txt = p.read_text(errors="ignore")
        if re.search(r"hf_[A-Za-z0-9]{34,}|gh[pousr]_[A-Za-z0-9]{36,}|sk-[A-Za-z0-9]{32,}", txt):
            leaked.append(f)
    record("no credentials committed", not leaked, ", ".join(leaked))

    dirty = sp.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    record("working tree clean", not dirty, f"{len(dirty.splitlines())} uncommitted" if dirty else "")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", type=Path, default=None)
    ap.add_argument("--skip-slow", action="store_true", help="skip export and infer CLI")
    args = ap.parse_args()

    w = args.weights
    if w and not w.exists():
        print(f"weights not found: {w}")
        return 2

    print(f"\nPREFLIGHT -- {'with' if w else 'without'} trained weights"
          + (f" ({w})" if w else " (model-dependent checks will be skipped)"))

    check_unit_tests()
    check_gsd()
    check_dataset_config()
    check_eval_guard(w)
    check_sliced_inference(w)
    if not args.skip_slow:
        check_infer_cli(w)
        check_export(w)
    check_kaggle_script()
    check_hf_space()
    check_repo_hygiene()

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{'=' * 72}")
    print(f"  {len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    if failed:
        print("\n  FAILURES:")
        for name, _, detail in failed:
            print(f"    - {name}: {detail}")
        print("\n  DO NOT PUSH OR LAUNCH A KAGGLE RUN UNTIL THESE ARE GREEN.")
    else:
        print("  ALL GREEN -- safe to push and to launch the Kaggle run.")
    print("=" * 72 + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
