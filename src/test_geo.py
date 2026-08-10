"""Sanity checks for the pixel->ground projection.

Run: python -m src.test_geo
These are the checks that catch sign-convention bugs, which are the entire
risk in this file. A flipped sign here puts the payload the same distance on
the WRONG SIDE of the victim, and it looks perfectly plausible in a demo until
someone measures it.
"""

from __future__ import annotations

import math

from src.infer import CameraModel, haversine_m, pixel_to_ground

CAM = CameraModel(hfov_deg=66.0, width=2304, height=1296)
LAT, LON = 23.0225, 72.5714  # Ahmedabad
TOL = 1.0  # metres


def check(name: str, got, want, tol=TOL):
    ok = abs(got - want) <= tol
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: got {got:.2f}, want {want:.2f} (+-{tol})")
    return ok


def main() -> int:
    ok = True
    print("\npixel -> ground projection checks\n")

    # 1. Nadir, image centre -> directly under the drone.
    r = pixel_to_ground(CAM.width / 2, CAM.height / 2, CAM, LAT, LON, 100, -90, 0)
    assert r, "nadir centre must hit the ground"
    d = haversine_m(LAT, LON, r[0], r[1])
    ok &= check("nadir centre offset from drone", d, 0.0, 0.5)
    ok &= check("nadir centre slant range", r[2], 100.0, 0.5)

    # 2. 45deg forward-looking, centre pixel -> exactly alt metres ahead.
    r = pixel_to_ground(CAM.width / 2, CAM.height / 2, CAM, LAT, LON, 100, -45, 0)
    assert r
    d = haversine_m(LAT, LON, r[0], r[1])
    ok &= check("45deg centre ground distance (= alt)", d, 100.0)
    ok &= check("45deg centre slant range (alt*sqrt2)", r[2], 100 * math.sqrt(2))
    dlon_m = (r[1] - LON) * math.pi / 180 * 6378137 * math.cos(math.radians(LAT))
    ok &= check("45deg heading North -> east offset ~0", dlon_m, 0.0)
    print(f"  [{'PASS' if r[0] > LAT else 'FAIL'}] heading North -> latitude increases")
    ok &= r[0] > LAT

    # 3. Heading East (yaw=90) must move the target East, not North.
    r = pixel_to_ground(CAM.width / 2, CAM.height / 2, CAM, LAT, LON, 100, -45, 90)
    assert r
    dlat_m = (r[0] - LAT) * math.pi / 180 * 6378137
    dlon_m = (r[1] - LON) * math.pi / 180 * 6378137 * math.cos(math.radians(LAT))
    ok &= check("yaw=90 north offset ~0", dlat_m, 0.0)
    ok &= check("yaw=90 east offset = alt", dlon_m, 100.0)

    # 4. Horizon / sky must return None, never a bogus coordinate.
    r = pixel_to_ground(CAM.width / 2, 0, CAM, LAT, LON, 100, 0.0, 0)
    print(f"  [{'PASS' if r is None else 'FAIL'}] level camera, top of frame -> None (got {r})")
    ok &= r is None

    # 5. Nadir: a pixel offset right of centre must land East when heading North.
    off = CAM.width / 2 + 200
    r = pixel_to_ground(off, CAM.height / 2, CAM, LAT, LON, 100, -90, 0)
    assert r
    dlon_m = (r[1] - LON) * math.pi / 180 * 6378137 * math.cos(math.radians(LAT))
    expected = 200 / CAM.fx * 100  # similar triangles at nadir
    ok &= check("nadir +200px right -> east offset", dlon_m, expected)

    # 6. GSD cross-check against src/gsd.py at nadir.
    # NOTE: measured as a direct lon->metre offset, not via haversine.
    # haversine's (1 - cos(dlon)) term suffers catastrophic cancellation at
    # centimetre scale and returns 0. It is correct at the ~metre scale the
    # TemporalConfirmer uses it for, but do not trust it for sub-metre work.
    from src.gsd import compute
    g = compute(66.0, 2304, 1296, 100, 0)
    one_px = pixel_to_ground(CAM.width / 2 + 1, CAM.height / 2, CAM, LAT, LON, 100, -90, 0)
    assert one_px
    d_cm = (one_px[1] - LON) * math.pi / 180 * 6378137 * math.cos(math.radians(LAT)) * 100
    ok &= check("1px ground offset == gsd.py GSD (cm)", d_cm, g.gsd_cm, 0.05)

    print(f"\n{'ALL CHECKS PASSED' if ok else 'FAILURES PRESENT -- do not fly this'}\n")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
