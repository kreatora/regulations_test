"""Geographic baseline layers for the technical buildable-land model.

Policy-only model: coded setback rules on coarse OSM layers (landuse=residential).
Technical model: policy setbacks on all buildings/settlements + geographic
exclusions (water, forest, nature reserves, steep slope).
"""
from __future__ import annotations

import gzip
import io
import math
import struct
from pathlib import Path
from typing import Any

import numpy as np
import requests

EPSG_LAEA_EUROPE = 3035
EPSG_WGS84 = 4326
SKADI_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/v1"
CACHE_DEM = Path(__file__).resolve().parent / "_cache" / "dem"

# OSM layers always extracted for the technical model (beyond policy-driven layers).
TECHNICAL_OSM_LAYERS = frozenset({
    "buildings_mp", "buildings_pt", "settlement_areas", "water", "forest",
})

# Nature layers applied as geographic baseline when GPKG files are present.
TECHNICAL_NATURE_LAYERS = frozenset({
    "natura2000", "protected_areas", "national_parks",
})

TECHNICAL_OSM_SPEC: dict[str, tuple[str, str]] = {
    "buildings_mp": ("multipolygons", "building IS NOT NULL AND building NOT IN ('no','construction','proposed')"),
    "buildings_pt": ("points", "building IS NOT NULL AND building NOT IN ('no','construction','proposed')"),
    "settlement_areas": (
        "multipolygons",
        "landuse IN ('residential','commercial','industrial','retail')",
    ),
    "water": (
        "multipolygons",
        "natural IN ('water','bay','strait','wetland') OR landuse IN ('reservoir','basin','salt_pond')",
    ),
    "forest": (
        "multipolygons",
        "landuse IN ('forest','orchard','vineyard') OR natural IN ('wood','scrub')",
    ),
}


def merge_settlement_layers(features: dict[str, Any]):
    """Union building footprints + settlement landuse for residential setbacks."""
    import geopandas as gpd
    import pandas as pd

    parts = []
    for key in ("buildings_mp", "buildings_pt", "settlement_areas", "residential"):
        gdf = features.get(key)
        if gdf is not None and not gdf.empty:
            parts.append(gdf[["geometry"]])
    if not parts:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    merged = gpd.GeoDataFrame(
        pd.concat(parts, ignore_index=True), geometry="geometry", crs=parts[0].crs or "EPSG:4326"
    )
    return merged


def applied_rules_for_technical(applied: list[Any]) -> list[Any]:
    """Use merged settlements layer instead of coarse residential landuse."""
    from dataclasses import replace

    out = []
    for rule in applied:
        if rule.layer == "residential":
            out.append(replace(rule, layer="settlements"))
        else:
            out.append(rule)
    return out


def build_geographic_baseline_union(features: dict[str, Any], region_gdf) -> Any:
    """Hard geographic exclusions: water, forest, nature (full polygon, no buffer)."""
    import geopandas as gpd
    from shapely import make_valid
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union

    region_3035 = region_gdf.to_crs(EPSG_LAEA_EUROPE).copy()
    region_3035["geometry"] = region_3035.geometry.apply(
        lambda g: make_valid(g) if g is not None and not g.is_empty else g
    )

    parts = []
    for layer in ("water", "forest", *TECHNICAL_NATURE_LAYERS):
        gdf = features.get(layer)
        if gdf is None or gdf.empty:
            continue
        g3035 = gdf.to_crs(EPSG_LAEA_EUROPE).copy()
        g3035 = g3035[g3035.geometry.notna() & ~g3035.geometry.is_empty]
        if g3035.empty:
            continue
        g3035["geometry"] = g3035.geometry.apply(lambda g: make_valid(g))
        try:
            g3035 = gpd.clip(g3035, region_3035)
        except Exception as exc:
            print(f"[geo] baseline {layer}: clip failed ({exc}); using bounds filter")
            minx, miny, maxx, maxy = region_3035.total_bounds
            g3035 = g3035.cx[minx:maxx, miny:maxy]
        if g3035.empty:
            continue
        parts.append(unary_union(g3035.geometry.tolist()))
        print(f"[geo] baseline {layer}: {len(g3035)} feature(s)")

    if not parts:
        return GeometryCollection()
    return unary_union(parts)


def slope_exclusion_mask(
    region_gdf,
    transform,
    out_shape: tuple[int, int],
    max_slope_deg: float = 20.0,
) -> np.ndarray | None:
    """Raster mask (1=too steep) aligned to the bake grid. None if DEM unavailable."""
    import geopandas as gpd
    from pyproj import Transformer
    from rasterio.transform import rowcol
    from rasterio.warp import reproject, Resampling
    from rasterio.io import MemoryFile
    import rasterio

    minx, miny, maxx, maxy = region_gdf.total_bounds
    to_wgs = Transformer.from_crs(region_gdf.crs or EPSG_WGS84, EPSG_WGS84, always_xy=True)
    min_lng, min_lat = to_wgs.transform(minx, miny)
    max_lng, max_lat = to_wgs.transform(maxx, maxy)

    dem, dem_transform, dem_crs = _load_dem_mosaic(min_lat, min_lng, max_lat, max_lng)
    if dem is None:
        print("[geo] slope: DEM unavailable — skipping steep-terrain exclusion")
        return None

    height, width = out_shape
    dem_reproj = np.zeros((height, width), dtype="float32")

    with MemoryFile() as memf:
        with memf.open(
            driver="GTiff", width=dem.shape[1], height=dem.shape[0], count=1,
            dtype="float32", crs=dem_crs, transform=dem_transform,
        ) as src:
            src.write(dem.astype("float32"), 1)
            reproject(
                source=rasterio.band(src, 1),
                destination=dem_reproj,
                src_transform=dem_transform, src_crs=dem_crs,
                dst_transform=transform, dst_crs=f"EPSG:{EPSG_LAEA_EUROPE}",
                resampling=Resampling.bilinear,
            )

    dem_reproj = np.where(np.isfinite(dem_reproj), dem_reproj, np.nan)
    cell = abs(transform.a)
    dzdy, dzdx = np.gradient(dem_reproj, cell, cell)
    slope_deg = np.degrees(np.arctan(np.sqrt(dzdx * dzdx + dzdy * dzdy)))
    steep = np.isfinite(slope_deg) & (slope_deg > max_slope_deg)
    steep_px = int(steep.sum())
    if steep_px:
        print(f"[geo] slope: {steep_px} grid cell(s) steeper than {max_slope_deg}°")
    return steep.astype("uint8")


def _load_dem_mosaic(min_lat: float, min_lng: float, max_lat: float, max_lng: float):
    """Load SRTM Skadi tiles covering a WGS84 bbox into one float32 array."""
    import rasterio
    from rasterio.transform import from_bounds

    lat0 = int(math.floor(min(min_lat, max_lat)))
    lat1 = int(math.floor(max(min_lat, max_lat)))
    lng0 = int(math.floor(min(min_lng, max_lng)))
    lng1 = int(math.floor(max(min_lng, max_lng)))

    tiles = []
    for lat_i in range(lat0, lat1 + 1):
        for lng_i in range(lng0, lng1 + 1):
            tile = _fetch_skadi_tile(lat_i, lng_i)
            if tile is not None:
                tiles.append((lat_i, lng_i, tile))

    if not tiles:
        return None, None, None

    # Skadi tiles are 3601×3601 int16, 1°×1°, row 0 = north.
    res_deg = 1.0 / 3600.0
    out_w = int(math.ceil((max_lng - min_lng) / res_deg)) + 1
    out_h = int(math.ceil((max_lat - min_lat) / res_deg)) + 1
    mosaic = np.full((out_h, out_w), np.nan, dtype="float32")
    transform = from_bounds(min_lng, min_lat, max_lng, max_lat, out_w, out_h)

    for lat_i, lng_i, arr in tiles:
        tile_min_lng, tile_max_lat = lng_i, lat_i + 1
        tile_max_lng, tile_min_lat = lng_i + 1, lat_i
        # Map tile rows to mosaic indices (approximate paste).
        for r in range(arr.shape[0]):
            lat = tile_max_lat - r * res_deg
            if lat < min_lat or lat > max_lat:
                continue
            mr = int(round((max_lat - lat) / res_deg))
            if mr < 0 or mr >= out_h:
                continue
            for c in range(arr.shape[1]):
                lng = tile_min_lng + c * res_deg
                if lng < min_lng or lng > max_lng:
                    continue
                mc = int(round((lng - min_lng) / res_deg))
                if mc < 0 or mc >= out_w:
                    continue
                val = arr[r, c]
                if val < -1000:
                    continue
                mosaic[mr, mc] = float(val)

    return mosaic, transform, f"EPSG:{EPSG_WGS84}"


def _fetch_skadi_tile(lat_i: int, lng_i: int) -> np.ndarray | None:
    CACHE_DEM.mkdir(parents=True, exist_ok=True)
    ns = "N" if lat_i >= 0 else "S"
    ew = "E" if lng_i >= 0 else "W"
    rel = f"{ns}{abs(lat_i):02d}/{ns}{abs(lat_i):02d}{ew}{abs(lng_i):03d}.hgt.gz"
    cache_path = CACHE_DEM / rel.replace("/", "_")
    if cache_path.exists():
        raw = cache_path.read_bytes()
    else:
        url = f"{SKADI_BASE}/{rel}"
        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code != 200:
                return None
            raw = resp.content
            cache_path.write_bytes(raw)
        except Exception as exc:
            print(f"[geo] DEM fetch failed {url}: {exc}")
            return None

    try:
        data = gzip.decompress(raw)
        side = int(math.sqrt(len(data) / 2))
        if side * side * 2 != len(data):
            return None
        arr = np.frombuffer(data, dtype=">i2").reshape(side, side).astype("float32")
        return arr
    except Exception as exc:
        print(f"[geo] DEM parse failed {rel}: {exc}")
        return None
