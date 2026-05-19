"""Drive a full atlas bake.

Auto-discovers (region, tech) pairs from build_regulations.json, skips
non-spatial techs (EV) and NUTS-3 sub-regions whose value is already
absorbed into the parent country bake's Wind Priority Area overlay, and
runs `build_buildable_rasters.py` once per remaining pair.

Already-baked entries (present in `public/data/buildable/manifest.json`)
are skipped unless --overwrite is passed.

Usage
-----
    python scripts/bake_all.py [--mode strictest] [--resolution 250]
                               [--skip-natura] [--overwrite] [--dry-run]
                               [--only-tech wind]
                               [--exclude-region DE5,DE6]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
RULES_PATH = REPO / "public" / "data" / "build_regulations.json"
MANIFEST_PATH = REPO / "public" / "data" / "buildable" / "manifest.json"
RASTER_SCRIPT = Path(__file__).with_name("build_buildable_rasters.py")


# Techs that produce meaningful spatial rasters. EV is purely about charging
# mandates / tax credits and has no spatial setback semantics.
SPATIAL_TECHS = {"wind", "solar"}


# Sub-region NUTS-3 codes whose only contribution is membership in the
# Wind Priority Area set; the parent country bake already pulls those
# codes through `_load_wind_priority_areas()`. Baking each individually
# would just duplicate the parent raster.
def _is_absorbed_subregion(nuts: str) -> bool:
    if nuts.startswith("EL") and len(nuts) > 2:
        return True
    if nuts.startswith("IE") and len(nuts) > 2:
        return True
    return False


def _enumerate_pairs() -> list[tuple[str, str]]:
    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))["rules"]
    pairs: Counter[tuple[str, str]] = Counter()
    for r in rules:
        nuts = (r.get("nuts") or "").strip().upper()
        tech = (r.get("kind") or "").strip().lower()
        if not nuts or not tech:
            continue
        if tech not in SPATIAL_TECHS:
            continue
        if _is_absorbed_subregion(nuts):
            continue
        if nuts == "NAT":
            continue
        if nuts == "DEU":
            nuts = "DE"
        pairs[(nuts, tech)] += 1
    return sorted(pairs)


def _baked_keys() -> set[str]:
    if not MANIFEST_PATH.exists():
        return set()
    try:
        m = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return set()
    return set(m.get("bakes", {}).keys())


def _bake_key(region: str, tech: str, mode: str, res: int) -> str:
    return f"{region}_{tech}_{mode}_{res}m"


def main() -> int:
    ap = argparse.ArgumentParser(description="Bake the full atlas.")
    ap.add_argument("--mode", default="strictest", choices=["strictest", "latest", "binding"])
    ap.add_argument("--resolution", type=int, default=250)
    ap.add_argument("--skip-natura", action="store_true", default=True,
                    help="Default: skip Natura/CDDA layers (manual download).")
    ap.add_argument("--with-natura", dest="skip_natura", action="store_false",
                    help="Include Natura/CDDA exclusions (requires manual gpkg).")
    ap.add_argument("--overwrite", action="store_true",
                    help="Re-bake even if already present in the manifest.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the plan and exit; do not run anything.")
    ap.add_argument("--only-tech", choices=["wind", "solar"], default=None)
    ap.add_argument("--exclude-region", default="",
                    help="Comma-separated NUTS codes to skip (e.g. 'DE5,DE6').")
    args = ap.parse_args()

    excluded = {x.strip().upper() for x in args.exclude_region.split(",") if x.strip()}
    pairs = _enumerate_pairs()
    if args.only_tech:
        pairs = [p for p in pairs if p[1] == args.only_tech]
    if excluded:
        pairs = [p for p in pairs if p[0] not in excluded]

    baked = set() if args.overwrite else _baked_keys()
    todo = [p for p in pairs if _bake_key(p[0], p[1], args.mode, args.resolution) not in baked]
    skipped = [p for p in pairs if p not in todo]

    print(f"[plan] {len(pairs)} candidate pairs, "
          f"{len(skipped)} already baked, {len(todo)} to bake.")
    print(f"[plan] mode={args.mode}, resolution={args.resolution} m, "
          f"skip_natura={args.skip_natura}")
    for region, tech in todo:
        print(f"        TODO  {region:<6s} {tech}")
    for region, tech in skipped:
        print(f"        skip  {region:<6s} {tech}  (already in manifest)")

    if args.dry_run:
        return 0

    failures: list[tuple[str, str, str]] = []
    started = time.monotonic()
    for i, (region, tech) in enumerate(todo, 1):
        print(f"\n[{i}/{len(todo)}]  baking {region} {tech} ...")
        cmd = [
            sys.executable, str(RASTER_SCRIPT),
            "--region", region,
            "--tech", tech,
            "--mode", args.mode,
            "--resolution", str(args.resolution),
        ]
        if args.skip_natura:
            cmd.append("--skip-natura")
        if args.overwrite:
            cmd.append("--overwrite")

        t0 = time.monotonic()
        proc = subprocess.run(cmd, cwd=str(REPO))
        dt = time.monotonic() - t0
        if proc.returncode != 0:
            print(f"[fail] {region} {tech}  exit={proc.returncode}  ({dt:.1f}s)")
            failures.append((region, tech, f"exit={proc.returncode}"))
        else:
            print(f"[done] {region} {tech}  ({dt:.1f}s)")

    total = time.monotonic() - started
    print(f"\n[summary] baked {len(todo) - len(failures)}/{len(todo)} pairs "
          f"in {total/60:.1f} min")
    if failures:
        print("[summary] failures:")
        for r, t, msg in failures:
            print(f"          {r:<6s} {t:<6s} {msg}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
