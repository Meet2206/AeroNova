"""Verify the HF Space's inlined geometry matches the unit-tested src/infer.py.

The Space duplicates pixel_to_ground() so it can deploy standalone without the
training repo. Duplicated maths drifts. This pins the two together, so if
someone edits one, CI (or a manual run) catches it rather than the demo
quietly reporting coordinates that disagree with the flight code.

Run: python -m src.test_space_parity
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "hf_space"))

import app  # noqa: E402

from src.infer import CameraModel, pixel_to_ground as ref  # noqa: E402

CASES = [
    (1152, 648, -90, 0),    # nadir, centre
    (1152, 648, -45, 0),    # 45deg slant, centre
    (1400, 700, -45, 90),   # off-centre, heading East
    (300, 200, -60, 215),   # arbitrary corner + heading
    (2000, 1200, -30, 45),  # shallow slant, far corner
]


def main() -> int:
    cam = CameraModel(66.0, 2304, 1296)
    bad = 0
    print("\nSpace app geometry vs unit-tested src/infer.py\n")
    for u, v, pitch, yaw in CASES:
        a = ref(u, v, cam, 23.0225, 72.5714, 80, pitch, yaw)
        b = app.pixel_to_ground(u, v, 66.0, 2304, 1296, 23.0225, 72.5714, 80, pitch, yaw)
        if a is None or b is None:
            ok = a is None and b is None
            print(f"  pitch={pitch:4} yaw={yaw:4}  both None: {ok}")
            bad += not ok
            continue
        d = max(abs(a[0] - b[0]), abs(a[1] - b[1]))
        ok = d < 1e-12
        bad += not ok
        print(f"  [{'PASS' if ok else 'FAIL'}] pitch={pitch:4} yaw={yaw:4}  delta={d:.2e} deg")

    print(f"\n{'PARITY OK' if not bad else 'PARITY BROKEN -- Space and flight code disagree'}\n")
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
