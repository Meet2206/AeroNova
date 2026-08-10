"""Correctness checks for the tiler and the temporal confirmer.

Run: python -m src.test_tile

Tiling bugs are insidious -- a box remapped with the wrong offset produces a
dataset that trains without error and yields a model that is quietly useless.
These checks verify that a box placed at a known pixel lands at the same
world pixel after tiling and un-tiling.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np

from src.tile import run, tile_image, tile_positions


def check(name: str, cond: bool) -> bool:
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    return cond


def main() -> int:
    ok = True
    print("\ntiler checks\n")

    # 1. Positions cover the full extent with no gap.
    pos = tile_positions(1296, 640, 0.2)
    ok &= check(f"positions cover height (last={pos[-1]}, needs {1296-640})", pos[-1] == 1296 - 640)
    gaps = [pos[i + 1] - pos[i] for i in range(len(pos) - 1)]
    ok &= check(f"no gap exceeds tile size (max step {max(gaps)} <= 640)", max(gaps) <= 640)

    # 2. A box in the middle of a tile survives with exact coordinates.
    img = np.zeros((1296, 2304, 3), np.uint8)
    box = np.array([[800.0, 300.0, 820.0, 340.0]])  # 20x40 px person
    tiles = tile_image(img, box, 640, 0.2, 0.3)
    found = []
    for i, (crop, tb) in enumerate(tiles):
        for b in tb:
            # recover the tile origin to map back to frame coordinates
            xs = tile_positions(2304, 640, 0.2)
            ys = tile_positions(1296, 640, 0.2)
            y0 = ys[i // len(xs)]
            x0 = xs[i % len(xs)]
            found.append(b + np.array([x0, y0, x0, y0]))
    ok &= check(f"box appears in >=1 tile (got {len(found)})", len(found) >= 1)
    if found:
        err = max(float(np.abs(f - box[0]).max()) for f in found)
        ok &= check(f"round-trip coordinate error {err:.3f} px == 0", err < 1e-3)

    # 3. A box smaller than the overlap band appears WHOLE somewhere.
    # This is the guarantee that justifies dropping edge slivers.
    whole = [f for f in found if abs(f[2] - f[0] - 20) < 1e-3 and abs(f[3] - f[1] - 40) < 1e-3]
    ok &= check(f"box survives uncropped in >=1 tile ({len(whole)} of {len(found)})", len(whole) >= 1)

    # 4. Slivers below min_visibility are dropped, not kept as tiny junk.
    edge_box = np.array([[630.0, 300.0, 700.0, 340.0]])  # straddles x=640 boundary
    t2 = tile_image(img, edge_box, 640, 0.0, 0.5)  # zero overlap forces the split
    widths = [float(b[2] - b[0]) for _, tb in t2 for b in tb]
    ok &= check(f"no <50%-visible sliver kept (widths {[round(w) for w in widths]})",
                all(w >= 0.5 * 70 - 1 for w in widths))

    # 5. End-to-end on a temp dataset.
    tmp = Path(tempfile.mkdtemp())
    try:
        src = tmp / "src"
        (src / "images").mkdir(parents=True)
        (src / "labels").mkdir(parents=True)
        for n in range(3):
            im = np.random.randint(0, 60, (1296, 2304, 3), np.uint8)
            cv2.rectangle(im, (800, 300), (820, 340), (200, 200, 200), -1)
            cv2.imwrite(str(src / "images" / f"f{n}.jpg"), im)
            cx, cy = 810 / 2304, 320 / 1296
            (src / "labels" / f"f{n}.txt").write_text(f"0 {cx:.6f} {cy:.6f} {20/2304:.6f} {40/1296:.6f}")
        stats = run(src, tmp / "out", tile=640, overlap=0.2, keep_empty_ratio=0.0)
        ok &= check(f"3 frames -> {stats['tiles_written']} tiles written", stats["tiles_written"] >= 3)
        ok &= check(f"{stats['boxes_out']} boxes preserved (>=3)", stats["boxes_out"] >= 3)
        ok &= check("no source box lost", stats["boxes_dropped_sliver"] == 0)
        med = stats.get("tile_box_px_median")
        ok &= check(f"box stays 40 px in tiles (median {med}) -- NOT shrunk", abs(med - 40) < 2)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # 6. Temporal confirmer: noise must not confirm, a persistent target must.
    from src.infer import TemporalConfirmer
    print("\ntemporal confirmer checks\n")
    rng = np.random.default_rng(0)
    c = TemporalConfirmer(assoc_radius_m=8.0, min_hits=3)
    for _ in range(10):  # scattered false positives, never in the same place
        c.update([(23.02 + rng.random() * 0.01, 72.57 + rng.random() * 0.01, 0.2)])
    ok &= check(f"random noise confirms nothing ({len(c.confirmed)} confirmed)", len(c.confirmed) == 0)

    c2 = TemporalConfirmer(assoc_radius_m=8.0, min_hits=3)
    newly = []
    for i in range(4):  # same spot, jittered by a few metres each frame
        newly += c2.update([(23.0200 + i * 1e-5, 72.5700, 0.3)])
    ok &= check(f"persistent target confirms ({len(c2.confirmed)} confirmed)", len(c2.confirmed) == 1)
    ok &= check(f"confirmed on the {c2.confirmed[0].hits}th hit (min_hits=3)", len(newly) == 1)

    print(f"\n{'ALL CHECKS PASSED' if ok else 'FAILURES PRESENT'}\n")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
