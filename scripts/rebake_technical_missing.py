"""Re-bake buildable-land rasters that lack the technical (policy + geography) layer.

Skips entries that already have *_technical_availability.png. Does not use
--overwrite when policy outputs exist; build_buildable_rasters.py re-runs
automatically when technical PNGs are missing.

Usage:
    python -u scripts/rebake_technical_missing.py
    python -u scripts/rebake_technical_missing.py --exclude FR,IE
    python -u scripts/rebake_technical_missing.py --small-first
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "public" / "data" / "buildable" / "manifest.json"
OUT_DIR = REPO / "public" / "data" / "buildable"
RASTER_SCRIPT = Path(__file__).with_name("build_buildable_rasters.py")


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)


def missing_technical_keys() -> list[str]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    missing: list[str] = []
    for key, entry in manifest.get("bakes", {}).items():
        sidecar = entry.get("sidecar", "")
        stem = Path(sidecar).stem
        if not (OUT_DIR / f"{stem}_technical_availability.png").exists():
            missing.append(key)
    return missing


def parse_key(key: str) -> tuple[str, str, str, int]:
    parts = key.rsplit("_", 3)
    if len(parts) != 4:
        raise ValueError(f"Unexpected bake key: {key}")
    region, tech, mode, res = parts
    resolution_m = int(res.removesuffix("m"))
    return region, tech, mode, resolution_m


def region_km2(key: str) -> float:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return float(manifest.get("bakes", {}).get(key, {}).get("region_km2", 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exclude", default="", help="Comma-separated region prefixes to skip (e.g. FR,IE)")
    ap.add_argument(
        "--small-first",
        action="store_true",
        help="Bake smallest regions first (leave FR/EL for last)",
    )
    args = ap.parse_args()
    excluded = {x.strip().upper() for x in args.exclude.split(",") if x.strip()}

    todo = missing_technical_keys()
    if excluded:
        todo = [k for k in todo if not any(k.startswith(ex) for ex in excluded)]
    if args.small_first:
        todo.sort(key=lambda k: (region_km2(k), k))
    else:
        todo.sort()

    if not todo:
        log("All manifest entries already have technical rasters.")
        return 0

    log(f"{len(todo)} bake(s) missing technical layer.")
    for key in todo:
        log(f"  pending  {key}  ({region_km2(key):,.0f} km²)")

    failures: list[tuple[str, str]] = []
    started = time.monotonic()

    for i, key in enumerate(todo, 1):
        region, tech, mode, resolution_m = parse_key(key)
        km2 = region_km2(key)
        log(f"START [{i}/{len(todo)}] {key}  ({km2:,.0f} km²)")
        cmd = [
            sys.executable,
            "-u",
            str(RASTER_SCRIPT),
            "--region", region,
            "--tech", tech,
            "--mode", mode,
            "--resolution", str(resolution_m),
            "--skip-natura",
        ]
        t0 = time.monotonic()
        proc = subprocess.run(cmd, cwd=str(REPO))
        dt = time.monotonic() - t0
        tech_png = OUT_DIR / f"{key}_technical_availability.png"
        if proc.returncode != 0:
            log(f"FAIL  {key} exit={proc.returncode} ({dt:.0f}s)")
            failures.append((key, f"exit={proc.returncode}"))
        elif not tech_png.exists():
            log(f"FAIL  {key} no technical PNG after {dt:.0f}s (skipped by bake script?)")
            failures.append((key, "no technical PNG"))
        else:
            log(f"DONE  {key} ({dt / 60:.1f} min)")

    total = time.monotonic() - started
    ok = len(todo) - len(failures)
    remaining = len(missing_technical_keys())
    log(f"Summary: {ok}/{len(todo)} succeeded in {total / 60:.1f} min; {remaining} still missing")
    if failures:
        for key, msg in failures:
            log(f"  {key}: {msg}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
