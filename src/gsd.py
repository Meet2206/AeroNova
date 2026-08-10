"""Ground Sample Distance / target-pixel-size calculator.

This is the script that grounds every other decision in this repo. Before you
pick a model, a tile size, or an evaluation bucket, you need to know how many
pixels tall a human actually is in your imagery.

A 1.7 m person at 100 m altitude is NOT a "small object" in the COCO sense --
it is a handful of pixels. Train and evaluate for that number, not for a vibe.

Usage:
    python -m src.gsd --preset picam3
    python -m src.gsd --hfov 66 --width 1920 --height 1080 --alt 50 100
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass

# Real cameras people actually fly on an RPi/Jetson payload rig.
# hfov_deg = horizontal field of view at the stated resolution.
PRESETS: dict[str, dict] = {
    "picam3": dict(hfov_deg=66.0, width=2304, height=1296, label="RPi Camera Module 3 (wide-ish)"),
    "picam3_wide": dict(hfov_deg=102.0, width=2304, height=1296, label="RPi Camera Module 3 Wide"),
    "imx477": dict(hfov_deg=62.2, width=4056, height=3040, label="RPi HQ Cam IMX477 + 6mm lens"),
    "mavic_wide": dict(hfov_deg=82.1, width=3840, height=2160, label="DJI Mavic-class 4K wide"),
    "flir_lepton": dict(hfov_deg=57.0, width=160, height=120, label="FLIR Lepton 3.5 thermal"),
    "boson640": dict(hfov_deg=32.0, width=640, height=512, label="FLIR Boson 640 thermal"),
}

HUMAN_HEIGHT_M = 1.70
HUMAN_WIDTH_M = 0.50


@dataclass
class Result:
    alt_m: float
    slant_deg: float
    slant_range_m: float
    gsd_cm: float
    px_standing: float
    px_prone: float
    footprint_m: tuple[float, float]


def compute(hfov_deg: float, width: int, height: int, alt_m: float, slant_deg: float) -> Result:
    """Pixel size of a human at `alt_m` altitude, viewed `slant_deg` off nadir.

    slant_deg = 0 is straight down (nadir). The problem statement asks for a
    slanted angle, which increases the distance to target and shrinks the
    target further -- this is why the slant case is the one that matters.
    """
    # Distance from camera to the target along the optical axis.
    slant_range = alt_m / math.cos(math.radians(slant_deg))

    # Angular size of one pixel (radians per pixel), horizontal.
    ifov = 2.0 * math.tan(math.radians(hfov_deg) / 2.0) / width
    gsd_m = ifov * slant_range  # metres of ground per pixel at that range

    # A standing human is mostly perpendicular to a slanted view, so their
    # height projects nearly fully. Under nadir you only see their shoulders,
    # so the "standing" extent collapses toward their width.
    nadir_factor = math.sin(math.radians(slant_deg))
    visible_extent_m = HUMAN_WIDTH_M + (HUMAN_HEIGHT_M - HUMAN_WIDTH_M) * nadir_factor
    px_standing = visible_extent_m / gsd_m

    # A collapsed/injured/unconscious person -- the actual SAR case -- presents
    # their full length flat on the ground and is best seen near nadir.
    prone_extent_m = HUMAN_WIDTH_M + (HUMAN_HEIGHT_M - HUMAN_WIDTH_M) * math.cos(
        math.radians(slant_deg)
    )
    px_prone = prone_extent_m / gsd_m

    vfov_deg = math.degrees(2 * math.atan(math.tan(math.radians(hfov_deg) / 2) * height / width))
    footprint = (
        2 * slant_range * math.tan(math.radians(hfov_deg) / 2),
        2 * slant_range * math.tan(math.radians(vfov_deg) / 2),
    )
    return Result(alt_m, slant_deg, slant_range, gsd_m * 100, px_standing, px_prone, footprint)


def bucket(px: float) -> str:
    if px < 8:
        return "HOPELESS - below detectability, reduce altitude or change lens"
    if px < 16:
        return "VERY HARD - tiled training mandatory, expect low recall"
    if px < 32:
        return "HARD - tiled training required, this is the target regime"
    if px < 64:
        return "MODERATE - standard small-object training works"
    return "EASY"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", choices=sorted(PRESETS), help="named camera preset")
    ap.add_argument("--hfov", type=float, help="horizontal field of view, degrees")
    ap.add_argument("--width", type=int, help="image width in pixels")
    ap.add_argument("--height", type=int, help="image height in pixels")
    ap.add_argument("--alt", type=float, nargs="+", default=[30, 50, 75, 100], help="altitudes, m")
    ap.add_argument("--slant", type=float, nargs="+", default=[0, 30, 45, 60], help="degrees off nadir")
    args = ap.parse_args()

    if args.preset:
        cfg = PRESETS[args.preset]
        hfov, width, height, label = cfg["hfov_deg"], cfg["width"], cfg["height"], cfg["label"]
    elif args.hfov and args.width and args.height:
        hfov, width, height, label = args.hfov, args.width, args.height, "custom"
    else:
        ap.error("give --preset, or all of --hfov --width --height")

    print(f"\nCamera: {label}   {width}x{height}  HFOV {hfov} deg")
    print(f"Human model: {HUMAN_HEIGHT_M} m tall, {HUMAN_WIDTH_M} m wide\n")
    hdr = f"{'alt':>5} {'slant':>6} {'range':>7} {'GSD':>8} {'px(stand)':>10} {'px(prone)':>10}  {'footprint':>13}  verdict"
    print(hdr)
    print("-" * len(hdr) + "-" * 20)

    for alt in args.alt:
        for slant in args.slant:
            r = compute(hfov, width, height, alt, slant)
            worst = min(r.px_standing, r.px_prone)
            print(
                f"{alt:5.0f} {slant:5.0f}d {r.slant_range_m:6.0f}m {r.gsd_cm:7.2f}cm "
                f"{r.px_standing:10.1f} {r.px_prone:10.1f}  "
                f"{r.footprint_m[0]:5.0f}x{r.footprint_m[1]:<5.0f}m  {bucket(worst)}"
            )
        print()

    print("Read the px columns, then set your eval size buckets in eval.py to match.")
    print("If your operating regime lands under 16 px, no amount of model tuning saves")
    print("you -- change the lens, drop altitude, or add thermal.\n")


if __name__ == "__main__":
    main()
