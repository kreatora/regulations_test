#!/usr/bin/env python3
"""Generate atlite-style *_availability.png from existing *_values.png bakes.

Use this when availability overlays were added after the original bake, or when
you only need to refresh the green map layer without re-running OSM extraction.

    python scripts/generate_availability_pngs.py
    python scripts/generate_availability_pngs.py --key DE2_wind_strictest_250m
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "data" / "buildable"

sys.path.insert(0, str(ROOT / "scripts"))
from build_buildable_rasters import write_png_availability  # noqa: E402


def patch_sidecar(sidecar_path: Path) -> None:
    data = json.loads(sidecar_path.read_text())
    stats = data.get("pixel_stats", {})
    if stats and "eligible_share" not in stats and "buildable_fraction_of_region" in stats:
        stats["eligible_share"] = stats["buildable_fraction_of_region"]
        data["pixel_stats"] = stats
        sidecar_path.write_text(json.dumps(data, indent=2) + "\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Build availability PNGs from values PNGs.")
    p.add_argument("--key", help="Single bake key (e.g. DE2_wind_strictest_250m)")
    args = p.parse_args(argv)

    Image.MAX_IMAGE_PIXELS = None

    if args.key:
        values_files = [OUTPUT_DIR / f"{args.key}_values.png"]
    else:
        values_files = sorted(OUTPUT_DIR.glob("*_values.png"))

    if not values_files:
        print("[generate] no *_values.png files found")
        return 1

    for values_path in values_files:
        if not values_path.exists():
            print(f"[generate] skip missing {values_path.name}")
            continue
        key = values_path.name.replace("_values.png", "")
        avail_path = OUTPUT_DIR / f"{key}_availability.png"
        sidecar_path = OUTPUT_DIR / f"{key}.json"

        arr = np.array(Image.open(values_path))
        write_png_availability(arr, avail_path)
        if sidecar_path.exists():
            patch_sidecar(sidecar_path)
        print(f"[ok] {avail_path.name} ({arr.shape[1]}×{arr.shape[0]})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
