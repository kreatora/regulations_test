/**
 * Buildable Land — Regulations subsection of the Climate Policy Atlas.
 *
 * Renders buildable-land maps showing where build-code setbacks forbid
 * construction versus permit it, driven by per-country rasters baked offline
 * by scripts/build_buildable_rasters.py.
 *
 * Methodology parallels atlite's ExclusionContainer + shape availability
 * (https://atlite.readthedocs.io/en/master/examples/landuse-availability.html):
 * fine-grained exclusions in EPSG:3035, eligible share per region, optional
 * green "availability" overlay. We use OSM + coded regulations rather than
 * CORINE land-cover rasters.
 *
 * Self-contained: clicking a data country opens a split panel
 * (left = zoomed country with raster overlay, right = applied rules
 * with original-source links). No cross-navigation into the existing
 * Build Codes lenses, by design.
 *
 * The world-map Regulations submenu dispatches a 'buildable-land:show'
 * CustomEvent when the user activates this view; we initialise lazily on
 * the first show.
 */
import * as d3 from 'd3';
import { geoMercator, geoPath } from 'd3-geo';
import polylabel from 'polylabel';
import type { MapHost } from './map-host';
import { getMapHost } from './map-host';
// ---------------------------------------------------------------------------
// Types — must mirror what scripts/build_buildable_rasters.py writes.
// ---------------------------------------------------------------------------

interface ManifestEntry {
    region: string;
    tech: 'wind' | 'solar' | 'ev';
    mode: 'strictest' | 'latest' | 'binding';
    resolution_m: number;
    sidecar: string;
    buildable_fraction_of_region: number;
    buildable_km2: number;
    region_km2: number;
    generated_at: string;
}
interface Manifest {
    schema_version: number;
    bakes: Record<string, ManifestEntry>;
    last_update: string;
}
interface AppliedRule {
    variable: string;
    layer: string;
    setback_m: number;
    condition: string | null;
    year: number | null;
    legally_binding: boolean;
    source_name: string | null;
    source_link: string | null;
    raw_value: number | null;
    raw_unit: string | null;
    multiplier_resolved: boolean;
    feature_count: number;
    applied: boolean;
    reason?: string;
}
interface Sidecar {
    schema_version: number;
    generated_at: string;
    region: string;
    tech: string;
    mode: string;
    resolution_m: number;
    turbine_geometry: { tip_height_m: number; blade_length_m: number };
    georef: {
        epsg_image: number;
        epsg_source: number;
        bounds_3857: [number, number, number, number];
        bounds_wgs84: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
        width: number;
        height: number;
        resolution_m_source: number;
    };
    pixel_stats: {
        region_pixels: number;
        buildable_pixels: number;
        wpa_pixels: number;
        excluded_pixels: number;
        buildable_fraction_of_region: number;
        buildable_km2: number;
        region_km2: number;
        eligible_share?: number;
    };
    applied_rules: AppliedRule[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_COUNTRIES: Record<string, { iso2: string; nutsPrimary: string; name: string; geojsonName: string }> = {
    Germany: { iso2: 'DE', nutsPrimary: 'DE2', name: 'Germany', geojsonName: 'Germany' },
    Ireland: { iso2: 'IE', nutsPrimary: 'IE',  name: 'Ireland', geojsonName: 'Ireland' },
    Greece:  { iso2: 'EL', nutsPrimary: 'EL',  name: 'Greece',  geojsonName: 'Greece'  },
    France:  { iso2: 'FR', nutsPrimary: 'FR',  name: 'France',  geojsonName: 'France'  },
};

type Tech = 'wind' | 'solar' | 'ev';
type Mode = 'strictest' | 'latest' | 'binding';
const TECHS: Tech[] = ['wind', 'solar', 'ev'];
const TECH_LABEL: Record<Tech, string> = { wind: 'Wind', solar: 'Solar', ev: 'EV charging' };
const MODES: Mode[] = ['strictest', 'latest', 'binding'];
const MODE_LABEL: Record<Mode, string> = {
    strictest: 'Strictest rule',
    latest:    'Latest rule',
    binding:   'Legally binding only',
};

// Site palette (from src/shared.css).
const C_FOREST       = 'rgb(42, 58, 42)';
const C_PRIMARY      = 'rgb(50, 70, 53)';
const C_PRIMARY_LIGHT= 'rgb(100, 140, 88)';
const C_PRIMARY_LIGHTER = 'rgb(141, 192, 133)';
const C_SURFACE      = 'rgb(221, 227, 214)';
const C_SURFACE_LIGHT= 'rgb(240, 245, 235)';
const C_BORDER       = 'rgb(176, 192, 176)';
const C_NO_DATA      = 'rgb(225, 225, 220)';
const C_NO_DATA_BORDER= 'rgb(190, 195, 185)';
const C_BRICK        = 'rgb(155, 60, 50)';
const C_AVAIL_GREEN  = 'rgb(35, 139, 69)';
const C_AVAIL_GREY   = 'rgb(229, 229, 224)';

type OverlayView = 'availability' | 'exclusions';

const CITATION =
    'Setback rules: D2.2.1.1_Data collection_regulations for energy infrastructure (Feb 2025). ' +
    'OSM features: © OpenStreetMap contributors (ODbL). NUTS boundaries: © EuroGeographics for the administrative boundaries (GISCO). ' +
    'Land-availability methodology inspired by atlite ExclusionContainer / shape availability ' +
    '(https://atlite.readthedocs.io/en/master/examples/landuse-availability.html).';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let manifest: Manifest | null = null;
let nuts0: any = null;
let activeTech: Tech = 'wind';
let activeMode: Mode = 'strictest';
let activeOverlayView: OverlayView = 'availability';
let selectedCountry: string | null = null;
let initialised = false;
let dataLoadPromise: Promise<void> | null = null;
let root: HTMLElement | null = null;

export interface BuildableLandFilters {
    tech: Tech;
    mode: Mode;
    overlay: OverlayView;
}

export function getBuildableLandFilters(): BuildableLandFilters {
    return { tech: activeTech, mode: activeMode, overlay: activeOverlayView };
}

export function isBuildableLandCountryDetailActive(): boolean {
    return selectedCountry !== null;
}

export function clearBuildableLandSelection(): void {
    selectedCountry = null;
    const stage = document.getElementById('bl-stage');
    if (stage) stage.innerHTML = '';
    renderBuildableLandLegend();
}

// ---------------------------------------------------------------------------
// Boot — wait for build-codes.ts to dispatch the show event.
// ---------------------------------------------------------------------------

document.addEventListener('buildable-land:show', () => {
    void ensureBuildableLandDataLoaded();
});

export async function ensureBuildableLandDataLoaded(): Promise<void> {
    if (initialised) return;
    if (dataLoadPromise) return dataLoadPromise;

    dataLoadPromise = (async () => {
        const hostEl = document.getElementById('buildable-land-view');
        if (hostEl) {
            root = hostEl;
            renderShell(hostEl);
        }

        const baseUrl = (import.meta as any).env.BASE_URL || '/';
        const [manifestResp, nuts0Resp] = await Promise.all([
            fetch(`${baseUrl}data/buildable/manifest.json`).then(r => r.ok ? r.json() : null),
            fetch('https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_4326_LEVL_0.geojson')
                .then(r => r.ok ? r.json() : null)
                .catch(() => null),
        ]);
        manifest = manifestResp;
        nuts0 = nuts0Resp;
        initialised = true;
        renderStats();
        renderBuildableLandLegend();
    })().catch((err) => {
        dataLoadPromise = null;
        console.error('Failed to load buildable-land assets', err);
        throw err;
    });

    return dataLoadPromise;
}

// ---------------------------------------------------------------------------
// Shell (CSS + skeleton)
// ---------------------------------------------------------------------------

function renderShell(host: HTMLElement) {
    host.innerHTML = `
        <style>
            .bl-shell { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: ${C_FOREST}; padding: 12px 8px; }
            .bl-controls { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 12px 14px; background: #ffffff; border: 1px solid ${C_BORDER}; border-radius: 12px; margin-bottom: 12px; }
            .bl-controls .bl-group { display: inline-flex; align-items: center; gap: 6px; }
            .bl-controls label { font-size: 11px; font-weight: 700; color: ${C_PRIMARY}; letter-spacing: 0.4px; text-transform: uppercase; margin-right: 6px; }

            .bl-pill { display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px; background: #ffffff; border: 1.5px solid ${C_BORDER}; border-radius: 999px; font-size: 12px; font-weight: 600; color: ${C_FOREST}; cursor: pointer; transition: all 0.18s ease; user-select: none; }
            .bl-pill:hover { background: ${C_SURFACE_LIGHT}; border-color: ${C_PRIMARY_LIGHT}; }
            .bl-pill.is-active, .bl-pill.is-active:hover { background: ${C_FOREST}; border-color: ${C_FOREST}; color: #fff; }

            .bl-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px; }
            .bl-stat { background: #ffffff; border: 1px solid ${C_BORDER}; border-radius: 12px; padding: 12px 14px; }
            .bl-stat-value { font-size: 22px; font-weight: 700; color: ${C_FOREST}; line-height: 1.1; }
            .bl-stat-label { font-size: 10.5px; font-weight: 600; color: ${C_PRIMARY}; margin-top: 4px; letter-spacing: 0.4px; text-transform: uppercase; }

            .bl-stage { background: #ffffff; border: 1px solid ${C_BORDER}; border-radius: 14px; padding: 16px; min-height: 540px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); position: relative; }

            .bl-world { width: 100%; height: 64vh; min-height: 460px; background: ${C_SURFACE_LIGHT}; border-radius: 10px; border: 1px solid ${C_BORDER}; }
            .bl-world .country { stroke: #ffffff; stroke-width: 0.5; transition: stroke-width 0.15s ease, opacity 0.15s ease; }
            .bl-world .country.no-data { fill: ${C_NO_DATA}; }
            .bl-world .country.no-data { stroke: ${C_NO_DATA_BORDER}; }
            /* Keep data-country base fill muted so raster highlights dominate. */
            .bl-world .country.has-data { fill: ${C_SURFACE}; opacity: 0.65; cursor: pointer; }
            .bl-world .country.has-data:hover { fill: ${C_PRIMARY_LIGHT}; opacity: 0.82; stroke-width: 1.3; }
            .bl-world .country.is-selected { fill: ${C_FOREST}; }
            .bl-world image.bl-world-raster { pointer-events: none; }

            .bl-legend { display: flex; align-items: center; gap: 18px; margin-top: 10px; font-size: 11.5px; color: ${C_PRIMARY}; }
            .bl-legend-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid ${C_BORDER}; margin-right: 6px; vertical-align: middle; }

            .bl-detail { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr); gap: 14px; align-items: start; }
            @media (max-width: 900px) { .bl-detail { grid-template-columns: 1fr; } }
            .bl-detail .bl-map-wrap { background: ${C_SURFACE_LIGHT}; border: 1px solid ${C_BORDER}; border-radius: 10px; padding: 6px; }
            .bl-detail svg.bl-country-svg { width: 100%; height: 60vh; min-height: 440px; display: block; }
            .bl-detail svg.bl-country-svg .country-shape { fill: ${C_SURFACE}; stroke: ${C_PRIMARY}; stroke-width: 1; }
            .bl-detail svg.bl-country-svg image { image-rendering: pixelated; image-rendering: crisp-edges; }

            .bl-detail .bl-rule-panel { background: ${C_SURFACE_LIGHT}; border: 1px solid ${C_BORDER}; border-radius: 10px; padding: 14px; max-height: 60vh; overflow-y: auto; }
            .bl-detail .bl-rule-panel h4 { margin: 0 0 4px 0; font-size: 14px; font-weight: 700; color: ${C_FOREST}; }
            .bl-detail .bl-rule-panel .bl-sub { font-size: 11.5px; color: ${C_PRIMARY}; margin: 0 0 10px 0; }

            .bl-back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #ffffff; border: 1.5px solid ${C_BORDER}; border-radius: 999px; font-size: 12px; font-weight: 600; color: ${C_FOREST}; cursor: pointer; transition: all 0.15s ease; }
            .bl-back-btn:hover { background: ${C_SURFACE_LIGHT}; border-color: ${C_PRIMARY_LIGHT}; }

            .bl-rule-card { padding: 10px 12px; border-left: 3px solid ${C_PRIMARY_LIGHT}; border-radius: 6px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); margin-bottom: 8px; }
            .bl-rule-card.is-skipped { border-left-color: ${C_BORDER}; opacity: 0.7; }
            .bl-rule-card-row1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
            .bl-rule-tag { font-size: 9.5px; padding: 2px 7px; border-radius: 999px; background: ${C_SURFACE}; color: ${C_PRIMARY}; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }
            .bl-rule-tag.bind  { background: rgba(15, 118, 110, 0.15); color: rgb(15, 118, 110); }
            .bl-rule-tag.guide { background: rgba(217, 119, 6, 0.15); color: rgb(180, 83, 9); }
            .bl-rule-tag.skipped { background: rgba(155, 60, 50, 0.12); color: ${C_BRICK}; }
            .bl-rule-value { font-size: 13px; font-weight: 700; color: ${C_FOREST}; }
            .bl-rule-cond  { font-size: 11.5px; color: ${C_PRIMARY}; margin-top: 2px; line-height: 1.4; }
            .bl-rule-source { font-size: 10.5px; color: ${C_PRIMARY}; margin-top: 4px; }
            .bl-rule-source a { color: ${C_PRIMARY_LIGHT}; text-decoration: underline; }
            .bl-rule-source a:hover { color: ${C_FOREST}; }

            .bl-empty { display: flex; align-items: center; justify-content: center; min-height: 280px; color: ${C_PRIMARY}; font-size: 13px; font-style: italic; text-align: center; padding: 24px; }
            .bl-empty strong { color: ${C_FOREST}; }

            .bl-citation { font-size: 9.5px; color: ${C_PRIMARY}; margin-top: 12px; padding: 10px 14px; background: ${C_SURFACE_LIGHT}; border-radius: 10px; line-height: 1.5; border: 1px solid ${C_BORDER}; }

            .bl-tooltip { position: fixed; background: ${C_FOREST}; color: #ffffff; padding: 7px 11px; border-radius: 6px; font-size: 11.5px; pointer-events: none; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.2); max-width: 260px; line-height: 1.45; }
            .bl-tooltip strong { color: ${C_PRIMARY_LIGHTER}; }
        </style>

        <div class="bl-shell">
            <div class="bl-stat-grid" id="bl-stats"></div>
            <div id="bl-legend-wrap"></div>
            <div class="bl-stage" id="bl-stage"></div>
            <div class="bl-citation"><strong>Sources:</strong> ${CITATION}</div>
        </div>
    `;
}

function renderBuildableLandLegend() {
    const el = document.getElementById('bl-legend-wrap');
    if (!el || selectedCountry) {
        el?.replaceChildren();
        return;
    }
    el.innerHTML = `<div class="bl-legend">${buildLegendHTML()}</div>`;
}

function rerender() {
    document.dispatchEvent(new CustomEvent('buildable-land:refresh'));
}

export async function applyBuildableLandFilters(filters: BuildableLandFilters): Promise<void> {
    activeTech = filters.tech;
    activeMode = filters.mode;
    activeOverlayView = filters.overlay;
    await refreshManifest();
    renderStats();
    if (selectedCountry) {
        await renderCountryDetail(selectedCountry);
    } else {
        renderBuildableLandLegend();
    }
}

async function refreshManifest() {
    const baseUrl = (import.meta as any).env.BASE_URL || '/';
    try {
        const fresh = await fetch(`${baseUrl}data/buildable/manifest.json?ts=${Date.now()}`).then(r => r.ok ? r.json() : null);
        if (fresh) manifest = fresh;
    } catch (err) {
        console.warn('Failed to refresh buildable manifest', err);
    }
}

// ---------------------------------------------------------------------------
// Stats row
// ---------------------------------------------------------------------------

function renderStats() {
    const el = document.getElementById('bl-stats');
    if (!el) return;
    const bakes = manifest ? Object.values(manifest.bakes) : [];
    const matching = bakes.filter(b => b.tech === activeTech && b.mode === activeMode);
    const totalBuildableKm2 = matching.reduce((s, b) => s + (b.buildable_km2 || 0), 0);
    const totalRegionKm2    = matching.reduce((s, b) => s + (b.region_km2    || 0), 0);
    const fraction = totalRegionKm2 > 0 ? totalBuildableKm2 / totalRegionKm2 : 0;

    const items: Array<{ value: string; label: string }> = [
        { value: String(Object.keys(DATA_COUNTRIES).length), label: 'Countries with rule data' },
        { value: String(matching.length),
          label: `${TECH_LABEL[activeTech]} bakes (${MODE_LABEL[activeMode].toLowerCase()})` },
        { value: matching.length > 0 ? `${(fraction * 100).toFixed(1)}%` : '—',
          label: 'Eligible share (data countries, weighted)' },
        { value: matching.length > 0 ? `${Math.round(totalBuildableKm2).toLocaleString()} km²` : '—',
          label: 'Eligible land area' },
    ];

    el.innerHTML = items.map(i => `
        <div class="bl-stat">
            <div class="bl-stat-value">${i.value}</div>
            <div class="bl-stat-label">${i.label}</div>
        </div>
    `).join('');
}

// ---------------------------------------------------------------------------
// World view — shared #world-map SVG (choropleth of eligible share)
// ---------------------------------------------------------------------------

interface CountryAggregation {
    eligibleShare: number;
    buildableKm2: number;
    regionKm2: number;
    bakeCount: number;
}

function aggregateCountryData(): Map<string, CountryAggregation> {
    const result = new Map<string, CountryAggregation>();
    if (!manifest) return result;

    for (const meta of Object.values(DATA_COUNTRIES)) {
        const bakes = Object.values(manifest.bakes).filter(b =>
            b.tech === activeTech && b.mode === activeMode && b.region.startsWith(meta.iso2)
        );
        if (bakes.length === 0) {
            result.set(meta.geojsonName, { eligibleShare: -1, buildableKm2: 0, regionKm2: 0, bakeCount: 0 });
            continue;
        }
        const totalBuildable = bakes.reduce((s, b) => s + b.buildable_km2, 0);
        const totalRegion = bakes.reduce((s, b) => s + b.region_km2, 0);
        result.set(meta.geojsonName, {
            eligibleShare: totalRegion > 0 ? totalBuildable / totalRegion : 0,
            buildableKm2: totalBuildable,
            regionKm2: totalRegion,
            bakeCount: bakes.length,
        });
    }
    return result;
}

function choroplethCountryFill(
    name: string | undefined,
    countryData: Map<string, CountryAggregation>,
    colorScale: (t: number) => string,
): string {
    if (!name) return 'rgba(0,0,0,0)';
    if (name === selectedCountry) return C_FOREST;
    const agg = countryData.get(name);
    if (!agg) return 'rgba(0,0,0,0)';
    if (agg.eligibleShare < 0) return C_NO_DATA;
    return colorScale(agg.eligibleShare);
}

function wireBuildableLandCountryLayer(
    layer: d3.Selection<SVGGElement, unknown, null, undefined>,
    host: MapHost,
): void {
    const path = host.path;
    const dataNames = new Set(Object.values(DATA_COUNTRIES).map(c => c.geojsonName));
    const dataFeatures = host.geoData.features.filter((f: any) => dataNames.has(f.properties?.name));
    const countryData = aggregateCountryData();
    const colorScale = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);

    layer.selectAll('.bl-country').data(dataFeatures, (f: any) => f.properties?.name)
        .join('path')
        .attr('class', (f: any) => {
            const name = f.properties?.name;
            return `bl-country has-data${name === selectedCountry ? ' is-selected' : ''}`;
        })
        .attr('d', path as any)
        .attr('fill', (f: any) => choroplethCountryFill(f.properties?.name, countryData, colorScale))
        .attr('fill-opacity', (f: any) => (f.properties?.name === selectedCountry ? 0.92 : 0.85))
        .attr('stroke', (f: any) => (f.properties?.name === selectedCountry ? C_FOREST : '#ffffff'))
        .attr('stroke-width', (f: any) => (f.properties?.name === selectedCountry ? 1.5 : 0.7))
        .style('pointer-events', 'all')
        .style('cursor', 'pointer')
        .on('mouseover', function (event, f: any) {
            tooltipShow(buildCountryTooltip(f.properties?.name), event);
            if (f.properties?.name !== selectedCountry) {
                d3.select(this).attr('fill-opacity', 0.95);
            }
        })
        .on('mousemove', function (event) { tooltipMove(event); })
        .on('mouseout', function (_event, f: any) {
            tooltipHide();
            d3.select(this).attr('fill-opacity', f.properties?.name === selectedCountry ? 0.92 : 0.85);
        })
        .on('click', function (event, f: any) {
            event.preventDefault();
            event.stopPropagation();
            const name = f.properties?.name;
            if (!dataNames.has(name)) return;
            selectedCountry = name;
            tooltipHide();
            updateBuildableLandMapSelection(host);
            renderBuildableLandLegend();
            void renderCountryDetail(name);
        });
}

export function updateBuildableLandMapSelection(host: MapHost): void {
    const dataNames = new Set(Object.values(DATA_COUNTRIES).map(c => c.geojsonName));
    const countryData = aggregateCountryData();
    const colorScale = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);

    host.regulationsG.selectAll<SVGPathElement, any>('.bl-country')
        .attr('class', (f: any) => {
            const name = f.properties?.name;
            return `bl-country has-data${name === selectedCountry ? ' is-selected' : ''}`;
        })
        .attr('fill', (f: any) => choroplethCountryFill(f.properties?.name, countryData, colorScale))
        .attr('fill-opacity', (f: any) => (f.properties?.name === selectedCountry ? 0.92 : 0.85))
        .attr('stroke', (f: any) => (f.properties?.name === selectedCountry ? C_FOREST : '#ffffff'))
        .attr('stroke-width', (f: any) => (f.properties?.name === selectedCountry ? 1.5 : 0.7));
}

function renderEligibleShareLegend(
    layer: d3.Selection<SVGGElement, unknown, any, any>,
    host: MapHost,
): void {
    const colorScale = d3.scaleSequential(d3.interpolateGreens).domain([0, 1]);

    const legend = layer.append('g')
        .attr('class', 'bl-choropleth-legend')
        .attr('transform', `translate(${host.width - 290}, ${host.height - 55})`);

    const gradId = 'bl-eligible-grad';
    const grad = legend.append('defs').append('linearGradient').attr('id', gradId);
    grad.append('stop').attr('offset', '0%').attr('stop-color', colorScale(0));
    grad.append('stop').attr('offset', '50%').attr('stop-color', colorScale(0.5));
    grad.append('stop').attr('offset', '100%').attr('stop-color', colorScale(1));

    legend.append('rect')
        .attr('width', 250).attr('height', 12).attr('rx', 6)
        .attr('fill', `url(#${gradId})`).attr('stroke', '#cbd5e1');

    legend.append('text').attr('x', 0).attr('y', 28)
        .style('font-size', '10px').style('fill', '#64748b').text('0% eligible');
    legend.append('text').attr('x', 250).attr('y', 28)
        .attr('text-anchor', 'end')
        .style('font-size', '10px').style('fill', '#64748b').text('100% eligible');
    legend.append('text').attr('x', 125).attr('y', -6)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px').style('fill', '#475569').style('font-weight', '600')
        .text(`${TECH_LABEL[activeTech]} — Eligible land share`);
}

function polylabelCentroid(d: any, projection: d3.GeoProjection): [number, number] | null {
    let coords: number[][][];
    if (d.geometry.type === 'Polygon') {
        coords = d.geometry.coordinates;
    } else if (d.geometry.type === 'MultiPolygon') {
        let best = d.geometry.coordinates[0];
        let maxArea = 0;
        for (const poly of d.geometry.coordinates) {
            const a = d3.geoArea({ type: 'Polygon', coordinates: poly });
            if (a > maxArea) { maxArea = a; best = poly; }
        }
        coords = best;
    } else {
        return null;
    }
    const result = polylabel(coords);
    const pt = projection([result[0], result[1]]);
    return pt ? [pt[0], pt[1]] : null;
}

function renderNonDataCountryLabels(
    layer: d3.Selection<SVGGElement, unknown, any, any>,
    host: MapHost,
): void {
    const dataNames = new Set(Object.values(DATA_COUNTRIES).map(c => c.geojsonName));
    const nonDataFeatures = host.geoData.features.filter(
        (f: any) => !dataNames.has(f.properties?.name) && f.properties?.name,
    );
    const code3to2 = host.countryCode3to2;

    const labelsG = layer.append('g').attr('class', 'bl-nodata-labels');
    labelsG.selectAll('text').data(nonDataFeatures).enter().append('text')
        .attr('transform', (d: any) => {
            const c = polylabelCentroid(d, host.projection);
            if (!c || isNaN(c[0]) || isNaN(c[1])) return 'translate(-9999,-9999)';
            return `translate(${c[0]},${c[1]})`;
        })
        .attr('text-anchor', 'middle')
        .attr('font-size', '2px')
        .attr('fill', 'black')
        .style('pointer-events', 'none')
        .text((d: any) => code3to2[d.id] || '');
}

export async function renderBuildableLandOnMap(host: MapHost, filters: BuildableLandFilters): Promise<void> {
    await ensureBuildableLandDataLoaded();
    activeTech = filters.tech;
    activeMode = filters.mode;
    activeOverlayView = filters.overlay;

    host.clearRegulationsLayer();
    host.showRegulationBasemap();
    host.hideDefaultLegend();

    const layer = host.regulationsG;
    layer.style('display', null);

    renderNonDataCountryLabels(layer as any, host);

    const countriesG = layer.append('g').attr('class', 'bl-countries');
    wireBuildableLandCountryLayer(countriesG as any, host);

    renderEligibleShareLegend(layer as any, host);

    renderStats();
    renderBuildableLandLegend();
}

function buildLegendHTML(): string {
    return `
        <span><span class="bl-legend-swatch" style="background: ${C_AVAIL_GREEN};"></span>High eligible share</span>
        <span><span class="bl-legend-swatch" style="background: ${C_NO_DATA};"></span>No data / no raster baked</span>
        <span style="font-style:italic;opacity:0.8;">Click a country for raster detail + applied rules</span>`;
}

function rasterPngPath(sidecarJsonPath: string, view: OverlayView = activeOverlayView): string {
    const base = sidecarJsonPath.replace(/\.json$/, '');
    if (view === 'availability') return `${base}_availability.png`;
    return `${base}_styled.png`;
}

function buildCountryTooltip(name: string | undefined): string {
    if (!name) return '';
    const meta = Object.values(DATA_COUNTRIES).find(c => c.geojsonName === name);
    if (!meta) return `<strong>${escapeHtml(name)}</strong><br><span style="opacity:0.8;">No build-codes data yet</span>`;

    const agg = aggregateCountryData().get(meta.geojsonName);
    if (!agg || agg.bakeCount === 0) {
        return `<strong>${escapeHtml(name)}</strong><br>Rule data available; <em>${TECH_LABEL[activeTech]}</em> raster not yet baked.<br><em style="opacity:0.85;">Click for rule list</em>`;
    }
    return `<strong>${escapeHtml(name)}</strong><br>
            ${TECH_LABEL[activeTech]} eligible share: <strong>${(agg.eligibleShare * 100).toFixed(1)}%</strong><br>
            ${Math.round(agg.buildableKm2).toLocaleString()} km² of ${Math.round(agg.regionKm2).toLocaleString()} km² (${agg.bakeCount} region${agg.bakeCount > 1 ? 's' : ''})<br>
            <em style="opacity:0.85;">Click for rules + raster detail</em>`;
}

// ---------------------------------------------------------------------------
// Country detail (split layout)
// ---------------------------------------------------------------------------

async function renderCountryDetail(name: string) {
    const stage = document.getElementById('bl-stage');
    if (!stage) return;
    const meta = Object.values(DATA_COUNTRIES).find(c => c.geojsonName === name);
    if (!meta) {
        stage.innerHTML = `<div class="bl-empty">No data for ${escapeHtml(name)}.</div>`;
        return;
    }

    const feature = findCountryBoundaryFeature(meta);
    if (!feature) {
        stage.innerHTML = `<div class="bl-empty">No boundary geometry for ${escapeHtml(name)}.</div>`;
        return;
    }

    stage.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div>
                <h3 style="margin:0;font-size:18px;font-weight:700;color:${C_FOREST};">${escapeHtml(meta.name)}</h3>
                <p style="margin:2px 0 0 0;font-size:12px;color:${C_PRIMARY};">
                    ${TECH_LABEL[activeTech]} · ${MODE_LABEL[activeMode]} · primary region <strong>${meta.nutsPrimary}</strong>
                </p>
            </div>
            <button class="bl-back-btn" id="bl-back-btn">← Back to world</button>
        </div>
        <div class="bl-detail">
            <div class="bl-map-wrap" id="bl-map-wrap"></div>
            <div class="bl-rule-panel" id="bl-rule-panel">
                <div class="bl-empty" style="min-height:120px;">Loading rules…</div>
            </div>
        </div>
    `;

    document.getElementById('bl-back-btn')?.addEventListener('click', () => {
        selectedCountry = null;
        renderBuildableLandLegend();
        document.dispatchEvent(new CustomEvent('buildable-land:refresh'));
    });

    drawCountryMap(feature, meta);
    void loadAndRenderRules(meta);

    requestAnimationFrame(() => {
        smoothScrollTo(stage, 1200);
    });
}

function smoothScrollTo(target: HTMLElement, durationMs: number): void {
    const start = window.scrollY;
    const rect = target.getBoundingClientRect();
    const end = start + rect.top - 20;
    const distance = end - start;
    if (Math.abs(distance) < 2) return;

    let startTime: number | null = null;
    function step(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        window.scrollTo(0, start + distance * ease);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function findCountryBoundaryFeature(meta: { iso2: string; geojsonName: string }) {
    // Prefer GISCO NUTS-0 outline for cleaner/high-fidelity borders.
    if (nuts0?.features?.length) {
        const fromNuts = (nuts0.features as any[]).find((f: any) => {
            const p = f?.properties || {};
            return p.CNTR_CODE === meta.iso2 || p.CNTR_ID === meta.iso2 || p.NUTS_ID === meta.iso2;
        });
        if (fromNuts) return fromNuts;
    }
    // Fallback to the shared world-map GeoJSON.
    const world = getMapHost()?.geoData;
    return (world?.features as any[] | undefined)?.find(f => f.properties?.name === meta.geojsonName) ?? null;
}

async function overlayWorldRasters(
    mapLayer: d3.Selection<SVGGElement, unknown, null, undefined>,
    projection: d3.GeoProjection,
) {
    if (!manifest) return;
    const baseUrl = (import.meta as any).env.BASE_URL || '/';
    const overlayLayer = mapLayer.append('g')
        .attr('class', 'bl-world-overlay-layer')
        .style('pointer-events', 'none');

    for (const meta of Object.values(DATA_COUNTRIES)) {
        const bakes = findCountryBakes(meta);
        if (bakes.length === 0) continue;
        const ordered = [...bakes].sort((a, b) => b.region_km2 - a.region_km2);

        for (const bake of ordered) {
            let sidecar: Sidecar | null = null;
            try {
                sidecar = await fetch(`${baseUrl}data/${bake.sidecar}`).then(r => r.ok ? r.json() : null);
            } catch {
                sidecar = null;
            }
            if (!sidecar) continue;

            const [minLng, minLat, maxLng, maxLat] = sidecar.georef.bounds_wgs84;
            const tl = projection([minLng, maxLat]);
            const br = projection([maxLng, minLat]);
            if (!tl || !br) continue;

            const pngHref = `${baseUrl}data/${rasterPngPath(bake.sidecar)}`;
            overlayLayer.append('image')
                .attr('class', 'bl-world-raster')
                .style('pointer-events', 'none')
                .attr('x', tl[0]).attr('y', tl[1])
                .attr('width', br[0] - tl[0])
                .attr('height', br[1] - tl[1])
                .attr('preserveAspectRatio', 'none')
                .attr('href', pngHref)
                .attr('xlink:href', pngHref)
                .on('error', function () {
                    if (activeOverlayView !== 'availability') return;
                    const fallback = `${baseUrl}data/${rasterPngPath(bake.sidecar, 'exclusions')}`;
                    d3.select(this).attr('href', fallback).attr('xlink:href', fallback);
                });
        }
    }
}

function drawCountryMap(feature: any, meta: { iso2: string; nutsPrimary: string; name: string }) {
    const wrap = document.getElementById('bl-map-wrap');
    if (!wrap || !feature) return;

    const w = wrap.clientWidth || 600;
    const h = Math.max(440, Math.min(620, Math.round(w * 0.85)));

    const svg = d3.select(wrap).append('svg')
        .attr('class', 'bl-country-svg')
        .attr('viewBox', `0 0 ${w} ${h}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const projection = geoMercator().fitSize([w - 8, h - 8], feature);
    projection.translate([projection.translate()[0] + 4, projection.translate()[1] + 4]);
    const path = geoPath().projection(projection as any);

    const mapLayer = svg.append('g').attr('class', 'bl-country-layer');
    mapLayer.append('path')
        .datum(feature)
        .attr('class', 'country-shape')
        .attr('d', path as any);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 10])
        .translateExtent([[0, 0], [w, h]])
        .on('zoom', (event) => {
            mapLayer.attr('transform', event.transform);
        });
    svg.call(zoom as any);

    // Asynchronously fetch the sidecar and overlay the baked PNG if available.
    void overlayRasterIfBaked(mapLayer as any, projection as any, meta, h);
}

async function overlayRasterIfBaked(
    mapLayer: d3.Selection<SVGGElement, unknown, null, undefined>,
    projection: d3.GeoProjection,
    meta: { iso2: string; nutsPrimary: string; name: string },
    mapHeight: number,
) {
    const baseUrl = (import.meta as any).env.BASE_URL || '/';
    const bakes = findCountryBakes(meta);
    const overlayLayer = mapLayer.append('g').attr('class', 'bl-overlay-layer');

    if (bakes.length === 0) {
        overlayLayer.append('text')
            .attr('x', 12).attr('y', 22)
            .style('font-size', '12px').style('font-weight', '600')
            .style('fill', C_PRIMARY)
            .text(`${TECH_LABEL[activeTech]} · ${MODE_LABEL[activeMode]} raster not yet baked.`);
        overlayLayer.append('text')
            .attr('x', 12).attr('y', 40)
            .style('font-size', '11px').style('fill', C_PRIMARY).style('font-style', 'italic')
            .text(`Run: python scripts/build_buildable_rasters.py --region ${meta.nutsPrimary} --tech ${activeTech} --mode ${activeMode}`);
        return;
    }

    // Sort biggest-area first so country-level layers paint under sub-regional
    // ones (e.g. federal DE under Bayern's 10H detail).
    const ordered = [...bakes].sort((a, b) => b.region_km2 - a.region_km2);
    let totalBuildableKm2 = 0;
    let totalRegionKm2 = 0;

    for (const bake of ordered) {
        let sidecar: Sidecar | null = null;
        try {
            const resp = await fetch(`${baseUrl}data/${bake.sidecar}`);
            sidecar = await resp.json();
        } catch (err) {
            console.warn('Failed to load sidecar for', bake.region, err);
            continue;
        }
        if (!sidecar) continue;

        const [minLng, minLat, maxLng, maxLat] = sidecar.georef.bounds_wgs84;
        const tl = projection([minLng, maxLat]);
        const br = projection([maxLng, minLat]);
        if (!tl || !br) continue;

        const pngHref = `${baseUrl}data/${rasterPngPath(bake.sidecar)}`;
        overlayLayer.append('image')
            .attr('x', tl[0]).attr('y', tl[1])
            .attr('width',  br[0] - tl[0])
            .attr('height', br[1] - tl[1])
            .attr('preserveAspectRatio', 'none')
            .attr('href', pngHref)
            .attr('xlink:href', pngHref)
            .on('error', function () {
                if (activeOverlayView !== 'availability') return;
                const fallback = `${baseUrl}data/${rasterPngPath(bake.sidecar, 'exclusions')}`;
                d3.select(this).attr('href', fallback).attr('xlink:href', fallback);
            });

        totalBuildableKm2 += bake.buildable_km2;
        totalRegionKm2    += bake.region_km2;
    }

    if (totalRegionKm2 === 0) return;
    const fraction = totalBuildableKm2 / totalRegionKm2;
    const regionList = ordered.map(b => b.region).join(', ');
    const badge = mapLayer.append('g').attr('transform', `translate(12, ${mapHeight - 56})`);
    badge.append('rect')
        .attr('width', 268).attr('height', 44)
        .attr('rx', 8)
        .attr('fill', '#ffffff').attr('stroke', C_BORDER);
    badge.append('text')
        .attr('x', 10).attr('y', 18)
        .style('font-size', '12px').style('font-weight', '700').style('fill', C_FOREST)
        .text(`${(fraction * 100).toFixed(1)}% eligible for ${TECH_LABEL[activeTech].toLowerCase()}`);
    badge.append('text')
        .attr('x', 10).attr('y', 34)
        .style('font-size', '10.5px').style('fill', C_PRIMARY)
        .text(`${Math.round(totalBuildableKm2).toLocaleString()} km² of ${Math.round(totalRegionKm2).toLocaleString()} km² · ${regionList}`);
}

function findCountryBakes(meta: { iso2: string; nutsPrimary: string }): ManifestEntry[] {
    if (!manifest) return [];
    return Object.values(manifest.bakes).filter(b =>
        b.tech === activeTech && b.mode === activeMode && b.region.startsWith(meta.iso2)
    );
}

function findPrimaryBake(meta: { iso2: string; nutsPrimary: string }): ManifestEntry | null {
    const matches = findCountryBakes(meta);
    if (matches.length === 0) return null;
    const primary = matches.find(b => b.region === meta.nutsPrimary);
    if (primary) return primary;
    return matches.reduce((a, b) => (a.region_km2 > b.region_km2 ? a : b));
}

async function loadAndRenderRules(meta: { iso2: string; nutsPrimary: string; name: string }) {
    const panel = document.getElementById('bl-rule-panel');
    if (!panel) return;
    const baseUrl = (import.meta as any).env.BASE_URL || '/';
    const bake = findPrimaryBake(meta);

    let sidecar: Sidecar | null = null;
    if (bake) {
        try {
            const resp = await fetch(`${baseUrl}data/${bake.sidecar}`);
            sidecar = await resp.json();
        } catch { /* fall through */ }
    }

    if (!sidecar) {
        panel.innerHTML = `
            <h4>${escapeHtml(meta.name)} — ${TECH_LABEL[activeTech]} rules</h4>
            <p class="bl-sub">No baked sidecar yet. Run the pipeline to populate this panel:</p>
            <pre style="background:#fff;padding:10px;border-radius:6px;border:1px solid ${C_BORDER};font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">python scripts/build_buildable_rasters.py --region ${meta.nutsPrimary} --tech ${activeTech} --mode ${activeMode}</pre>
        `;
        return;
    }

    const applied = sidecar.applied_rules.filter(r => r.applied);
    const skipped = sidecar.applied_rules.filter(r => !r.applied);

    const eligibleShare = sidecar.pixel_stats.eligible_share
        ?? sidecar.pixel_stats.buildable_fraction_of_region;

    panel.innerHTML = `
        <h4>${escapeHtml(meta.name)} — ${TECH_LABEL[activeTech]} rules (${applied.length})</h4>
        <p class="bl-sub">
            ${MODE_LABEL[activeMode]} · primary region <strong>${escapeHtml(sidecar.region)}</strong>
            · eligible share <strong>${(eligibleShare * 100).toFixed(1)}%</strong>
            (${Math.round(sidecar.pixel_stats.buildable_km2).toLocaleString()} km²)
            · turbine H=${sidecar.turbine_geometry.tip_height_m}m / blade=${sidecar.turbine_geometry.blade_length_m}m
        </p>
        <div id="bl-applied-list">${applied.map(r => ruleCardHTML(r)).join('') || `<div class="bl-empty" style="min-height:80px;">No applicable spatial setbacks for this tech in this region.</div>`}</div>
        ${skipped.length > 0 ? `
            <p class="bl-sub" style="margin-top:14px;">Rules in dataset that did <em>not</em> contribute to the raster (${skipped.length})</p>
            <div>${skipped.map(r => ruleCardHTML(r, true)).join('')}</div>
        ` : ''}
    `;
}

function ruleCardHTML(r: AppliedRule, isSkipped = false): string {
    const setbackTxt = r.setback_m === 0
        ? 'exclusion (no buffer)'
        : `${r.setback_m.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`;
    const bindTag = r.legally_binding
        ? `<span class="bl-rule-tag bind">binding</span>`
        : `<span class="bl-rule-tag guide">guideline</span>`;
    const yearTag = r.year ? `<span class="bl-rule-tag">${r.year}</span>` : '';
    const skipTag = isSkipped ? `<span class="bl-rule-tag skipped">skipped</span>` : '';
    const multTag = r.multiplier_resolved ? `<span class="bl-rule-tag">multiplier resolved</span>` : '';
    const variableLabel = humaniseVariable(r.variable);
    const cond = r.condition ? `<div class="bl-rule-cond">${escapeHtml(r.condition)}</div>` : '';
    const reason = isSkipped && r.reason ? `<div class="bl-rule-cond" style="color:${C_BRICK};">↳ ${escapeHtml(r.reason)}</div>` : '';
    const sourceBits: string[] = [];
    if (r.source_name) sourceBits.push(escapeHtml(r.source_name));
    if (r.source_link) sourceBits.push(`<a href="${escapeHtml(r.source_link)}" target="_blank" rel="noopener noreferrer">official source</a>`);
    const source = sourceBits.length > 0 ? `<div class="bl-rule-source">${sourceBits.join(' · ')}</div>` : '';
    const featureBits = r.feature_count > 0
        ? `<span class="bl-rule-tag" style="background:${C_SURFACE};">${r.feature_count.toLocaleString()} OSM features</span>`
        : '';

    return `
        <div class="bl-rule-card ${isSkipped ? 'is-skipped' : ''}">
            <div class="bl-rule-card-row1">
                <span class="bl-rule-value">${escapeHtml(variableLabel)}: ${escapeHtml(setbackTxt)}</span>
                ${bindTag} ${yearTag} ${multTag} ${featureBits} ${skipTag}
            </div>
            ${cond}
            ${reason}
            ${source}
        </div>
    `;
}

function humaniseVariable(v: string): string {
    // Strip the "n_" prefix and capitalize the rest.
    const stripped = v.replace(/^\d+_/, '').replace(/_/g, ' ');
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ---------------------------------------------------------------------------
// Tooltip helpers
// ---------------------------------------------------------------------------

let tooltip: HTMLDivElement | null = null;
function ensureTooltip(): HTMLDivElement {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'bl-tooltip';
    tooltip.style.visibility = 'hidden';
    document.body.appendChild(tooltip);
    return tooltip;
}
function tooltipShow(html: string, e: MouseEvent) {
    const t = ensureTooltip();
    t.innerHTML = html;
    t.style.visibility = 'visible';
    tooltipMove(e);
}
function tooltipMove(e: MouseEvent) {
    const t = ensureTooltip();
    t.style.left = `${e.clientX + 14}px`;
    t.style.top  = `${e.clientY + 14}px`;
}
function tooltipHide() {
    if (tooltip) tooltip.style.visibility = 'hidden';
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
