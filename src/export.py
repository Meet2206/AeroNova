"""Export trained weights for the onboard computer.

Pick the format for the board you are actually flying -- exporting to the
wrong one is the difference between 2 FPS and 25 FPS:

  ncnn      Raspberry Pi 4/5. ARM-CPU optimised, no GPU needed. This is the
            right answer for a Pi; ONNXRuntime on a Pi is roughly half the
            speed. Use with the nano model, full-frame scan mode.
  onnx      Portable / Intel NUC (with OpenVINO EP). Good interchange format
            and what you want if the team is unsure of final hardware.
  openvino  Intel NUC specifically. Big win over plain ONNX on Intel CPUs/iGPU.
  engine    NVIDIA Jetson TensorRT. Fastest by far, but the .engine is built
            for one exact GPU + TensorRT version -- you MUST run this export
            ON the Jetson itself. Exporting on this laptop produces a file the
            Jetson cannot load. This is the most common deployment mistake.

INT8 vs FP16: FP16 is nearly free accuracy-wise and roughly halves latency.
INT8 needs a calibration set and costs real recall on 20 px targets -- do not
quantise to INT8 without re-running src/eval.py and checking the <32 px
bucket specifically. A quantisation that costs 2 points of overall mAP can
cost 15 points of tiny-object recall.
"""

from __future__ import annotations

import argparse
from pathlib import Path

TARGETS = {
    "ncnn": dict(format="ncnn", half=True, note="Raspberry Pi 4/5"),
    "onnx": dict(format="onnx", half=False, opset=12, simplify=True, note="portable / NUC"),
    "openvino": dict(format="openvino", half=True, note="Intel NUC"),
    "engine": dict(format="engine", half=True, note="Jetson TensorRT -- BUILD ON THE JETSON"),
    "torchscript": dict(format="torchscript", note="debug / fallback"),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", type=Path, required=True)
    ap.add_argument("--target", choices=sorted(TARGETS), required=True)
    ap.add_argument("--imgsz", type=int, default=640, help="must match training tile size")
    args = ap.parse_args()

    from ultralytics import YOLO

    cfg = dict(TARGETS[args.target])
    note = cfg.pop("note")
    print(f"Exporting {args.weights.name} -> {args.target}  ({note})")
    if args.target == "engine":
        print("  WARNING: a TensorRT .engine is tied to the exact GPU and TensorRT")
        print("  version that built it. If you are not running this on the Jetson,")
        print("  the resulting file will not load there. Export ONNX instead and")
        print("  convert on-device with trtexec.")

    out = YOLO(str(args.weights)).export(imgsz=args.imgsz, **cfg)
    print(f"\nWritten: {out}")
    print("Re-run src/eval.py against the exported model before trusting it --")
    print("format conversion silently changes NMS behaviour and small-object recall.")


if __name__ == "__main__":
    main()
