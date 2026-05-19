"""
Buildable-land raster pipeline (NREL-style) for the Climate Policy Atlas.

Bakes a per-region, per-technology, per-rule-mode raster showing which land
*passes* every applicable build-code setback, exclusion, and protected-area
rule from `public/data/build_regulations.json`. Inspired by Lopes et al. 2023
(NREL, "Structure Setback" CONUS rasters).

Pipeline stages (each is idempotent / cached):

    1. Resolve target region (NUTS code) -> bounding box & polygon (GISCO).
    2. Select applicable rules from build_regulations.json
       (region-specific + federal + EU-wide that apply).
       - Resolve multipliers ("4 x H") to metres via configurable
         turbine geometry (defaults: H=150 m, blade=60 m, hub=90 m).
       - Pick strictest / latest / binding-only per the chosen mode.
    3. Download OSM PBF extract (Geofabrik regional URL) [cached].
    4. Extract OSM feature layers needed by the applicable rules
       (residential, motorway, primary roads, airport, railway,
       military, transmission, radar).
    5. Load external exclusion polygons:
         - Natura 2000 (manual one-time GPKG download from EEA)
         - CDDA protected areas (manual one-time GPKG download from EEA)
       (Both expected at scripts/_cache/external/<filename>.)
    6. Buffer each feature by its applicable setback (in EPSG:3035 LAEA
       Europe so metric distances are accurate).
    7. Rasterize union(exclusions) at the chosen resolution into the
       region polygon.
    8. For wind on regions with Wind Priority Areas, add WPA polygons
       back as additive (always-buildable) regardless of setbacks.
    9. Output:
         - a "values" PNG (uint8: 0=excluded, 128=in-WPA, 255=buildable)
           for analytical use,
         - a "styled" PNG (RGBA: NREL-orange where buildable, alpha 0
           elsewhere) for direct overlay on D3 SVG,
         - a sidecar JSON with WGS84/Mercator bounding boxes, rule
           provenance, and metadata,
         - update of public/data/buildable/manifest.json.

Run from the repo root:

    python scripts/build_buildable_rasters.py --region DE2 --tech wind --mode strictest

Smoke test on a small region before scaling:

    python scripts/build_buildable_rasters.py --region IE --tech wind --mode strictest --smoke

See scripts/README_pipeline.md for installation, external downloads,
and troubleshooting on Windows.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import numpy as np
import requests
from PIL import Image
from tqdm import tqdm

# Heavy geo deps are imported lazily so `--help` works without them.
# These are imported by the functions that need them.

# =========================================================================
# Constants & lookups
# =========================================================================

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = REPO_ROOT / "public" / "data"
BUILD_REGS_JSON = PUBLIC_DATA_DIR / "build_regulations.json"
OUTPUT_DIR = PUBLIC_DATA_DIR / "buildable"
CACHE_DIR = REPO_ROOT / "scripts" / "_cache"
CACHE_PBF = CACHE_DIR / "pbf"
CACHE_NUTS = CACHE_DIR / "nuts"
CACHE_EXTERNAL = CACHE_DIR / "external"
CACHE_FEATURES = CACHE_DIR / "features"

# Geofabrik regional PBF URLs by region NUTS code.
# Bayern (DE2) is a regional extract; other Bundeslaender add as needed.
GEOFABRIK_PBF: dict[str, str] = {
    "DE": "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
    "DE1": "https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf",
    "DE2": "https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf",
    "DE3": "https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf",
    "DE4": "https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf",
    "DE5": "https://download.geofabrik.de/europe/germany/bremen-latest.osm.pbf",
    "DE6": "https://download.geofabrik.de/europe/germany/hamburg-latest.osm.pbf",
    "DE7": "https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf",
    "DE8": "https://download.geofabrik.de/europe/germany/mecklenburg-vorpommern-latest.osm.pbf",
    "DE9": "https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf",
    "DEA": "https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf",
    "DEB": "https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf",
    "DEC": "https://download.geofabrik.de/europe/germany/saarland-latest.osm.pbf",
    "DED": "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf",
    "DEE": "https://download.geofabrik.de/europe/germany/sachsen-anhalt-latest.osm.pbf",
    "DEF": "https://download.geofabrik.de/europe/germany/schleswig-holstein-latest.osm.pbf",
    "DEG": "https://download.geofabrik.de/europe/germany/thueringen-latest.osm.pbf",
    "EL": "https://download.geofabrik.de/europe/greece-latest.osm.pbf",
    "IE": "https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf",
    "FR": "https://download.geofabrik.de/europe/france-latest.osm.pbf",
}

# GISCO NUTS GeoJSON URLs (we use 1M scale, EPSG:4326).
GISCO_NUTS_BASE = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson"
NUTS_LEVEL_BY_CODE_LEN = {2: 0, 3: 1, 4: 2, 5: 3}


@dataclass
class TurbineGeometry:
    """Default turbine geometry used to convert multiplier rules to metres.

    Defaults follow Lopes et al. 2023 (NREL) modern-onshore reference:
    150 m tip, 60 m blade -> 90 m hub.
    """
    tip_height_m: float = 150.0
    blade_length_m: float = 60.0

    @property
    def hub_height_m(self) -> float:
        return self.tip_height_m - self.blade_length_m


# Rule variable -> the OSM layer / external layer it should buffer.
# Each entry: (layer_key, human_label).
# 'layer_key' values match keys in extract_osm_features() and
# load_external_exclusions().
VARIABLE_TO_LAYER: dict[str, tuple[str, str]] = {
    "1_distance_residential buildings": ("residential", "Residential areas"),
    "2_distance_motorway":             ("motorway",    "Motorways"),
    "5_distance_airports":             ("airport",     "Airports"),
    "6_distance_transmission lines":   ("transmission","Transmission lines"),
    "7_distance_railways":             ("railway",     "Railways"),
    "8_distance_military areas":       ("military",    "Military areas"),
    # 9_distance_others has heterogeneous conditions; matched by keyword
    # in the condition string (see CONDITION_KEYWORDS_9).
    # 15_exclusion area = always-exclude polygon; matched by condition.
}

# For variable 9 ("distance to others") and 15 ("exclusion area"), the
# rule's `condition` string says what is being constrained.
# These keyword tables map condition keywords -> layer.
CONDITION_KEYWORDS_9: dict[str, str] = {
    "natura 2000":      "natura2000",
    "nature reserve":   "protected_areas",
    "national park":    "national_parks",
    "bird":             "natura2000_spa",   # Special Protection Areas
    "species":          "protected_areas",
    "radar":            "radar",
    "geres":            "radar",            # Bavarian seismic-array proxy
    "scenic":           "protected_areas",
    "landscape":        "protected_areas",
    "monument":         "protected_areas",
    "water":            "water_protection",
}
CONDITION_KEYWORDS_15: dict[str, str] = {
    "natura 2000":      "natura2000",
    "national park":    "national_parks",
    "nature reserve":   "protected_areas",
    "scenic":           "protected_areas",
    "landscape":        "protected_areas",
    "habitat":          "natura2000",
    "bird":             "natura2000_spa",
    "water":            "water_protection",
    "military":         "military",
    "monument":         "protected_areas",
}

# Styled-PNG colour palette (aligned with the Climate Policy Atlas
# forest-green theme defined in src/shared.css).
# Inverted from NREL: we colour the *excluded* land (no-build zones) so a
# viewer reads "the red blobs are where regulations forbid construction".
EXCLUDED_RED_RGBA = (155, 60, 50, 190)        # muted brick red, ~75% alpha
WPA_GREEN_RGBA   = (141, 192, 133, 140)       # site --color-primary-lighter
BUILDABLE_RGBA   = (0, 0, 0, 0)               # transparent (rules permit)


# =========================================================================
# Configuration & CLI
# =========================================================================

@dataclass
class Config:
    region: str
    tech: str            # 'wind' | 'solar' | 'ev'
    mode: str            # 'strictest' | 'latest' | 'binding'
    resolution_m: int    # raster cell size in metres (250 default)
    turbine: TurbineGeometry
    smoke: bool          # if True, run with synthetic / empty OSM (mechanics-only)
    skip_natura: bool    # if True, skip external exclusion-polygon layers
    overwrite: bool      # if True, re-bake even if outputs exist


def parse_args(argv: list[str] | None = None) -> Config:
    p = argparse.ArgumentParser(description="Buildable-land raster pipeline (NREL-style).")
    p.add_argument("--region", required=True,
                   help="NUTS code: DE2 (Bayern), DE, EL, IE, FR, ...")
    p.add_argument("--tech", default="wind", choices=["wind", "solar", "ev"])
    p.add_argument("--mode", default="strictest",
                   choices=["strictest", "latest", "binding"])
    p.add_argument("--resolution", type=int, default=250,
                   help="Raster cell size in metres (default 250).")
    p.add_argument("--turbine-tip-height", type=float, default=150.0)
    p.add_argument("--turbine-blade-length", type=float, default=60.0)
    p.add_argument("--smoke", action="store_true",
                   help="Skip OSM download; bake an empty 'mechanics-only' raster.")
    p.add_argument("--skip-natura", action="store_true",
                   help="Skip Natura 2000 / CDDA exclusions (faster, lower fidelity).")
    p.add_argument("--overwrite", action="store_true",
                   help="Re-bake even if outputs already exist.")
    args = p.parse_args(argv)
    return Config(
        region=args.region.upper(),
        tech=args.tech,
        mode=args.mode,
        resolution_m=args.resolution,
        turbine=TurbineGeometry(
            tip_height_m=args.turbine_tip_height,
            blade_length_m=args.turbine_blade_length,
        ),
        smoke=args.smoke,
        skip_natura=args.skip_natura,
        overwrite=args.overwrite,
    )


# =========================================================================
# Rule selection
# =========================================================================

@dataclass
class AppliedRule:
    """A rule resolved into a numeric setback in metres against a layer."""
    variable: str
    layer: str
    setback_m: float           # 0 means 'exclude entire layer' (e.g. Natura 2000)
    condition: str | None
    year: int | None
    legally_binding: bool
    source_name: str | None
    source_link: str | None
    raw_value: float | None
    raw_unit: str | None
    multiplier_resolved: bool  # True if a 'X x H' multiplier was converted


def load_rules() -> dict[str, Any]:
    if not BUILD_REGS_JSON.exists():
        sys.exit(
            f"Could not find {BUILD_REGS_JSON}. Run "
            f"`python scripts/extract_build_regulations.py` first."
        )
    with BUILD_REGS_JSON.open(encoding="utf-8") as f:
        return json.load(f)


def _country_for_region(region: str) -> str | None:
    """Map a NUTS code prefix to its country."""
    if region.startswith("DE"): return "Germany"
    if region.startswith("EL"): return "Greece"
    if region.startswith("IE"): return "Ireland"
    if region.startswith("FR"): return "France"
    return None


def _make_valid(geom):
    """Return a valid version of `geom`, repairing self-intersections.
    Falls back to buffer(0) if shapely.make_valid is unavailable.
    """
    if geom is None or geom.is_empty:
        return geom
    if geom.is_valid:
        return geom
    try:
        from shapely.validation import make_valid as _mv
        return _mv(geom)
    except Exception:
        try:
            return geom.buffer(0)
        except Exception:
            return geom


def _rule_applies_to_region(rule: dict[str, Any], region: str) -> bool:
    """A rule applies if its NUTS is the region itself, an ancestor
    (e.g. 'DE' applies to 'DE2'), or NULL country-level for the country.
    """
    rn = (rule.get("nuts") or "").upper()
    if not rn:
        return False
    return region == rn or region.startswith(rn) or rn == _country_letters(region)


def _country_letters(region: str) -> str:
    """First two letters of a NUTS code (the country prefix)."""
    return region[:2] if len(region) >= 2 else region


def _resolve_setback_metres(
    rule: dict[str, Any], turbine: TurbineGeometry
) -> tuple[float | None, bool]:
    """Convert a rule's first numeric value to metres.
    Returns (setback_m, multiplier_was_resolved).
    Returns (None, _) if the rule has no usable metric value
    (e.g. dB(A) noise, hours of shadow flicker, percentages).
    """
    if not rule.get("values"):
        return None, False
    v = rule["values"][0]
    raw = v.get("value")
    unit = (v.get("unit") or "").strip().lower()
    if raw is None:
        return None, False

    # Multipliers of turbine height/blade.
    if "time of height" in unit or "times of height" in unit \
            or "x h" in unit or "x height" in unit \
            or "of height of wind turbine" in unit \
            or "of height and blade" in unit:
        if "blade" in unit:
            return float(raw) * (turbine.tip_height_m + turbine.blade_length_m), True
        return float(raw) * turbine.tip_height_m, True

    # Direct metric units.
    if unit in {"m", "metre", "meter", "metres", "meters"}:
        return float(raw), False
    if unit in {"km", "kilometre", "kilometer"}:
        return float(raw) * 1000.0, False
    if unit in {"cm", "centimetre", "centimeter"}:
        return float(raw) / 100.0, False

    # Non-metric (dB(A), hours, percent, ...) - not a buildable-land setback.
    return None, False


def _derive_layer(rule: dict[str, Any]) -> str | None:
    """Map a rule to an OSM/external layer key based on its variable/condition.
    Variable 15 / 9 rules disambiguate via the condition string AND the
    rule's text fields (some rules omit the value list entirely).
    """
    var = rule["variable"]
    if var in VARIABLE_TO_LAYER:
        return VARIABLE_TO_LAYER[var][0]
    table = (CONDITION_KEYWORDS_15 if var.startswith("15_")
             else CONDITION_KEYWORDS_9 if var.startswith("9_")
             else None)
    if table is None:
        return None
    values = rule.get("values") or []
    cond = (values[0].get("condition") if values else None) or ""
    haystack = " ".join([
        cond,
        rule.get("text_translation") or "",
        rule.get("text_original") or "",
        rule.get("source_name") or "",
    ]).lower()
    for kw, layer in table.items():
        if kw in haystack:
            return layer
    return None


def select_applicable_rules(
    rules_payload: dict[str, Any], cfg: Config
) -> list[AppliedRule]:
    """Filter rules by region+tech+mode, resolve setbacks, drop unmappable ones."""
    candidates: list[AppliedRule] = []
    country = _country_for_region(cfg.region)

    for r in rules_payload["rules"]:
        if r.get("kind") != cfg.tech:
            continue
        if r.get("country") != country:
            continue
        if not _rule_applies_to_region(r, cfg.region):
            continue
        if (r.get("active") or "").lower() == "inactive":
            continue
        if cfg.mode == "binding" and (r.get("legally_binding") or "").lower() != "yes":
            continue

        layer = _derive_layer(r)
        if not layer:
            continue

        setback_m: float | None
        resolved: bool
        # Variable 15 = exclusion area (entire layer is no-build, no buffer).
        if r["variable"].startswith("15_"):
            setback_m, resolved = 0.0, False
        else:
            setback_m, resolved = _resolve_setback_metres(r, cfg.turbine)
            if setback_m is None:
                continue  # not a metric setback (e.g. dB, hours, %)

        v = (r.get("values") or [{}])[0]
        candidates.append(AppliedRule(
            variable=r["variable"],
            layer=layer,
            setback_m=float(setback_m),
            condition=v.get("condition"),
            year=r.get("year_decision"),
            legally_binding=(r.get("legally_binding") or "").lower() == "yes",
            source_name=r.get("source_name"),
            source_link=r.get("source_link"),
            raw_value=v.get("value"),
            raw_unit=v.get("unit"),
            multiplier_resolved=resolved,
        ))

    # Mode reduction: pick one rule per (variable, layer, condition-bucket).
    bucketed: dict[tuple[str, str], list[AppliedRule]] = {}
    for rule in candidates:
        bucketed.setdefault((rule.variable, rule.layer), []).append(rule)

    chosen: list[AppliedRule] = []
    for (var, layer), group in bucketed.items():
        if cfg.mode == "strictest":
            chosen.append(max(group, key=lambda x: x.setback_m))
        elif cfg.mode == "latest":
            chosen.append(max(group, key=lambda x: (x.year or 0)))
        else:  # binding
            binders = [g for g in group if g.legally_binding]
            chosen.append(max(binders or group, key=lambda x: x.setback_m))

    chosen.sort(key=lambda x: (-x.setback_m, x.variable))
    return chosen


# =========================================================================
# Source-data downloads (cached)
# =========================================================================

def _ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def _stream_download(url: str, target: Path, label: str) -> Path:
    """Download with progress bar; idempotent."""
    if target.exists() and target.stat().st_size > 0:
        return target
    _ensure_dir(target.parent)
    print(f"[download] {label}: {url}")
    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        tmp = target.with_suffix(target.suffix + ".tmp")
        with tmp.open("wb") as f, tqdm(total=total, unit="B", unit_scale=True,
                                       desc=label, leave=False) as pbar:
            for chunk in resp.iter_content(chunk_size=2 << 20):  # 2 MiB
                f.write(chunk)
                pbar.update(len(chunk))
        tmp.replace(target)
    return target


def download_pbf(region: str) -> Path:
    """Download the regional Geofabrik PBF for the given NUTS code.
    Falls back to the country PBF if no regional URL is registered.
    """
    url = GEOFABRIK_PBF.get(region) or GEOFABRIK_PBF.get(_country_letters(region))
    if not url:
        sys.exit(f"No Geofabrik PBF URL registered for region '{region}'. "
                 f"Add it to GEOFABRIK_PBF and retry.")
    fname = url.rsplit("/", 1)[-1]
    return _stream_download(url, CACHE_PBF / fname, label=f"PBF {region}")


def download_nuts_geojson(level: int) -> Path:
    """Download GISCO NUTS GeoJSON (1M scale, WGS84) for the given level."""
    url = f"{GISCO_NUTS_BASE}/NUTS_RG_01M_2021_4326_LEVL_{level}.geojson"
    target = CACHE_NUTS / f"NUTS_LEVL_{level}.geojson"
    return _stream_download(url, target, label=f"NUTS L{level}")


def get_region_polygon(region: str):
    """Return a GeoDataFrame with one row: the polygon of the given region.
    Picks the appropriate NUTS level based on code length.
    """
    import geopandas as gpd
    levels = [len(region) - 2, 3, 2, 1, 0]
    seen = set()
    for level in levels:
        if level < 0 or level > 3 or level in seen:
            continue
        seen.add(level)
        path = download_nuts_geojson(level)
        gdf = gpd.read_file(path)
        match = gdf[gdf["NUTS_ID"].str.upper() == region]
        if len(match):
            return match.copy()
    sys.exit(f"Region '{region}' not found in any NUTS GeoJSON level.")


# =========================================================================
# OSM feature extraction
# =========================================================================

def _features_cache_path(pbf_path: Path, layer: str) -> Path:
    """Stable cache path for a (pbf, layer) extraction result."""
    h = hashlib.sha1(f"{pbf_path.name}:{layer}".encode()).hexdigest()[:12]
    return CACHE_FEATURES / f"{pbf_path.stem}_{layer}_{h}.gpkg"


# GDAL's OSM driver exposes 5 standard layers from a .pbf:
#   points, lines, multilinestrings, multipolygons, other_relations.
# By default only a small set of tags are promoted to columns; the rest
# go into an HSTORE-encoded `other_tags` field. We point GDAL at a
# custom osmconf.ini so the tags we filter on (power, aeroway, military,
# landuse, man_made) are surfaced as their own columns.
_OSMCONF_INI = """\
[general]
use_custom_indexing=yes
report_all_nodes=no
report_all_ways=no

[points]
attributes=name,aeroway,power,man_made,military,landuse
unsignificant=created_by,converted_by,source,attribution
ignore=area,created_by,converted_by,source,attribution

[lines]
attributes=name,highway,railway,aerialway,power,aeroway,landuse,man_made,barrier
unsignificant=created_by,converted_by,source,attribution
ignore=area,created_by,converted_by,source,attribution

[multipolygons]
attributes=name,landuse,aeroway,leisure,natural,military,boundary,protect_class,protected,man_made,power
unsignificant=created_by,converted_by,source,attribution
ignore=created_by,converted_by,source,attribution
osm_way_id_in_multipolygons=yes

[multilinestrings]
attributes=name,railway,power,aeroway,boundary,type
"""


def _ensure_osmconf() -> Path:
    target = CACHE_DIR / "osmconf.ini"
    if not target.exists() or target.read_text(encoding="utf-8") != _OSMCONF_INI:
        target.write_text(_OSMCONF_INI, encoding="utf-8")
    return target


# Per-layer extraction spec: (gdal_layer, where_clause).
# The `where` clauses are SQLite-flavoured (GDAL OGR SQL).
_OSM_EXTRACT_SPEC: dict[str, tuple[str, str]] = {
    "residential":  ("multipolygons", "landuse = 'residential'"),
    "motorway":     ("lines",         "highway IN ('motorway','motorway_link','trunk','trunk_link')"),
    "primary_road": ("lines",         "highway IN ('primary','primary_link','secondary')"),
    "railway":      ("lines",         "railway = 'rail'"),
    "airport":      ("multipolygons", "aeroway = 'aerodrome'"),
    "military":     ("multipolygons", "landuse = 'military' OR military IS NOT NULL"),
    "transmission": ("lines",         "power = 'line'"),
    "radar":        ("points",        "man_made = 'radar'"),
}


def extract_osm_features(
    pbf_path: Path, layers_needed: set[str]
) -> dict[str, "gpd.GeoDataFrame"]:  # noqa: F821
    """Extract OSM feature layers from a PBF using GDAL's OSM driver
    via pyogrio. Each layer is cached to GeoPackage to avoid re-parsing.
    Returns {layer_key: GeoDataFrame in EPSG:4326}.
    """
    import geopandas as gpd

    out: dict[str, "gpd.GeoDataFrame"] = {}
    osm_layers = layers_needed - {
        "natura2000", "natura2000_spa", "protected_areas",
        "national_parks", "water_protection",
    }
    if not osm_layers:
        return out

    # GDAL needs to find our custom config via an env var.
    os.environ["OSM_CONFIG_FILE"] = str(_ensure_osmconf())

    for layer in sorted(osm_layers):
        cache_path = _features_cache_path(pbf_path, layer)
        if cache_path.exists():
            print(f"[osm] cache hit: {layer} -> {cache_path.name}")
            out[layer] = gpd.read_file(cache_path)
            continue

        spec = _OSM_EXTRACT_SPEC.get(layer)
        if spec is None:
            print(f"[osm] no extraction spec for layer '{layer}', skipping")
            out[layer] = _empty_gdf()
            continue

        print(f"[osm] extracting {layer}  (gdal={spec[0]}, where={spec[1]!r})")
        gdf = _read_pbf_layer(pbf_path, *spec)
        if gdf is None or gdf.empty:
            print(f"[osm]   (no features for {layer})")
            empty = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
            empty.to_file(cache_path, driver="GPKG")
            out[layer] = empty
            continue

        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326")
        gdf = gdf[["geometry"]].copy()
        gdf.to_file(cache_path, driver="GPKG")
        out[layer] = gdf
        print(f"[osm]   {len(gdf)} features cached -> {cache_path.name}")

    return out


def _read_pbf_layer(pbf_path: Path, gdal_layer: str, where: str):
    """Read one OSM layer from a PBF via pyogrio, applying a WHERE filter
    server-side so we don't pull millions of irrelevant features.
    """
    import geopandas as gpd
    import pyogrio
    try:
        df = pyogrio.read_dataframe(
            str(pbf_path), layer=gdal_layer, where=where,
            columns=[],  # we only need geometry; tags already filtered the WHERE
        )
    except Exception as exc:
        print(f"[osm]   pyogrio error reading {gdal_layer}/{where!r}: {exc}")
        return None
    if df is None or df.empty:
        return None
    if isinstance(df, gpd.GeoDataFrame):
        return df
    return gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")


# =========================================================================
# External exclusion polygons (Natura 2000 / CDDA / national parks)
# =========================================================================

EXTERNAL_GPKG_HINTS: dict[str, list[str]] = {
    "natura2000":      ["Natura2000_end2024.gpkg", "Natura2000_end2023.gpkg",
                        "Natura2000_end2022.gpkg", "natura2000.gpkg"],
    "natura2000_spa":  ["Natura2000_end2024.gpkg", "Natura2000_end2023.gpkg",
                        "Natura2000_end2022.gpkg", "natura2000.gpkg"],
    "protected_areas": ["CDDA_NationallyDesignatedAreas.gpkg", "cdda.gpkg"],
    "national_parks":  ["CDDA_NationallyDesignatedAreas.gpkg", "cdda.gpkg"],
    "water_protection":["water_protection.gpkg"],
}


def load_external_exclusions(
    layers_needed: set[str], region_bbox: tuple[float, float, float, float]
) -> dict[str, "gpd.GeoDataFrame"]:  # noqa: F821
    """Load Natura 2000 / CDDA polygons (manual EEA download), clipped to bbox.
    Returns {layer_key: GeoDataFrame in EPSG:4326}. Missing files print a warning.
    """
    import geopandas as gpd

    out: dict[str, "gpd.GeoDataFrame"] = {}
    needed = layers_needed & set(EXTERNAL_GPKG_HINTS.keys())
    if not needed:
        return out

    for layer in needed:
        path = _find_external_gpkg(layer)
        if path is None:
            print(f"[external] {layer}: no GPKG found in {CACHE_EXTERNAL}. "
                  f"See scripts/README_pipeline.md for manual EEA download.")
            out[layer] = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
            continue
        print(f"[external] loading {layer} from {path.name}")
        gdf = gpd.read_file(path, bbox=region_bbox)
        if layer == "natura2000_spa" and "SITETYPE" in gdf.columns:
            gdf = gdf[gdf["SITETYPE"].isin(["A", "C"])]  # SPA = bird-protection
        elif layer == "national_parks" and "SITETYPE" in gdf.columns:
            gdf = gdf[gdf.get("MAJORTYPE", "").astype(str).str.contains("National Park",
                                                                       case=False, na=False)]
        gdf = gdf.to_crs("EPSG:4326") if gdf.crs and gdf.crs.to_epsg() != 4326 else gdf
        out[layer] = gdf[["geometry"]].copy()
        print(f"[external]   {len(out[layer])} polygons in bbox")

    return out


def _find_external_gpkg(layer: str) -> Path | None:
    for fname in EXTERNAL_GPKG_HINTS.get(layer, []):
        p = CACHE_EXTERNAL / fname
        if p.exists():
            return p
    return None


# =========================================================================
# Buffer + rasterize
# =========================================================================

EPSG_LAEA_EUROPE = 3035   # ETRS89-extended / LAEA Europe (metric, equal-area)
EPSG_WEB_MERCATOR = 3857
EPSG_WGS84 = 4326


def buffer_and_union(
    features_by_layer: dict[str, "gpd.GeoDataFrame"],  # noqa: F821
    rules: list[AppliedRule],
    region_polygon: "gpd.GeoDataFrame",  # noqa: F821
):
    """For each rule, buffer its layer's features by the rule's setback (in
    EPSG:3035 metres) and return one unified exclusion GeoSeries in EPSG:3035.

    Rules with setback_m == 0 (variable 15) treat the entire layer as
    excluded (no buffer needed; the polygon itself is the exclusion).
    Empty layers contribute nothing.
    """
    import geopandas as gpd
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union

    region_3035 = region_polygon.to_crs(EPSG_LAEA_EUROPE)
    # Defensive: OSM region polygons can also have self-intersections.
    region_3035["geometry"] = region_3035.geometry.apply(_make_valid)
    region_geom = unary_union(region_3035.geometry.tolist())

    excl_geoms = []
    contributing: list[dict[str, Any]] = []

    for rule in rules:
        gdf = features_by_layer.get(rule.layer)
        if gdf is None or gdf.empty:
            contributing.append({**asdict(rule), "feature_count": 0,
                                 "applied": False, "reason": "no features in layer"})
            continue
        gdf_3035 = gdf.to_crs(EPSG_LAEA_EUROPE)
        # OSM polygons frequently contain self-intersections (e.g. badly drawn
        # residential boundaries). Fix them before any topological op,
        # otherwise shapely 2 raises TopologyException during clip / buffer.
        gdf_3035 = gdf_3035.copy()
        gdf_3035["geometry"] = gdf_3035.geometry.apply(_make_valid)
        gdf_3035 = gdf_3035[~gdf_3035.geometry.is_empty]
        if gdf_3035.empty:
            contributing.append({**asdict(rule), "feature_count": 0,
                                 "applied": False, "reason": "all features invalid"})
            continue
        try:
            gdf_3035 = gpd.clip(gdf_3035, region_geom)  # bbox-trim
        except Exception as exc:  # final safety net
            print(f"[warn] clip failed for layer {rule.layer}: {exc}; skipping this rule")
            contributing.append({**asdict(rule), "feature_count": int(len(gdf_3035)),
                                 "applied": False, "reason": f"clip failed: {exc}"})
            continue
        if gdf_3035.empty:
            contributing.append({**asdict(rule), "feature_count": 0,
                                 "applied": False, "reason": "no features in region"})
            continue

        if rule.setback_m > 0:
            buf = gdf_3035.buffer(rule.setback_m)
            geom = unary_union(buf.tolist())
        else:
            geom = unary_union(gdf_3035.geometry.tolist())

        if geom.is_empty:
            contributing.append({**asdict(rule), "feature_count": int(len(gdf_3035)),
                                 "applied": False, "reason": "buffer empty"})
            continue

        excl_geoms.append(geom)
        contributing.append({**asdict(rule), "feature_count": int(len(gdf_3035)),
                             "applied": True})

    if not excl_geoms:
        union = GeometryCollection()
    else:
        union = unary_union(excl_geoms)

    return union, region_geom, contributing


def rasterize_buildable(
    exclusions_3035, region_3035, resolution_m: int,
    wpa_3035=None
) -> tuple[np.ndarray, dict[str, Any]]:
    """Rasterize the buildable mask at the given resolution (EPSG:3035).
    Returns (values_array, georef_info_dict).

    Pixel-value convention (uint8):
        0   = outside the region (transparent in styled PNG)
        64  = inside region & excluded by setbacks      (brick red)
        128 = inside region & in a WPA (additive override) (green)
        255 = inside region & buildable                  (transparent)

    Since 0 unambiguously means 'outside', no separate region_mask is
    needed downstream.
    """
    from rasterio.transform import from_bounds
    from rasterio.features import rasterize

    minx, miny, maxx, maxy = region_3035.bounds
    minx = math.floor(minx / resolution_m) * resolution_m
    miny = math.floor(miny / resolution_m) * resolution_m
    maxx = math.ceil(maxx / resolution_m) * resolution_m
    maxy = math.ceil(maxy / resolution_m) * resolution_m

    width = max(1, int((maxx - minx) // resolution_m))
    height = max(1, int((maxy - miny) // resolution_m))
    transform = from_bounds(minx, miny, maxx, maxy, width, height)

    print(f"[raster] grid {width} x {height} px @ {resolution_m} m  "
          f"(EPSG:{EPSG_LAEA_EUROPE} bounds {minx:.0f},{miny:.0f},{maxx:.0f},{maxy:.0f})")

    region_mask = rasterize(
        [(region_3035, 1)], out_shape=(height, width),
        transform=transform, fill=0, dtype="uint8", all_touched=False,
    )
    if exclusions_3035 is not None and not exclusions_3035.is_empty:
        excl_mask = rasterize(
            [(exclusions_3035, 1)], out_shape=(height, width),
            transform=transform, fill=0, dtype="uint8", all_touched=False,
        )
    else:
        excl_mask = np.zeros((height, width), dtype="uint8")

    inside = region_mask == 1
    values = np.zeros_like(region_mask, dtype="uint8")
    values[inside & (excl_mask == 1)] = 64    # excluded inside region
    values[inside & (excl_mask == 0)] = 255   # buildable inside region

    if wpa_3035 is not None and not wpa_3035.is_empty:
        wpa_mask = rasterize([(wpa_3035, 1)], out_shape=(height, width),
                             transform=transform, fill=0, dtype="uint8")
        values[inside & (wpa_mask == 1) & (values == 64)] = 128

    georef = {
        "epsg": EPSG_LAEA_EUROPE,
        "bounds_3035": [minx, miny, maxx, maxy],
        "width": width,
        "height": height,
        "resolution_m": resolution_m,
    }
    return values, georef


def reproject_to_web_mercator(
    values: np.ndarray, georef: dict[str, Any]
) -> tuple[np.ndarray, dict[str, Any]]:
    """Reproject the buildable raster from EPSG:3035 to EPSG:3857 so the
    frontend can drop it into a D3 geoMercator SVG with a single
    image-corner transform. Nearest-neighbour (the raster is categorical).
    """
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject, calculate_default_transform, Resampling
    from rasterio.io import MemoryFile
    import rasterio

    minx, miny, maxx, maxy = georef["bounds_3035"]
    src_transform = from_bounds(minx, miny, maxx, maxy,
                                georef["width"], georef["height"])
    src_profile = {
        "driver": "GTiff", "width": georef["width"], "height": georef["height"],
        "count": 1, "dtype": "uint8",
        "crs": f"EPSG:{EPSG_LAEA_EUROPE}", "transform": src_transform,
    }
    with MemoryFile() as memf:
        with memf.open(**src_profile) as ds:
            ds.write(values, 1)
            dst_transform, dst_w, dst_h = calculate_default_transform(
                ds.crs, f"EPSG:{EPSG_WEB_MERCATOR}", ds.width, ds.height,
                *ds.bounds,
            )
            dst = np.zeros((dst_h, dst_w), dtype="uint8")
            reproject(
                source=rasterio.band(ds, 1),
                destination=dst,
                src_transform=ds.transform, src_crs=ds.crs,
                dst_transform=dst_transform, dst_crs=f"EPSG:{EPSG_WEB_MERCATOR}",
                resampling=Resampling.nearest,
            )

    dx, dy = dst_transform.a, dst_transform.e   # signed pixel sizes
    x0, y0 = dst_transform.c, dst_transform.f   # top-left corner
    bounds_3857 = [x0, y0 + dy * dst_h, x0 + dx * dst_w, y0]

    from pyproj import Transformer
    to_wgs = Transformer.from_crs(EPSG_WEB_MERCATOR, EPSG_WGS84, always_xy=True)
    minlng, minlat = to_wgs.transform(bounds_3857[0], bounds_3857[1])
    maxlng, maxlat = to_wgs.transform(bounds_3857[2], bounds_3857[3])

    return dst, {
        "epsg_image": EPSG_WEB_MERCATOR,
        "epsg_source": EPSG_LAEA_EUROPE,
        "bounds_3857": bounds_3857,
        "bounds_wgs84": [minlng, minlat, maxlng, maxlat],
        "width": dst_w,
        "height": dst_h,
        "resolution_m_source": georef["resolution_m"],
    }


# =========================================================================
# Wind Priority Areas (additive)
# =========================================================================

def load_wind_priority_areas(rules_payload: dict[str, Any], region: str):
    """Return a unioned shapely geometry of WPA polygons in EPSG:3035 for
    NUTS regions that overlap the target region, or None.

    Currently only Greece has explicit WPA NUTS-3 codes in
    build_regulations.json (Greek law FEK2464B/2008, sheet WPA_GR).
    """
    import geopandas as gpd
    import pandas as pd
    from shapely.ops import unary_union

    wpa_codes = [w["nuts"].upper() for w in rules_payload.get("wind_priority_areas", [])
                 if (w.get("nuts") or "").upper().startswith(region)]
    if not wpa_codes:
        return None

    print(f"[wpa] {len(wpa_codes)} priority-area NUTS codes overlap {region}")
    parts = []
    for level in (3, 2, 1):
        path = download_nuts_geojson(level)
        gdf = gpd.read_file(path)
        match = gdf[gdf["NUTS_ID"].str.upper().isin(wpa_codes)]
        if not match.empty:
            parts.append(match[["geometry"]])
    if not parts:
        return None
    merged = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True),
                              geometry="geometry", crs="EPSG:4326")
    return unary_union(merged.to_crs(EPSG_LAEA_EUROPE).geometry.tolist())


# =========================================================================
# Output (PNG + sidecar)
# =========================================================================

def write_png_styled(values: np.ndarray, target: Path) -> None:
    """RGBA PNG for direct overlay onto the Climate Policy Atlas world map.

    Visual semantics (inverted from NREL): we paint the *excluded* land
    (where regulations forbid the chosen tech) so a viewer instinctively
    reads the red regions as 'no-build zones'. Buildable land and the
    bounding-box area outside the country stay transparent so the
    underlying country fill / basemap shows through.

    Pixel values:  0=outside (transparent), 64=excluded (red),
                   128=WPA (green), 255=buildable (transparent).
    """
    h, w = values.shape
    rgba = np.zeros((h, w, 4), dtype="uint8")     # default (0,0,0,0) = transparent
    rgba[values == 64]  = EXCLUDED_RED_RGBA
    rgba[values == 128] = WPA_GREEN_RGBA
    Image.fromarray(rgba, "RGBA").save(target, optimize=True)


def write_png_values(values: np.ndarray, target: Path) -> None:
    """Single-channel grayscale PNG for analytical use."""
    Image.fromarray(values, "L").save(target, optimize=True)


def write_sidecar(
    target: Path, cfg: Config, georef: dict[str, Any],
    contributing_rules: list[dict[str, Any]],
    pixel_stats: dict[str, Any]
) -> None:
    sidecar = {
        "schema_version": 1,
        "generated_at": _dt.datetime.now(tz=_dt.timezone.utc).isoformat(),
        "region": cfg.region,
        "tech": cfg.tech,
        "mode": cfg.mode,
        "resolution_m": cfg.resolution_m,
        "turbine_geometry": asdict(cfg.turbine),
        "georef": georef,
        "pixel_stats": pixel_stats,
        "applied_rules": contributing_rules,
        "schema_notes": {
            "values_png_legend": {
                "0":   "outside region (bounding-box padding)",
                "64":  "inside region & excluded by setbacks/exclusion areas",
                "128": "inside region & WPA additive override (encouraged build)",
                "255": "inside region & buildable",
            },
            "styled_png_legend": {
                "transparent": "buildable OR outside region",
                "brick_red rgba(155,60,50,190)": "excluded (regulations forbid)",
                "site_green rgba(141,192,133,140)": "WPA additive (encouraged)",
            },
            "styled_png": "RGBA overlay tuned to the Climate Policy Atlas "
                          "forest-green theme; the red regions read as 'no-build'.",
        },
    }
    with target.open("w", encoding="utf-8") as f:
        json.dump(sidecar, f, ensure_ascii=False, indent=2)


def update_manifest(out_root: Path, key: str, sidecar_relpath: str,
                    cfg: Config, pixel_stats: dict[str, Any]) -> None:
    manifest_path = out_root / "manifest.json"
    if manifest_path.exists():
        with manifest_path.open(encoding="utf-8") as f:
            manifest = json.load(f)
    else:
        manifest = {"schema_version": 1, "bakes": {}}
    manifest["bakes"][key] = {
        "region": cfg.region, "tech": cfg.tech, "mode": cfg.mode,
        "resolution_m": cfg.resolution_m,
        "sidecar": sidecar_relpath,
        "buildable_fraction_of_region": pixel_stats.get("buildable_fraction_of_region"),
        "buildable_km2": pixel_stats.get("buildable_km2"),
        "region_km2": pixel_stats.get("region_km2"),
        "generated_at": _dt.datetime.now(tz=_dt.timezone.utc).isoformat(),
    }
    manifest["last_update"] = _dt.datetime.now(tz=_dt.timezone.utc).isoformat()
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


# =========================================================================
# Main
# =========================================================================

def _bake_key(cfg: Config) -> str:
    return f"{cfg.region}_{cfg.tech}_{cfg.mode}_{cfg.resolution_m}m"


def main(argv: list[str] | None = None) -> int:
    cfg = parse_args(argv)
    for d in (CACHE_DIR, CACHE_PBF, CACHE_NUTS, CACHE_EXTERNAL, CACHE_FEATURES, OUTPUT_DIR):
        _ensure_dir(d)

    key = _bake_key(cfg)
    print(f"\n[bake] {key}  (turbine H={cfg.turbine.tip_height_m}m, "
          f"blade={cfg.turbine.blade_length_m}m)")

    out_styled = OUTPUT_DIR / f"{key}_styled.png"
    out_values = OUTPUT_DIR / f"{key}_values.png"
    out_json   = OUTPUT_DIR / f"{key}.json"
    if (out_styled.exists() and out_values.exists() and out_json.exists()
            and not cfg.overwrite):
        print(f"[bake] outputs already exist, use --overwrite to re-bake.")
        return 0

    # ------ Stage 1+2: rules ------
    rules_payload = load_rules()
    applied = select_applicable_rules(rules_payload, cfg)
    if not applied:
        print(f"[bake] no applicable {cfg.tech} rules for {cfg.region} "
              f"in mode '{cfg.mode}'. Nothing to bake (this is normal for "
              f"techs whose rules are non-spatial — e.g. solar capacity caps, "
              f"FIT eligibility, land-class restrictions).")
        return 0
    print(f"[rules] {len(applied)} applicable rule(s) for {cfg.region}/{cfg.tech}/{cfg.mode}:")
    for r in applied:
        print(f"        - {r.variable:38s} layer={r.layer:18s} "
              f"setback={r.setback_m:>7.0f} m  cond={(r.condition or '')[:36]!r}")
    layers_needed = {r.layer for r in applied}

    # ------ Stage 3: region polygon ------
    region_gdf = get_region_polygon(cfg.region)
    bbox_wgs = tuple(region_gdf.total_bounds)  # minx, miny, maxx, maxy

    # ------ Stage 4-5: features ------
    if cfg.smoke:
        print("[bake] --smoke: skipping OSM and external layers")
        features = {layer: _empty_gdf() for layer in layers_needed}
    else:
        pbf_path = download_pbf(cfg.region)
        features = extract_osm_features(pbf_path, layers_needed)
        if not cfg.skip_natura:
            features.update(load_external_exclusions(layers_needed, bbox_wgs))

    # ------ Stage 6: buffer & union ------
    excl_3035, region_3035, contributing = buffer_and_union(features, applied, region_gdf)

    # ------ Stage 8: WPA additive ------
    wpa_3035 = load_wind_priority_areas(rules_payload, cfg.region) if cfg.tech == "wind" else None

    # ------ Stage 7: rasterize ------
    values, georef = rasterize_buildable(
        excl_3035, region_3035, cfg.resolution_m, wpa_3035=wpa_3035
    )
    pixel_stats = _compute_pixel_stats(values, cfg.resolution_m)
    print(f"[stats] buildable: {pixel_stats['buildable_fraction_of_region']*100:.1f}% "
          f"of region ({pixel_stats['buildable_km2']:.1f} km^2 of "
          f"{pixel_stats['region_km2']:.1f} km^2)")

    values_3857, georef_3857 = reproject_to_web_mercator(values, georef)

    # ------ Stage 9: outputs ------
    write_png_styled(values_3857, out_styled)
    write_png_values(values_3857, out_values)
    write_sidecar(out_json, cfg, georef_3857, contributing, pixel_stats)
    rel = str(out_json.relative_to(PUBLIC_DATA_DIR)).replace(os.sep, "/")
    update_manifest(OUTPUT_DIR, key, rel, cfg, pixel_stats)

    print(f"\n[ok] wrote {out_styled.name}, {out_values.name}, {out_json.name}")
    print(f"[ok] manifest updated -> {OUTPUT_DIR / 'manifest.json'}")
    return 0


def _empty_gdf():
    import geopandas as gpd
    return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")


def _compute_pixel_stats(values: np.ndarray, resolution_m: int) -> dict[str, Any]:
    """Compute buildable-area statistics from the values raster.
    Convention: 0 = outside region; 64 = excluded; 128 = WPA; 255 = buildable.
    """
    px_area_km2 = (resolution_m * resolution_m) / 1_000_000
    excluded_px  = int((values == 64).sum())
    wpa_px       = int((values == 128).sum())
    buildable_px = int((values == 255).sum())
    region_px    = excluded_px + wpa_px + buildable_px
    return {
        "total_pixels_grid": int(values.size),
        "region_pixels": region_px,
        "buildable_pixels": buildable_px,
        "wpa_pixels": wpa_px,
        "excluded_pixels": excluded_px,
        "buildable_fraction_of_region": (buildable_px + wpa_px) / region_px if region_px else 0,
        "buildable_km2": (buildable_px + wpa_px) * px_area_km2,
        "region_km2": region_px * px_area_km2,
        "pixel_area_km2": px_area_km2,
    }


if __name__ == "__main__":
    raise SystemExit(main())
