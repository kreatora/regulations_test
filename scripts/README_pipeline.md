# Buildable-Land Raster Pipeline

Buildable-land / land-availability rasters for the Climate Policy Atlas. The
spatial methodology parallels [atlite's landuse-availability
workflow](https://atlite.readthedocs.io/en/master/examples/landuse-availability.html):
an exclusion container at fine metric resolution (EPSG:3035), a binary
eligibility mask inside each region, and an **eligible share** statistic
(equivalent to `compute_shape_availability`). We differ in the exclusion
sources: coded build regulations + OSM geometry rather than CORINE land-cover
codes, and we rasterise at 250 m rather than atlite's typical 100 m.

Also inspired by Lopes et al. 2023 (NREL structure-setback CONUS rasters).

The pipeline produces, per region × tech × rule-mode:

* `public/data/buildable/<KEY>_availability.png` — atlite-style green eligible
  land (default map overlay in the front-end).
* `public/data/buildable/<KEY>_styled.png` — brick-red exclusion overlay for
  the alternate "Exclusion zones" view.
* `public/data/buildable/<KEY>_values.png` — single-channel raster
  (0 = outside, 64 = excluded, 128 = wind priority area, 255 = buildable).
* `public/data/buildable/<KEY>.json` — sidecar with WGS84 / Web-Mercator
  bounding boxes, applied rules, turbine geometry, pixel statistics
  (`buildable_fraction_of_region` / `eligible_share`).
* `public/data/buildable/manifest.json` — top-level manifest of all bakes.

`<KEY>` looks like `DE2_wind_strictest_250m`.

---

## 1. Install

```powershell
# from repo root
python -m pip install -r scripts/requirements.txt
```

All deps have prebuilt wheels on Windows / macOS / Linux (Python 3.10+).
No compiler / GDAL system install needed.

## 2. One-time external downloads

The pipeline needs **Natura 2000** and **CDDA** polygons (large EU-wide
GeoPackages from the European Environment Agency). They aren't auto-downloaded
because EEA URLs expire periodically. Place them in `scripts/_cache/external/`:

| Layer key | File | EEA download page |
|---|---|---|
| `natura2000`, `natura2000_spa` | `Natura2000_end2024.gpkg` (~1 GB) | https://www.eea.europa.eu/en/datahub/datahubitem-view/6fc8ad2d-195d-40f4-bdec-576e7d1268e4 |
| `protected_areas`, `national_parks` | `CDDA_NationallyDesignatedAreas.gpkg` (~250 MB) | https://www.eea.europa.eu/en/datahub/datahubitem-view/8d2406f0-79d8-44c1-b4cc-a8b8d8e96d51 |

Both are free, CC-BY-EEA. If a file is missing the pipeline still runs, just
without those exclusion layers (it prints a warning).

The `--skip-natura` flag skips them entirely (faster, lower fidelity).

## 3. Pilot bake — Bayern wind

```powershell
python scripts/build_buildable_rasters.py --region DE2 --tech wind --mode strictest
```

The first run downloads the **Bayern OSM PBF** (~500 MB from Geofabrik) into
`scripts/_cache/pbf/`. Subsequent runs hit that cache. OSM feature extraction
caches per-layer GeoPackages in `scripts/_cache/features/`.

Expected output (with default turbine geometry H=150 m, blade=60 m):

```
[bake] DE2_wind_strictest_250m  (turbine H=150.0m, blade=60.0m)
[rules] 8 applicable rule(s) for DE2/wind/strictest:
        - 9_distance_others       layer=radar           setback=  15000 m
        - 8_distance_military     layer=military        setback=   3000 m
        - 1_distance_residential  layer=residential     setback=   1500 m  (10H)
        - 9_distance_others       layer=natura2000      setback=   1200 m
        - 5_distance_airports     layer=airport         setback=   1000 m
        - 9_distance_others       layer=protected_areas setback=   1000 m
        - 2_distance_motorway     layer=motorway        setback=     40 m
        - 15_exclusion area       layer=natura2000      setback=      0 m
[osm] parsing PBF for layers: ['airport', 'military', 'motorway', 'radar', 'residential']
...
[stats] buildable: ~XX.X% of region
[ok] wrote DE2_wind_strictest_250m_styled.png + _values.png + .json
```

The 10H residential setback is the dominant constraint and creates the
characteristic Bayern "swiss-cheese" pattern.

## 4. Smoke test (no OSM download)

To verify the mechanics end-to-end without downloading 500 MB of OSM data:

```powershell
python scripts/build_buildable_rasters.py --region IE --tech wind --mode strictest --smoke
```

`--smoke` skips OSM and external layers. The output raster will be uniformly
buildable (no exclusions), but the pipeline plumbing — rule selection,
projection, rasterisation, PNG/sidecar writing — is exercised.

## 5. CLI options

```
--region          NUTS code (DE2, DE, EL, IE, FR, ...)
--tech            wind | solar | ev          (default wind)
--mode            strictest | latest | binding (default strictest)
--resolution      raster cell size in metres  (default 250)
--turbine-tip-height       (default 150 m, NREL standard)
--turbine-blade-length     (default 60 m)
--smoke           skip OSM downloads (mechanics-only)
--skip-natura     skip Natura 2000 / CDDA exclusions
--overwrite       re-bake even if outputs exist
```

## 6. Repeating for the full atlas

After Bayern is happy, scale to the rest:

```powershell
# Each Bundesland (regional PBFs are smaller than national)
foreach ($r in 'DE1','DE2','DE9','DEA','DE7','DEB','DED','DEE','DEF','DEG') {
  foreach ($t in 'wind','solar') {
    foreach ($m in 'strictest','latest','binding') {
      python scripts/build_buildable_rasters.py --region $r --tech $t --mode $m
    }
  }
}

# Country-level for EL / IE / FR
foreach ($r in 'EL','IE','FR') {
  foreach ($t in 'wind','solar','ev') {
    foreach ($m in 'strictest','latest','binding') {
      python scripts/build_buildable_rasters.py --region $r --tech $t --mode $m
    }
  }
}
```

At 250 m, a complete bake set is ~80–120 MB total.

## 7. Caches & cleanup

| Folder | Purpose | Safe to delete? |
|---|---|---|
| `scripts/_cache/pbf/` | Geofabrik PBFs (500 MB – 4 GB each) | yes — re-downloaded |
| `scripts/_cache/nuts/` | GISCO NUTS GeoJSONs (~1 MB each) | yes |
| `scripts/_cache/features/` | Extracted OSM layers per PBF (GeoPackages) | yes — re-extracted |
| `scripts/_cache/external/` | Manually placed EEA GPKGs | no — manual download |

Everything in `scripts/_cache/` is in `.gitignore`; only outputs in
`public/data/buildable/` are committed.

## 8. Troubleshooting

* **`pyrosm` import error on Windows**: ensure `pip install pyrosm` succeeded.
  If wheel install fails, install Microsoft C++ Build Tools first.
* **`rasterio` GDAL errors**: install via `pip install rasterio` (not conda) —
  the wheel ships its own GDAL.
* **PBF download is slow**: Geofabrik has good throughput but caches per-region;
  for stale data, delete the PBF in `scripts/_cache/pbf/` and re-run.
* **Empty raster for Ireland solar / EV**: expected — those rules are
  cm-scale roof-internal or between-charger constraints, not spatial setbacks.

## 9. Comparison with atlite

| Concept | Atlite | This pipeline |
|---|---|---|
| Exclusion source | CORINE / custom land-cover rasters | OSM layers + regulation setbacks |
| CRS / resolution | EPSG:3035 @ 100 m (default) | EPSG:3035 @ 250 m |
| Region eligible share | `compute_shape_availability` | `pixel_stats.eligible_share` |
| Grid-cell availability | `cutout.availabilitymatrix` (0–1 per weather cell) | Not implemented (policy atlas is region-level) |
| Map colours | matplotlib `Greens` | `_availability.png` (green) or `_styled.png` (red exclusions) |

To regenerate availability PNGs for existing bakes without a full re-run, use:

```powershell
python scripts/generate_availability_pngs.py
```

Or re-bake everything (slow — re-downloads OSM):

```powershell
python scripts/build_buildable_rasters.py --region DE2 --tech wind --mode strictest --overwrite
```

## 10. What this pipeline does *not* do (yet)

* Per-building OSM footprints (uses the coarser `landuse=residential`).
* National-only protected-area layers (e.g. Bavarian LfU NSG WFS) — currently
  only EEA Natura 2000 + CDDA.
* Slope / terrain exclusions (NREL adds these; we don't have them in our
  rule set, but it would be a clean extension).
* Time-aware rule activation — currently all "active" rules are applied;
  a year filter is on the roadmap (Phase 3 of the front-end work).
