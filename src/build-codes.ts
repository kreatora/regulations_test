/**
 * Build Codes — sub-national renewable & EV build-regulation visualisations.
 *
 * Mounted under the Regulations mode on the world-map page. It currently
 * exposes the constraint-pressure count map plus shared helpers for rule
 * inspection.
 */
import * as d3 from 'd3';
import { geoMercator, geoPath } from 'd3-geo';
import polylabel from 'polylabel';
import type { MapHost } from './map-host';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuleValue {
    value: number | null;
    unit: string | null;
    condition: string | null;
}
interface Rule {
    kind: 'wind' | 'solar' | 'ev';
    policy_id?: string | null;
    policy_effect?: 'constraining' | 'promoting' | string | null;
    nuts: string;
    nuts_name: string | null;
    country: string;
    year_decision: number | null;
    location_or_characteristics: string | null;
    variable: string;
    installation_type: string | null;
    installation_scale: string | null;
    min_or_max: string | null;
    multiple_conditions: string | null;
    values: RuleValue[];
    legally_binding: string | null;
    explicitly_mentioned: string | null;
    source_name: string | null;
    source_id: string | null;
    source_section: string | null;
    source_link: string | null;
    source_alternative: string | null;
    text_original: string | null;
    text_translation: string | null;
    miscellaneous: string | null;
    status?: string | null;
    active: string | null;
    validated: string | null;
}
interface BuildData {
    meta: any;
    rules: Rule[];
    wind_priority_areas: Array<{
        nuts: string;
        nuts_name: string | null;
        country: string | null;
        indicator: string | null;
        source_link: string | null;
        text_original: string | null;
        text_translation: string | null;
    }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTRIES = [
    { code: 'DE', name: 'Germany', nutsLevel: 1 as 1 | 3, color: '#1F8A65' },
    { code: 'EL', name: 'Greece',  nutsLevel: 3 as 1 | 3, color: '#2E79B5' },
    { code: 'IE', name: 'Ireland', nutsLevel: 3 as 1 | 3, color: '#7B64B8' },
];

const VARIABLE_TAXONOMY = [
    '1_distance_residential buildings',
    '2_distance_motorway',
    '3_distance_off_shore',
    '4_distance_coast_on_shore',
    '5_distance_airports',
    '6_distance_transmission lines',
    '7_distance_railways',
    '8_distance_military areas',
    '9_distance_others',
    '10_turbine height',
    '11_rotor size',
    '12_lot size',
    '13_noise limits',
    '14_shadow flicker',
    '15_exclusion area',
    '16_priority area',
    '17_other installation limitation',
    '18_distance_roof',
    '19_solar height',
    '20_installation requirement',
    '21_distance_charging_station',
];

const VARIABLE_LABELS: Record<string, string> = {
    '1_distance_residential buildings': 'Residential buildings',
    '2_distance_motorway': 'Motorways',
    '3_distance_off_shore': 'Offshore distance',
    '4_distance_coast_on_shore': 'Coast (onshore)',
    '5_distance_airports': 'Airports',
    '6_distance_transmission lines': 'Transmission lines',
    '7_distance_railways': 'Railways',
    '8_distance_military areas': 'Military areas',
    '9_distance_others': 'Other distances',
    '10_turbine height': 'Turbine height',
    '11_rotor size': 'Rotor size',
    '12_lot size': 'Lot size',
    '13_noise limits': 'Noise limits',
    '14_shadow flicker': 'Shadow flicker',
    '15_exclusion area': 'Exclusion areas',
    '16_priority area': 'Priority areas',
    '17_other installation limitation': 'Other limits',
    '18_distance_roof': 'Roof distances',
    '19_solar height': 'Solar height',
    '20_installation requirement': 'Install. requirements',
    '21_distance_charging_station': 'Charging-station distance',
};

const TECH_COLORS: Record<string, string> = {
    wind: '#0d9488',
    solar: '#f59e0b',
    ev: '#7c3aed',
};

// Eurostat GISCO — NUTS-2021, EPSG:4326, 60M simplification.
const GISCO_BASE = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson';
const NUTS_URLS: Record<number, string> = {
    0: `${GISCO_BASE}/NUTS_RG_60M_2021_4326_LEVL_0.geojson`,
    1: `${GISCO_BASE}/NUTS_RG_60M_2021_4326_LEVL_1.geojson`,
    2: `${GISCO_BASE}/NUTS_RG_60M_2021_4326_LEVL_2.geojson`,
    3: `${GISCO_BASE}/NUTS_RG_60M_2021_4326_LEVL_3.geojson`,
};

const CITATION_BUILD =
    'D2.2.1.1 Data collection — Regulations for energy infrastructure (Feb 2025). Sustainability Transition Policy Group, FAU Erlangen-Nürnberg. Demo visualisations only — values are taken verbatim from the dataset; the buildable-land model is illustrative.';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let data: BuildData | null = null;
let nutsCache = new Map<number, any>();
let initialised = false;
let dataLoadPromise: Promise<void> | null = null;

export interface BuildCodesFilters {
    tech: string;
    bind: string;
}

// ---------------------------------------------------------------------------
// Boot — initialise when the Regulations submenu requests Build Codes
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('build-codes:show', () => {
        void ensureBuildCodesDataLoaded();
    });
});

export async function ensureBuildCodesDataLoaded(): Promise<void> {
    if (data) return;
    if (dataLoadPromise) return dataLoadPromise;

    dataLoadPromise = (async () => {
        const baseUrl = (import.meta as any).env.BASE_URL || '/';
        const resp = await fetch(`${baseUrl}data/build_regulations.json`);
        data = await resp.json();
        initialised = true;
        renderBuildCodesAux();
    })().catch((err) => {
        dataLoadPromise = null;
        console.error('Failed to load build_regulations.json', err);
        throw err;
    });

    return dataLoadPromise;
}

function renderBuildCodesAux() {
    const root = document.getElementById('build-codes-view');
    if (!root) return;
    root.innerHTML = `
        <style>
            .bc-shell { position: relative; min-height: 96px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #1e293b; padding: 4px 2px 0 2px; }
            .bc-citation { font-size: 9.5px; color: #64748b; margin-top: 8px; padding: 10px 14px; background: #f8fafc; border-radius: 10px; line-height: 1.5; border: 1px solid rgba(148, 163, 184, 0.25); }
            .bc-no-data { display: flex; align-items: center; justify-content: center; min-height: 80px; color: rgb(100, 116, 139); font-size: 13px; font-style: italic; text-align: center; }
            .bc-rule-card { padding: 12px 14px; border-left: 3px solid #cbd5e1; border-radius: 8px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.04); margin-bottom: 8px; cursor: pointer; transition: all 0.15s ease; }
            .bc-rule-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateX(2px); }
            .bc-rule-card.wind   { border-left-color: ${TECH_COLORS.wind}; }
            .bc-rule-card.solar  { border-left-color: ${TECH_COLORS.solar}; }
            .bc-rule-card.ev     { border-left-color: ${TECH_COLORS.ev}; }
            .bc-rule-card-row1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
            .bc-rule-tag { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: rgba(148, 163, 184, 0.18); color: rgb(51, 65, 85); font-weight: 600; letter-spacing: 0.3px; }
            .bc-rule-tag.bind { background: rgba(15, 118, 110, 0.15); color: rgb(15, 118, 110); }
            .bc-rule-tag.guide { background: rgba(217, 119, 6, 0.15); color: rgb(180, 83, 9); }
            .bc-rule-value { font-size: 14px; font-weight: 700; color: rgb(15, 23, 42); }
            .bc-rule-cond { font-size: 11.5px; color: rgb(71, 85, 105); margin-top: 2px; line-height: 1.4; }
            .bc-rule-source { font-size: 10.5px; color: rgb(100, 116, 139); margin-top: 4px; font-style: italic; }
            .bc-modal-bd { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 24px; }
            .bc-modal { background: #ffffff; border-radius: 14px; max-width: 1100px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
            .bc-modal-h { padding: 16px 22px; background: rgb(30, 41, 59); color: #ffffff; display: flex; justify-content: space-between; align-items: center; }
            .bc-modal-h h3 { margin: 0; font-size: 15px; font-weight: 700; }
            .bc-modal-x { background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; line-height: 1; padding: 0; width: 28px; height: 28px; }
            .bc-modal-body { padding: 22px; overflow-y: auto; flex: 1; }
            .bc-bilingual { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
            .bc-bilingual-col h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: rgb(100, 116, 139); margin: 0 0 8px 0; font-weight: 700; }
            .bc-bilingual-col pre { white-space: pre-wrap; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.55; color: rgb(30, 41, 59); margin: 0; padding: 14px; background: #f8fafc; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.3); max-height: 400px; overflow-y: auto; }
            @media (max-width: 768px) { .bc-bilingual { grid-template-columns: 1fr; } }
            .bc-tooltip { position: fixed; background: rgba(15, 23, 42, 0.95); color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; pointer-events: none; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.2); max-width: 280px; line-height: 1.5; }
            .bc-tooltip strong { color: #93c5fd; }
        </style>
        <div class="bc-shell">
            <div class="bc-citation"><strong>Source:</strong> ${CITATION_BUILD}</div>
        </div>
    `;
}

function renderPanelPressureLegend(maxAbs: number) {
    const legend = document.getElementById('regulations-map-panel-legend');
    if (!legend) return;
    legend.style.display = 'block';
    legend.innerHTML = `
        <div class="regulations-map-panel-legend-title">Net policy pressure</div>
        <div class="regulations-map-panel-legend-bar"></div>
        <div class="regulations-map-panel-legend-labels">
            <span>Promoting</span>
            <span>Constraining</span>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * NUTS inheritance: rules at NUTS-0 (DE / EL / IE) apply to every region inside
 * that country; NUTS-1 rules apply to every NUTS-3 within that NUTS-1; and so on.
 * Returns all rules whose NUTS code is a prefix of `regionCode`.
 */
function rulesForRegion(regionCode: string): Rule[] {
    if (!data) return [];
    return data.rules.filter((r) => {
        if (!regionCode.startsWith(r.nuts)) return false;
        const status = (r.status ?? r.active ?? '').toLowerCase();
        return status !== 'inactive' && status !== 'overwritten';
    });
}

function regulationMetrics(rules: Rule[]) {
    const constrainingCount = rules.filter(r => (r.policy_effect || 'constraining').toLowerCase() !== 'promoting').length;
    const promotingCount = rules.filter(r => (r.policy_effect || '').toLowerCase() === 'promoting').length;
    const bindingCount = rules.filter(r => (r.legally_binding || '').toLowerCase().startsWith('y')).length;
    const policyCount = new Set(rules.map(r => r.policy_id || r.source_id || r.source_name || `${r.country}-${r.year_decision}-${r.variable}`)).size;
    return {
        regulationCount: rules.length,
        policyCount,
        bindingCount,
        constrainingCount,
        promotingCount,
        netScore: constrainingCount - promotingCount,
    };
}

async function loadNuts(level: number): Promise<any> {
    if (nutsCache.has(level)) return nutsCache.get(level);
    const resp = await fetch(NUTS_URLS[level]);
    if (!resp.ok) throw new Error(`Failed to load NUTS-${level}`);
    const json = await resp.json();
    nutsCache.set(level, json);
    return json;
}

/** Prefer GISCO Latin names (NAME_LATN) over local-script NUTS_NAME for map labels. */
function nutsDisplayName(props: { NAME_LATN?: string; NUTS_NAME?: string; NUTS_ID?: string }): string {
    const latin = String(props.NAME_LATN || '').trim();
    const local = String(props.NUTS_NAME || '').trim();
    if (latin) return latin;
    return local || String(props.NUTS_ID || '').trim();
}

function svgWatermark(svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>, w: number) {
    const baseUrl = (import.meta as any).env.BASE_URL || '/';
    setTimeout(() => {
        svg.append('image')
            .attr('href', `${baseUrl}images/CLIMATE POLICY ATLAS LOGO-Photoroom.png`)
            .attr('x', w - 80).attr('y', 10).attr('width', 70).attr('height', 70)
            .style('opacity', 0.22).style('pointer-events', 'none');
    }, 30);
}

function tooltipShow(html: string, e: MouseEvent) {
    let tip = document.querySelector('.bc-tooltip') as HTMLDivElement | null;
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'bc-tooltip';
        document.body.appendChild(tip);
    }
    tip.innerHTML = html;
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.style.display = 'block';
}
function tooltipHide() {
    const tip = document.querySelector('.bc-tooltip') as HTMLDivElement | null;
    if (tip) tip.style.display = 'none';
}

function ruleCardHTML(r: Rule): string {
    const isPromoting = (r.policy_effect || '').toLowerCase() === 'promoting';
    const v = r.values[0];
    const isBind = (r.legally_binding || '').toLowerCase().startsWith('y');
    const valStr = v ? `${r.min_or_max ? r.min_or_max + ' ' : ''}${v.value ?? '—'}${v.unit ? ' ' + v.unit : ''}` : '—';
    const cond = v?.condition ? `<div class="bc-rule-cond">${escapeHtml(v.condition)}</div>` : '';
    const src = r.source_name ? `<div class="bc-rule-source">${escapeHtml(r.source_name.split('\n')[0])}${r.year_decision ? ' · ' + r.year_decision : ''}</div>` : '';
    return `<div class="bc-rule-card ${r.kind}" data-rule="${ruleKey(r)}">
        <div class="bc-rule-card-row1">
            <span class="bc-rule-tag">${VARIABLE_LABELS[r.variable] || r.variable}</span>
            <span class="bc-rule-tag">${r.kind.toUpperCase()}</span>
            <span class="bc-rule-tag ${isPromoting ? 'guide' : 'bind'}">${isPromoting ? 'promoting' : 'constraining'}</span>
            <span class="bc-rule-tag ${isBind ? 'bind' : 'guide'}">${isBind ? 'binding' : 'guideline'}</span>
            <span class="bc-rule-tag">${r.nuts}</span>
        </div>
        <div class="bc-rule-value">${escapeHtml(valStr)}</div>
        ${cond}
        ${src}
    </div>`;
}
function ruleKey(r: Rule): string { return `${r.policy_id || ''}|${r.kind}|${r.nuts}|${r.variable}|${r.year_decision}|${r.source_id || r.source_name || ''}|${r.values[0]?.value ?? ''}`; }
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

function attachRuleCardHandlers(container: HTMLElement) {
    container.querySelectorAll<HTMLDivElement>('.bc-rule-card').forEach(card => {
        card.addEventListener('click', () => {
            const key = card.dataset.rule;
            const r = data?.rules.find(rr => ruleKey(rr) === key);
            if (r) showSourceModal(r);
        });
    });
}

function showSourceModal(r: Rule) {
    const sourceLine = [r.source_name, r.source_section].filter(Boolean).join(' · ');
    const link = r.source_link
        ? `<a href="${r.source_link}" target="_blank" rel="noopener" style="color:#3685BF;font-weight:600;">Open official source ↗</a>`
        : '<span style="color:#94a3b8;">No public link recorded</span>';

    const valuesHtml = r.values.map((v, i) => {
        const parts = [
            v.value != null ? `<strong>${v.value}</strong>` : '',
            v.unit || '',
            v.condition ? `<span style="color:rgb(100,116,139);">— ${escapeHtml(v.condition)}</span>` : '',
        ].filter(Boolean).join(' ');
        return `<div style="font-size:12.5px;line-height:1.5;margin-bottom:6px;"><span style="color:rgb(100,116,139);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Cond. ${i + 1}</span> ${parts}</div>`;
    }).join('');

    const isBind = (r.legally_binding || '').toLowerCase().startsWith('y');
    const isPromoting = (r.policy_effect || '').toLowerCase() === 'promoting';
    const tagBind = isBind
        ? `<span class="bc-rule-tag bind">Legally binding</span>`
        : `<span class="bc-rule-tag guide">Guideline only</span>`;

    const html = `
        <div class="bc-modal-bd" id="bc-modal-bd">
            <div class="bc-modal" onclick="event.stopPropagation()">
                <div class="bc-modal-h">
                    <h3>${escapeHtml(VARIABLE_LABELS[r.variable] || r.variable)} — ${escapeHtml(r.nuts_name || r.nuts)}</h3>
                    <button class="bc-modal-x" id="bc-modal-x">&times;</button>
                </div>
                <div class="bc-modal-body">
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
                        <span class="bc-rule-tag" style="background:${TECH_COLORS[r.kind]}33;color:${TECH_COLORS[r.kind]};">${r.kind.toUpperCase()}</span>
                        ${tagBind}
                        <span class="bc-rule-tag ${isPromoting ? 'guide' : 'bind'}">${isPromoting ? 'Promoting policy' : 'Constraining policy'}</span>
                        <span class="bc-rule-tag">NUTS ${r.nuts}</span>
                        <span class="bc-rule-tag">${r.country}</span>
                        ${r.year_decision ? `<span class="bc-rule-tag">${r.year_decision}</span>` : ''}
                        ${r.installation_type ? `<span class="bc-rule-tag">${escapeHtml(r.installation_type)}</span>` : ''}
                        ${r.installation_scale ? `<span class="bc-rule-tag">scale: ${escapeHtml(r.installation_scale)}</span>` : ''}
                        ${r.multiple_conditions ? `<span class="bc-rule-tag">${escapeHtml(r.multiple_conditions)}</span>` : ''}
                        ${(r.validated || '').toLowerCase().startsWith('y') ? `<span class="bc-rule-tag bind">Validated</span>` : ''}
                    </div>
                    <div style="margin-bottom:14px;">${valuesHtml || '<em style="color:rgb(100,116,139);">No quantitative value (textual rule)</em>'}</div>
                    <div class="bc-bilingual">
                        <div class="bc-bilingual-col">
                            <h4>Original text</h4>
                            <pre>${r.text_original ? escapeHtml(r.text_original) : 'Not transcribed'}</pre>
                        </div>
                        <div class="bc-bilingual-col">
                            <h4>English translation</h4>
                            <pre>${r.text_translation ? escapeHtml(r.text_translation) : 'Not translated'}</pre>
                        </div>
                    </div>
                    <div style="margin-top:18px;font-size:12px;color:rgb(71,85,105);line-height:1.6;">
                        <div><strong>Source:</strong> ${escapeHtml(sourceLine || '—')}</div>
                        ${r.source_alternative ? `<div><strong>Alt source:</strong> ${escapeHtml(r.source_alternative)}</div>` : ''}
                        <div style="margin-top:8px;">${link}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('#bc-modal-x')?.addEventListener('click', close);
    wrap.querySelector('#bc-modal-bd')?.addEventListener('click', close);
}

// ---------------------------------------------------------------------------
// LENS 1 — Constraint pressure choropleth (NUTS-1 for DE, NUTS-3 for EL/IE)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Map overlay — NUTS choropleth on the shared world-map SVG
// ---------------------------------------------------------------------------

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

export async function renderBuildCodesOnMap(host: MapHost, filters: BuildCodesFilters): Promise<void> {
    await ensureBuildCodesDataLoaded();
    if (!data) {
        throw new Error('Build codes dataset is not loaded.');
    }

    host.clearRegulationsLayer();
    host.showRegulationBasemap();
    host.hideDefaultLegend();

    const layer = host.regulationsG;
    layer.style('display', null);

    const lvl1 = await loadNuts(1);
    const lvl3 = await loadNuts(3);

    const features: any[] = [];
    for (const f of lvl1.features) {
        if ((f.properties.CNTR_CODE || '').toUpperCase() === 'DE') features.push(f);
    }
    for (const f of lvl3.features) {
        const cc = (f.properties.CNTR_CODE || '').toUpperCase();
        if (cc === 'EL' || cc === 'IE') features.push(f);
    }

    const metricsByCode = new Map<string, { regulationCount: number; policyCount: number; bindingCount: number; constrainingCount: number; promotingCount: number; netScore: number; rules: Rule[] }>();
    for (const f of features) {
        const code = f.properties.NUTS_ID;
        let rs = rulesForRegion(code);
        if (filters.tech !== 'all') rs = rs.filter(r => r.kind === filters.tech);
        if (filters.bind === 'binding') rs = rs.filter(r => (r.legally_binding || '').toLowerCase().startsWith('y'));
        metricsByCode.set(code, { ...regulationMetrics(rs), rules: rs });
    }

    const allScores = Array.from(metricsByCode.values()).map(s => s.netScore);
    const maxAbs = Math.max(1, d3.max(allScores.map(v => Math.abs(v))) || 1);
    const colorScale = d3.scaleDiverging(d3.interpolateRdYlGn).domain([maxAbs, 0, -maxAbs]);
    const path = host.path;

    const regions = layer.append('g').attr('class', 'bc-regions');
    regions.selectAll('.bc-region').data(features).enter().append('path')
        .attr('class', 'bc-region')
        .attr('d', path as any)
        .attr('fill', (d: any) => {
            const score = metricsByCode.get(d.properties.NUTS_ID)?.netScore ?? 0;
            return score !== 0 ? colorScale(score) : '#e2e8f0';
        })
        .attr('stroke', '#fff').attr('stroke-width', 0.6)
        .style('cursor', 'pointer')
        .on('mousemove', (e: any, d: any) => {
            const code = d.properties.NUTS_ID;
            const info = metricsByCode.get(code);
            const label = nutsDisplayName(d.properties);
            tooltipShow(`<strong>${label}</strong> (${code})<br/>Constraining: <strong>${info?.constrainingCount ?? 0}</strong><br/>Promoting: <strong>${info?.promotingCount ?? 0}</strong><br/>Net pressure: <strong>${info?.netScore ?? 0}</strong><br/>Policy count: <strong>${info?.policyCount ?? 0}</strong><br/>Binding regulations: <strong>${info?.bindingCount ?? 0}</strong>`, e);
        })
        .on('mouseleave', tooltipHide)
        .on('click', (_e: any, d: any) => {
            const code = d.properties.NUTS_ID;
            const info = metricsByCode.get(code);
            if (info && info.rules.length > 0) showRegionDetail(nutsDisplayName(d.properties), code, info.rules);
        });

    const code3to2 = host.countryCode3to2;
    const dataCountry2 = new Set(['DE', 'GR', 'IE']);
    const labelFeatures = host.geoData.features.filter((f: any) => {
        const c2 = code3to2[f.id];
        return c2 && !dataCountry2.has(c2);
    });
    const labelsG = layer.append('g').attr('class', 'bc-country-labels');
    labelsG.selectAll('text').data(labelFeatures).enter().append('text')
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

    renderPanelPressureLegend(maxAbs);

    svgWatermark(layer as any, host.width);
}

function showRegionDetail(name: string, code: string, rules: Rule[]) {
    const html = `
        <div class="bc-modal-bd" id="bc-modal-bd">
            <div class="bc-modal" onclick="event.stopPropagation()" style="max-width:780px;">
                <div class="bc-modal-h">
                    <h3>${escapeHtml(name)} — ${escapeHtml(code)} (${rules.length} applicable rules)</h3>
                    <button class="bc-modal-x" id="bc-modal-x">&times;</button>
                </div>
                <div class="bc-modal-body">
                    ${rules.map(r => ruleCardHTML(r)).join('')}
                </div>
            </div>
        </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('#bc-modal-x')?.addEventListener('click', close);
    wrap.querySelector('#bc-modal-bd')?.addEventListener('click', close);
    attachRuleCardHandlers(wrap as unknown as HTMLElement);
}

// ---------------------------------------------------------------------------
// LENS 2 — NUTS drill-down zoom
// ---------------------------------------------------------------------------

async function renderDrilldown(host: HTMLElement) {
    host.innerHTML = `
        <h3 class="bc-h2">NUTS drill-down zoom</h3>
        <p class="bc-sub">Country-level entry. Click <strong>DE</strong>, <strong>EL</strong> or <strong>IE</strong> to zoom into the next NUTS level. Other countries are shown in grey — survey expanding.</p>
        <div id="bc-dd-bar" style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:12.5px;">
            <button class="bc-pill" id="bc-dd-back" disabled style="opacity:0.5;">← Back to Europe</button>
            <span id="bc-dd-crumb" style="margin-left:8px;color:rgb(71,85,105);"></span>
        </div>
        <div id="bc-dd-map"></div>
    `;

    let level: 0 | 1 | 3 = 0;
    let focusedCountry: 'DE' | 'EL' | 'IE' | null = null;

    const draw = async () => {
        const mapHost = document.getElementById('bc-dd-map')!;
        mapHost.innerHTML = `<div class="bc-no-data">Loading NUTS-${level} geometry…</div>`;
        const lvl0 = await loadNuts(0);

        let features: any[];
        let title = 'Europe — NUTS-0';
        if (level === 0) {
            features = lvl0.features;
        } else {
            const lvl = await loadNuts(level);
            features = lvl.features.filter((f: any) => (f.properties.CNTR_CODE || '').toUpperCase() === focusedCountry);
            const focusName = COUNTRIES.find(c => c.code === focusedCountry)?.name || '';
            title = `${focusName} — NUTS-${level}`;
        }

        // Counts per feature
        const info = new Map<string, { score: number; rules: Rule[]; name: string }>();
        for (const f of features) {
            const code = f.properties.NUTS_ID;
            const name = f.properties.NUTS_NAME;
            const rs = rulesForRegion(code);
            info.set(code, { score: regulationMetrics(rs).regulationCount, rules: rs, name });
        }
        const max = Math.max(1, d3.max(Array.from(info.values()).map(v => v.score)) || 1);
        const color = d3.scaleSequential(d3.interpolateGreens).domain([0, max]);

        const w = mapHost.clientWidth || 1100;
        const h = 560;
        mapHost.innerHTML = '';
        const svg = d3.select(mapHost).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', h);

        const projection = geoMercator();
        if (level === 0) {
            // Start framed around surveyed countries so Greece is visible immediately.
            const surveyed = new Set(['DE', 'EL', 'IE', 'FR']);
            const fc0: any = {
                type: 'FeatureCollection',
                features: features.filter((f: any) => surveyed.has(f.properties?.NUTS_ID)),
            };
            projection.fitExtent([[60, 48], [w - 60, h - 24]], fc0 as any);
            // Shift initial view slightly downward so Greece sits in-frame on
            // shorter laptop viewports.
            const [tx, ty] = projection.translate();
            projection.translate([tx, ty + 96]);
        } else {
            const fc: any = { type: 'FeatureCollection', features };
            projection.fitSize([w - 80, h - 80], fc as any);
        }
        const path = geoPath().projection(projection);

        if (level !== 0) {
            // Faded continent background
            svg.selectAll('.bg').data(lvl0.features).enter().append('path')
                .attr('d', path as any).attr('fill', '#f1f5f9').attr('stroke', '#dde3ec').attr('stroke-width', 0.5);
        }

        svg.selectAll('.region').data(features).enter().append('path')
            .attr('d', path as any)
            .attr('fill', (d: any) => {
                const code = d.properties.NUTS_ID;
                if (level === 0) {
                    // At country level, only DE/EL/IE/FR are coloured.
                    const surveyed = ['DE', 'EL', 'IE', 'FR'];
                    if (!surveyed.includes(code)) return '#e2e8f0';
                    const rs = data!.rules.filter(r => r.country === COUNTRIES.find(c => c.code === code)?.name || (code === 'FR' && r.country === 'France'));
                    return d3.interpolateGreens(0.3 + 0.5 * Math.min(1, rs.length / 90));
                }
                const score = info.get(code)?.score ?? 0;
                return score > 0 ? color(score) : '#e2e8f0';
            })
            .attr('stroke', '#fff').attr('stroke-width', 0.6)
            .style('cursor', (d: any) => {
                if (level === 0) return ['DE', 'EL', 'IE'].includes(d.properties.NUTS_ID) ? 'pointer' : 'default';
                return 'pointer';
            })
            .on('mousemove', (e: any, d: any) => {
                if (level === 0) {
                    const code = d.properties.NUTS_ID;
                    const country = COUNTRIES.find(c => c.code === code);
                    if (country) {
                        const total = data!.rules.filter(r => r.country === country.name).length;
                        tooltipShow(`<strong>${country.name}</strong><br/>${total} rules · click to drill into NUTS-${country.nutsLevel}`, e);
                    } else {
                        tooltipShow(`<strong>${d.properties.NUTS_NAME}</strong><br/>Outside surveyed area`, e);
                    }
                } else {
                    const inf = info.get(d.properties.NUTS_ID);
                    tooltipShow(`<strong>${d.properties.NUTS_NAME}</strong> (${d.properties.NUTS_ID})<br/>Pressure score: <strong>${(inf?.score ?? 0).toFixed(0)}</strong><br/>${inf?.rules.length ?? 0} rules · click for details`, e);
                }
            })
            .on('mouseleave', tooltipHide)
            .on('click', (_e: any, d: any) => {
                if (level === 0) {
                    const code = d.properties.NUTS_ID;
                    const c = COUNTRIES.find(cc => cc.code === code);
                    if (c) {
                        focusedCountry = c.code as any;
                        level = c.nutsLevel;
                        (document.getElementById('bc-dd-back') as HTMLButtonElement).disabled = false;
                        (document.getElementById('bc-dd-back') as HTMLButtonElement).style.opacity = '1';
                        document.getElementById('bc-dd-crumb')!.textContent = `${c.name} · NUTS-${c.nutsLevel}`;
                        draw();
                    }
                } else {
                    const inf = info.get(d.properties.NUTS_ID);
                    if (inf) showRegionDetail(d.properties.NUTS_NAME, d.properties.NUTS_ID, inf.rules);
                }
            });

        // Title text
        svg.append('text').attr('x', 16).attr('y', 22).style('font-size', '13px').style('font-weight', '700').style('fill', '#1e293b').text(title);

        svgWatermark(svg as any, w);
    };

    document.getElementById('bc-dd-back')!.addEventListener('click', () => {
        if (level === 0) return;
        level = 0; focusedCountry = null;
        (document.getElementById('bc-dd-back') as HTMLButtonElement).disabled = true;
        (document.getElementById('bc-dd-back') as HTMLButtonElement).style.opacity = '0.5';
        document.getElementById('bc-dd-crumb')!.textContent = '';
        draw();
    });

    draw();
}

// ---------------------------------------------------------------------------
// LENS 3 — Setback decision-line chart (homage to the renewable-targets visual)
// ---------------------------------------------------------------------------

function renderDecisionLines(host: HTMLElement) {
    host.innerHTML = `
        <h3 class="bc-h2">Setback decision lines</h3>
        <p class="bc-sub">Pick a setback variable. Each region's rule is drawn as a horizontal line at its value, starting from the year of decision. Same idiom as the renewable-targets chart on the world map — superseded rules drop into dashed connectors.</p>
        <div class="bc-controls" id="bc-dec-ctl">
            <label>Variable</label>
            <select class="bc-select" id="bc-dec-var">
                ${[
                    '1_distance_residential buildings',
                    '2_distance_motorway',
                    '5_distance_airports',
                    '6_distance_transmission lines',
                    '7_distance_railways',
                    '4_distance_coast_on_shore',
                ].map(v => `<option value="${v}">${VARIABLE_LABELS[v]}</option>`).join('')}
            </select>
            <span style="flex:1"></span>
            <label>Tech</label>
            <button class="bc-pill bc-pill-active" data-tech="wind">Wind</button>
            <button class="bc-pill" data-tech="solar">Solar</button>
            <button class="bc-pill" data-tech="all">All</button>
        </div>
        <div id="bc-dec-chart"></div>
    `;

    let variable = '1_distance_residential buildings';
    let tech = 'wind';

    const draw = () => {
        const chartHost = document.getElementById('bc-dec-chart')!;
        chartHost.innerHTML = '';
        if (!data) return;
        const rules = data.rules.filter(r =>
            r.variable === variable
            && (tech === 'all' || r.kind === tech)
            && r.year_decision
            && r.values[0]?.value != null
            && /m$|metre|meter/i.test(r.values[0]?.unit || ''),
        ).sort((a, b) => (a.year_decision! - b.year_decision!));

        if (rules.length === 0) {
            chartHost.innerHTML = `<div class="bc-no-data">No quantitative rules with units in metres for the selected combination.</div>`;
            return;
        }

        const w = chartHost.clientWidth || 1100;
        const h = 460;
        const margin = { top: 30, right: 220, bottom: 50, left: 70 };
        const innerW = w - margin.left - margin.right;
        const innerH = h - margin.top - margin.bottom;

        const svg = d3.select(chartHost).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', h)
            .style('background', '#f8fafc').style('border-radius', '12px');
        const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

        const minYear = d3.min(rules, r => r.year_decision!) ?? 2000;
        const maxYear = Math.max(2026, d3.max(rules, r => r.year_decision!) ?? 2024);
        const xScale = d3.scaleLinear().domain([minYear - 1, maxYear + 1]).range([0, innerW]);
        const maxVal = d3.max(rules, r => r.values[0]!.value!) || 2000;
        const yScale = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerH, 0]);

        // gridlines
        const gridG = g.append('g');
        gridG.selectAll('.gh').data(yScale.ticks(5)).enter().append('line')
            .attr('x1', 0).attr('x2', innerW)
            .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
            .style('stroke', '#e2e8f0').style('stroke-dasharray', '3,3').style('opacity', 0.6);

        g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(xScale).tickFormat(d => d3.format('d')(d as number)) as any).style('font-size', '11px');
        g.append('g').call(d3.axisLeft(yScale).tickFormat(d => `${d} m`) as any).style('font-size', '11px');

        g.append('text').attr('x', innerW / 2).attr('y', innerH + 36).style('text-anchor', 'middle').style('font-size', '12px').style('font-weight', '600').style('fill', '#475569').text('Year of decision');
        g.append('text').attr('transform', 'rotate(-90)').attr('x', -innerH / 2).attr('y', -50).style('text-anchor', 'middle').style('font-size', '12px').style('font-weight', '600').style('fill', '#475569').text('Setback (m)');

        // Group by region; sort within each by year so we can draw supersede links
        const byRegion = new Map<string, Rule[]>();
        for (const r of rules) {
            const arr = byRegion.get(r.nuts) || [];
            arr.push(r); byRegion.set(r.nuts, arr);
        }

        // Region color: stable per region via interpolatePlasma
        const regions = Array.from(byRegion.keys()).sort();
        const colorScale = d3.scaleOrdinal<string>().domain(regions).range(d3.schemeTableau10.concat(d3.schemeSet3));

        regions.forEach(reg => {
            const arr = byRegion.get(reg)!.sort((a, b) => a.year_decision! - b.year_decision!);
            const color = colorScale(reg) as string;
            arr.forEach((r, i) => {
                const next = arr[i + 1];
                const endYear = next ? next.year_decision! : maxYear;
                // Horizontal line at value
                g.append('line')
                    .attr('x1', xScale(r.year_decision!)).attr('y1', yScale(r.values[0]!.value!))
                    .attr('x2', xScale(endYear)).attr('y2', yScale(r.values[0]!.value!))
                    .attr('stroke', color).attr('stroke-width', 2.4).attr('opacity', next ? 0.45 : 0.95)
                    .style('cursor', 'pointer')
                    .on('mousemove', (e: any) => {
                        tooltipShow(`<strong>${escapeHtml(r.nuts_name || r.nuts)}</strong><br/>${r.values[0]!.value} m from ${r.year_decision}${next ? ` until superseded in ${endYear}` : ''}`, e);
                    })
                    .on('mouseleave', tooltipHide)
                    .on('click', () => showSourceModal(r));
                // Decision dot
                g.append('circle').attr('cx', xScale(r.year_decision!)).attr('cy', yScale(r.values[0]!.value!))
                    .attr('r', 4.5).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 2)
                    .style('cursor', 'pointer')
                    .on('click', () => showSourceModal(r));
                // Dashed supersede connection
                if (next) {
                    g.append('line').attr('x1', xScale(endYear)).attr('x2', xScale(endYear))
                        .attr('y1', yScale(r.values[0]!.value!)).attr('y2', yScale(next.values[0]!.value!))
                        .attr('stroke', color).attr('stroke-width', 1.6).attr('stroke-dasharray', '4,3').attr('opacity', 0.7);
                }
            });
        });

        // Legend
        const legend = svg.append('g').attr('transform', `translate(${w - 200}, ${margin.top})`);
        regions.forEach((reg, i) => {
            const row = legend.append('g').attr('transform', `translate(0, ${i * 16})`);
            row.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 6).attr('y2', 6).attr('stroke', colorScale(reg) as string).attr('stroke-width', 3);
            row.append('text').attr('x', 24).attr('y', 9).style('font-size', '10.5px').style('fill', '#1e293b').text(reg);
        });

        svgWatermark(svg as any, w);
    };

    (document.getElementById('bc-dec-var') as HTMLSelectElement).addEventListener('change', e => { variable = (e.target as HTMLSelectElement).value; draw(); });
    host.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-tech]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); tech = b.dataset.tech!; draw();
    }));
    draw();
}

// ---------------------------------------------------------------------------
// LENS 4 — Variable × Year cell-grid (a region's regulatory profile through time)
// ---------------------------------------------------------------------------

function renderCellGrid(host: HTMLElement) {
    if (!data) return;
    const regions = Array.from(new Set(data.rules.map(r => r.nuts))).sort();
    host.innerHTML = `
        <h3 class="bc-h2">Variable × Year regulatory grid</h3>
        <p class="bc-sub">Rows = the 21 regulation variables. Columns = years. Each cell marks a rule decision in that region. Same visual idiom as the policy-evolution timeline on the world map.</p>
        <div class="bc-controls">
            <label>Region</label>
            <select class="bc-select" id="bc-cg-region">
                <optgroup label="Countries">
                    <option value="DE">DE — Germany</option>
                    <option value="EL">EL — Greece</option>
                    <option value="IE">IE — Ireland</option>
                </optgroup>
                <optgroup label="All NUTS-1/3">
                    ${regions.filter(r => r.length > 2).map(r => `<option value="${r}">${r}</option>`).join('')}
                </optgroup>
            </select>
            <span style="flex:1"></span>
            <label>Inheritance</label>
            <button class="bc-pill bc-pill-active" data-inh="on">Include parent rules</button>
            <button class="bc-pill" data-inh="off">Region-specific only</button>
        </div>
        <div id="bc-cg-chart"></div>
    `;

    let region = 'DE';
    let inheritance = true;

    const draw = () => {
        const chartHost = document.getElementById('bc-cg-chart')!;
        chartHost.innerHTML = '';
        const rs = inheritance ? rulesForRegion(region) : data!.rules.filter(r => r.nuts === region);
        if (rs.length === 0) {
            chartHost.innerHTML = `<div class="bc-no-data">No rules for this region.</div>`;
            return;
        }
        const minYear = d3.min(rs, r => r.year_decision!) ?? 1990;
        const maxYear = Math.max(2024, d3.max(rs, r => r.year_decision!) ?? 2024);
        const years = d3.range(minYear, maxYear + 1);

        const w = chartHost.clientWidth || 1100;
        const margin = { top: 30, right: 50, bottom: 60, left: 240 };
        const innerW = w - margin.left - margin.right;
        const innerH = VARIABLE_TAXONOMY.length * 22;
        const h = innerH + margin.top + margin.bottom;

        const svg = d3.select(chartHost).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', h)
            .style('background', '#f8fafc').style('border-radius', '12px');
        const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

        const xScale = d3.scaleBand<number>().domain(years).range([0, innerW]).padding(0.08);
        const yScale = d3.scaleBand<string>().domain(VARIABLE_TAXONOMY).range([0, innerH]).padding(0.18);

        // Y-axis: variable labels with tech-color swatches based on what kinds of rules each row contains.
        VARIABLE_TAXONOMY.forEach(v => {
            const techsInRow = new Set(rs.filter(r => r.variable === v).map(r => r.kind));
            const swatchSize = 6, gap = 3;
            const techArr = Array.from(techsInRow);
            const grow = g.append('g').attr('transform', `translate(${-margin.left + 8}, ${(yScale(v) || 0) + (yScale.bandwidth() / 2)})`);
            techArr.forEach((t, i) => {
                grow.append('rect').attr('x', i * (swatchSize + gap)).attr('y', -swatchSize / 2)
                    .attr('width', swatchSize).attr('height', swatchSize).attr('rx', 1)
                    .attr('fill', TECH_COLORS[t]);
            });
            grow.append('text').attr('x', techArr.length * (swatchSize + gap) + 4).attr('y', 4)
                .style('font-size', '11px').style('fill', techsInRow.size > 0 ? '#1e293b' : '#94a3b8').style('font-weight', techsInRow.size > 0 ? '600' : '400')
                .text(VARIABLE_LABELS[v] || v);
        });

        // x-axis years
        const xTicks = years.filter((_, i) => i % Math.max(1, Math.ceil(years.length / 22)) === 0);
        g.append('g').attr('transform', `translate(0, ${innerH})`).call(d3.axisBottom(xScale).tickValues(xTicks as any) as any).style('font-size', '10px');

        // gridlines
        VARIABLE_TAXONOMY.forEach(v => {
            g.append('line').attr('x1', 0).attr('x2', innerW)
                .attr('y1', (yScale(v) || 0) + yScale.bandwidth())
                .attr('y2', (yScale(v) || 0) + yScale.bandwidth())
                .style('stroke', '#e2e8f0').style('stroke-dasharray', '2,2').style('opacity', 0.4);
        });

        // cells
        g.selectAll('.cell').data(rs.filter(r => r.year_decision)).enter().append('rect')
            .attr('class', 'cell')
            .attr('x', r => xScale(r.year_decision!) || 0)
            .attr('y', r => yScale(r.variable) || 0)
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('rx', 3).attr('fill', r => TECH_COLORS[r.kind])
            .attr('opacity', 0.85)
            .style('cursor', 'pointer')
            .on('mousemove', (e: any, r: any) => {
                tooltipShow(`<strong>${escapeHtml(VARIABLE_LABELS[(r as Rule).variable])}</strong> · ${(r as Rule).year_decision}<br/>${(r as Rule).kind.toUpperCase()} · ${escapeHtml((r as Rule).nuts_name || (r as Rule).nuts)}<br/>${(r as Rule).values[0] ? `${(r as Rule).values[0]!.value ?? ''} ${(r as Rule).values[0]!.unit ?? ''}` : 'textual rule'}`, e);
            })
            .on('mouseleave', tooltipHide)
            .on('click', (_e, r) => showSourceModal(r as Rule));

        svgWatermark(svg as any, w);
    };

    (document.getElementById('bc-cg-region') as HTMLSelectElement).addEventListener('change', e => { region = (e.target as HTMLSelectElement).value; draw(); });
    host.querySelectorAll<HTMLButtonElement>('[data-inh]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-inh]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); inheritance = b.dataset.inh === 'on'; draw();
    }));
    draw();
}

// ---------------------------------------------------------------------------
// LENS 5 — Setback buffer overlay (synthetic constraint raster)
// ---------------------------------------------------------------------------

function renderBufferOverlay(host: HTMLElement) {
    if (!data) return;
    host.innerHTML = `
        <h3 class="bc-h2">Setback buffer overlay</h3>
        <p class="bc-sub">A region's rules say "stay <em>n</em> metres from this feature." So we draw the buffers. Synthetic feature placement (real OSM hookup is the next step). The negative space is the buildable land.</p>
        <div class="bc-controls">
            <label>Region</label>
            <select class="bc-select" id="bc-buf-region">
                <option value="DE2">DE2 — Bayern (10H rule)</option>
                <option value="DE9">DE9 — Niedersachsen</option>
                <option value="DEA">DEA — Nordrhein-Westfalen</option>
                <option value="DE1">DE1 — Baden-Württemberg</option>
                <option value="DE">DE — federal baseline</option>
                <option value="EL">EL — Greek baseline</option>
                <option value="IE">IE — Irish guidelines</option>
            </select>
            <span style="flex:1"></span>
            <label>Show feature</label>
            <button class="bc-pill bc-pill-active" data-feat="all">All</button>
            <button class="bc-pill" data-feat="residential">Residential</button>
            <button class="bc-pill" data-feat="motorway">Motorway</button>
            <button class="bc-pill" data-feat="airport">Airport</button>
            <button class="bc-pill" data-feat="transmission">Transmission</button>
            <button class="bc-pill" data-feat="railway">Railway</button>
        </div>
        <div id="bc-buf-stage" style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;"></div>
    `;

    let region = 'DE2';
    let activeFeat: string = 'all';

    const featureMap: Record<string, { variable: string; lat: number; lng: number; label: string; color: string }[]> = {
        residential: [
            { variable: '1_distance_residential buildings', lat: 0.30, lng: 0.30, label: 'Village', color: '#475569' },
            { variable: '1_distance_residential buildings', lat: 0.45, lng: 0.65, label: 'Town', color: '#475569' },
            { variable: '1_distance_residential buildings', lat: 0.70, lng: 0.40, label: 'Hamlet', color: '#475569' },
            { variable: '1_distance_residential buildings', lat: 0.20, lng: 0.75, label: 'Village', color: '#475569' },
        ],
        motorway: [
            { variable: '2_distance_motorway', lat: 0.50, lng: 0.05, label: 'A9', color: '#0ea5e9' },
            { variable: '2_distance_motorway', lat: 0.50, lng: 0.95, label: 'A9', color: '#0ea5e9' },
        ],
        airport: [
            { variable: '5_distance_airports', lat: 0.85, lng: 0.20, label: 'Airport', color: '#f97316' },
        ],
        transmission: [
            { variable: '6_distance_transmission lines', lat: 0.10, lng: 0.40, label: 'HV line', color: '#a855f7' },
            { variable: '6_distance_transmission lines', lat: 0.90, lng: 0.55, label: 'HV line', color: '#a855f7' },
        ],
        railway: [
            { variable: '7_distance_railways', lat: 0.60, lng: 0.10, label: 'Rail', color: '#84cc16' },
        ],
    };

    const draw = () => {
        const stageEl = document.getElementById('bc-buf-stage')!;
        stageEl.innerHTML = '';
        const rs = rulesForRegion(region).filter(r => (r.policy_effect || 'constraining').toLowerCase() !== 'promoting');
        const radii: Record<string, number> = {};
        for (const v of Object.values(featureMap).flat().map(f => f.variable)) {
            const setback = rs.filter(r => r.variable === v && r.values[0]?.value && /m$|metre|meter/i.test(r.values[0]?.unit || '')).map(r => r.values[0]!.value!);
            if (setback.length > 0) radii[v] = Math.max(...setback);
        }

        const w = stageEl.clientWidth - 320 - 16 || 720;
        const h = 480;
        const mapBox = document.createElement('div');
        const sideBox = document.createElement('div');
        stageEl.appendChild(mapBox); stageEl.appendChild(sideBox);

        const svg = d3.select(mapBox).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', h)
            .style('background', '#f1f8f1').style('border-radius', '12px');
        // green base = land
        svg.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h).attr('fill', '#dcfce7');

        // Compute a real-world scale: assume the rectangle represents a 30 km × 20 km region.
        const realW = 30000, realH = 20000;
        const mToPxX = w / realW;
        const mToPxY = h / realH;
        const mToPxAvg = (mToPxX + mToPxY) / 2;

        // Render buffers (as union-ish overlays) for the active feature(s)
        const featureKeys = activeFeat === 'all' ? Object.keys(featureMap) : [activeFeat];
        const bufferGroup = svg.append('g').attr('class', 'buffers');
        for (const fk of featureKeys) {
            for (const feat of featureMap[fk]) {
                const cx = feat.lng * w, cy = feat.lat * h;
                const radius = (radii[feat.variable] ?? 0) * mToPxAvg;
                if (radius > 0) {
                    bufferGroup.append('circle').attr('cx', cx).attr('cy', cy).attr('r', radius)
                        .attr('fill', '#fee2e2').attr('opacity', 0.55).attr('stroke', '#fca5a5').attr('stroke-width', 1).attr('stroke-dasharray', '3,3');
                }
            }
        }

        // Render features themselves
        for (const fk of featureKeys) {
            for (const feat of featureMap[fk]) {
                const cx = feat.lng * w, cy = feat.lat * h;
                if (fk === 'motorway' || fk === 'transmission' || fk === 'railway') {
                    const dashCol = feat.color;
                    svg.append('line').attr('x1', 0).attr('y1', cy).attr('x2', w).attr('y2', cy)
                        .attr('stroke', dashCol).attr('stroke-width', 3).attr('opacity', 0.85)
                        .attr('stroke-dasharray', fk === 'transmission' ? '8,4' : null);
                    svg.append('text').attr('x', 8).attr('y', cy - 6).style('font-size', '10px').style('fill', dashCol).style('font-weight', '700').text(feat.label);
                } else {
                    svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 6).attr('fill', feat.color);
                    svg.append('text').attr('x', cx + 9).attr('y', cy + 4).style('font-size', '11px').style('font-weight', '600').style('fill', '#1e293b').text(feat.label);
                }
            }
        }

        // Border + scale
        svg.append('rect').attr('x', 0).attr('y', 0).attr('width', w).attr('height', h).attr('fill', 'none').attr('stroke', '#94a3b8').attr('stroke-width', 1);
        const scaleKm = 5000 * mToPxX;
        svg.append('line').attr('x1', 18).attr('y1', h - 22).attr('x2', 18 + scaleKm).attr('y2', h - 22).attr('stroke', '#1e293b').attr('stroke-width', 2);
        svg.append('text').attr('x', 18 + scaleKm + 6).attr('y', h - 18).style('font-size', '10px').style('fill', '#1e293b').text('5 km');

        svgWatermark(svg as any, w);

        // Side panel — list applicable setbacks for this region
        const items = Object.entries(radii).map(([v, r]) => `<li style="margin-bottom:6px;font-size:12px;"><strong>${VARIABLE_LABELS[v] || v}:</strong> ${r} m</li>`).join('');
        const reg = COUNTRIES.find(c => c.code === region.slice(0, 2));
        sideBox.innerHTML = `
            <div class="bc-card">
                <div class="bc-card-h">${escapeHtml(region)} — applied setbacks</div>
                <ul style="margin:0;padding-left:18px;">${items || '<em style="color:#94a3b8;">No metric setbacks for this region.</em>'}</ul>
                <div style="margin-top:12px;font-size:11px;color:#64748b;line-height:1.5;font-style:italic;">
                    The red ring is the no-build zone around each feature; the green negative space is the buildable land.
                    Bayern's 10H rule (≈2000 m) shrinks the green dramatically — try toggling between DE2 and DE9.
                </div>
            </div>`;
    };

    (document.getElementById('bc-buf-region') as HTMLSelectElement).addEventListener('change', e => { region = (e.target as HTMLSelectElement).value; draw(); });
    host.querySelectorAll<HTMLButtonElement>('[data-feat]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-feat]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); activeFeat = b.dataset.feat!; draw();
    }));
    draw();
}

// ---------------------------------------------------------------------------
// LENS 6 — Build-Here simulator
// ---------------------------------------------------------------------------

function renderSimulator(host: HTMLElement) {
    if (!data) return;
    const regions = Array.from(new Set(data.rules.map(r => r.nuts))).filter(r => r.length >= 2).sort();
    host.innerHTML = `
        <h3 class="bc-h2">Build-here simulator</h3>
        <p class="bc-sub">Pick a project. The system iterates every rule that applies to your chosen region (with NUTS inheritance) and returns ✓ pass / ⚠ conditional / ✗ fail with the cited source for each.</p>
        <div style="display:grid;grid-template-columns:340px 1fr;gap:16px;">
            <div class="bc-card">
                <div class="bc-card-h">Project</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <div>
                        <label style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Tech</label>
                        <div style="display:flex;gap:6px;margin-top:4px;">
                            <button class="bc-pill bc-pill-active" data-stech="wind">Wind onshore</button>
                            <button class="bc-pill" data-stech="solar">Solar ground</button>
                            <button class="bc-pill" data-stech="ev">EV station</button>
                        </div>
                    </div>
                    <div>
                        <label style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Region</label>
                        <select class="bc-select" id="bc-sim-region" style="width:100%;margin-top:4px;">
                            ${regions.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Distances on site (m)</label>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;font-size:12px;">
                            <label>To residential <input class="bc-select" type="number" id="bc-sim-d1" value="900" style="width:100%;margin-top:2px;"></label>
                            <label>To motorway <input class="bc-select" type="number" id="bc-sim-d2" value="600" style="width:100%;margin-top:2px;"></label>
                            <label>To airport <input class="bc-select" type="number" id="bc-sim-d5" value="8000" style="width:100%;margin-top:2px;"></label>
                            <label>To transm. <input class="bc-select" type="number" id="bc-sim-d6" value="500" style="width:100%;margin-top:2px;"></label>
                            <label>To railway <input class="bc-select" type="number" id="bc-sim-d7" value="500" style="width:100%;margin-top:2px;"></label>
                            <label>Coast (on-shore) <input class="bc-select" type="number" id="bc-sim-d4" value="2000" style="width:100%;margin-top:2px;"></label>
                        </div>
                    </div>
                    <div>
                        <label style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Project specs</label>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;font-size:12px;">
                            <label>Turbine height <input class="bc-select" type="number" id="bc-sim-th" value="180" style="width:100%;margin-top:2px;"></label>
                            <label>Noise (dB(A)) <input class="bc-select" type="number" id="bc-sim-noise" value="42" style="width:100%;margin-top:2px;"></label>
                        </div>
                    </div>
                    <button class="bc-pill bc-pill-active" id="bc-sim-run" style="margin-top:8px;justify-content:center;font-size:13px;padding:9px 16px;">Run simulation</button>
                </div>
            </div>
            <div id="bc-sim-results"></div>
        </div>
    `;

    let tech = 'wind';
    host.querySelectorAll<HTMLButtonElement>('[data-stech]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-stech]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); tech = b.dataset.stech!;
    }));

    const run = () => {
        const region = (document.getElementById('bc-sim-region') as HTMLSelectElement).value;
        const dists: Record<string, number> = {
            '1_distance_residential buildings': +(document.getElementById('bc-sim-d1') as HTMLInputElement).value,
            '2_distance_motorway':               +(document.getElementById('bc-sim-d2') as HTMLInputElement).value,
            '4_distance_coast_on_shore':         +(document.getElementById('bc-sim-d4') as HTMLInputElement).value,
            '5_distance_airports':               +(document.getElementById('bc-sim-d5') as HTMLInputElement).value,
            '6_distance_transmission lines':     +(document.getElementById('bc-sim-d6') as HTMLInputElement).value,
            '7_distance_railways':               +(document.getElementById('bc-sim-d7') as HTMLInputElement).value,
        };
        const turbineHeight = +(document.getElementById('bc-sim-th') as HTMLInputElement).value;
        const noise = +(document.getElementById('bc-sim-noise') as HTMLInputElement).value;

        const rs = rulesForRegion(region).filter(r => r.kind === tech);
        const verdicts: { rule: Rule; verdict: 'pass' | 'fail' | 'conditional' | 'info'; reason: string }[] = [];

        for (const r of rs) {
            if ((r.policy_effect || '').toLowerCase() === 'promoting') {
                verdicts.push({ rule: r, verdict: 'info', reason: 'Promoting policy — does not impose a blocking setback.' });
                continue;
            }
            const v = r.values[0];
            const val = v?.value;
            const unit = v?.unit?.toLowerCase() || '';
            const isMin = (r.min_or_max || '').toLowerCase().startsWith('min');
            const isMax = (r.min_or_max || '').toLowerCase().startsWith('max');

            if (val == null) {
                verdicts.push({ rule: r, verdict: 'info', reason: 'Textual rule — manual review required.' });
                continue;
            }
            if (/m$|metre|meter/.test(unit)) {
                const got = dists[r.variable];
                if (got == null) {
                    verdicts.push({ rule: r, verdict: 'info', reason: `Distance not entered for ${VARIABLE_LABELS[r.variable] || r.variable}.` });
                    continue;
                }
                if (isMin) {
                    if (got >= val) verdicts.push({ rule: r, verdict: 'pass', reason: `Site is ${got} m, satisfies ≥ ${val} m.` });
                    else verdicts.push({ rule: r, verdict: 'fail', reason: `Site is ${got} m, needs ≥ ${val} m. Shortfall ${val - got} m.` });
                    continue;
                }
                if (isMax) {
                    if (got <= val) verdicts.push({ rule: r, verdict: 'pass', reason: `Site is ${got} m, satisfies ≤ ${val} m.` });
                    else verdicts.push({ rule: r, verdict: 'fail', reason: `Site is ${got} m, exceeds ≤ ${val} m.` });
                    continue;
                }
                verdicts.push({ rule: r, verdict: 'conditional', reason: `${val} ${unit} threshold — operator semantics unspecified.` });
                continue;
            }
            if (r.variable === '10_turbine height' && /m/.test(unit)) {
                if (isMax) {
                    verdicts.push({
                        rule: r,
                        verdict: turbineHeight <= val ? 'pass' : 'fail',
                        reason: `Project height ${turbineHeight} m ${turbineHeight <= val ? 'OK' : 'exceeds'} ${val} m.`,
                    });
                    continue;
                }
            }
            if (r.variable === '13_noise limits' && /db/i.test(unit)) {
                if (isMax) {
                    verdicts.push({
                        rule: r,
                        verdict: noise <= val ? 'pass' : 'fail',
                        reason: `Site noise ${noise} dB(A) ${noise <= val ? 'OK' : 'exceeds'} ${val} dB(A).`,
                    });
                    continue;
                }
            }
            if (r.variable === '15_exclusion area') {
                verdicts.push({ rule: r, verdict: 'conditional', reason: 'Exclusion area — depends on whether your site falls inside the listed zone.' });
                continue;
            }
            if (r.variable === '16_priority area') {
                verdicts.push({ rule: r, verdict: 'info', reason: 'Priority area designation — favourable, no action.' });
                continue;
            }
            verdicts.push({ rule: r, verdict: 'info', reason: 'Rule logged for manual review.' });
        }

        const passN = verdicts.filter(v => v.verdict === 'pass').length;
        const failN = verdicts.filter(v => v.verdict === 'fail').length;
        const condN = verdicts.filter(v => v.verdict === 'conditional').length;
        const infoN = verdicts.filter(v => v.verdict === 'info').length;
        const overall = failN > 0 ? 'fail' : (condN > 0 ? 'conditional' : 'pass');
        const verdictColor = { pass: '#0d9488', fail: '#dc2626', conditional: '#d97706', info: '#64748b' };
        const verdictLabel = { pass: 'Likely permitted', fail: 'Blocked by binding rules', conditional: 'Conditional — review needed', info: '' };

        const rendered = `
            <div class="bc-card" style="margin-bottom:14px;">
                <div style="display:flex;align-items:center;gap:14px;">
                    <div style="width:14px;height:60px;background:${verdictColor[overall as keyof typeof verdictColor]};border-radius:6px;"></div>
                    <div>
                        <div style="font-size:18px;font-weight:700;color:${verdictColor[overall as keyof typeof verdictColor]};">${verdictLabel[overall as keyof typeof verdictLabel]}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px;">${verdicts.length} applicable ${tech.toUpperCase()} rules in <strong>${region}</strong>: ${passN} pass, ${condN} conditional, ${failN} fail, ${infoN} info.</div>
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <button class="bc-pill bc-pill-active" data-vfilter="all">All</button>
                <button class="bc-pill" data-vfilter="fail">Fails (${failN})</button>
                <button class="bc-pill" data-vfilter="conditional">Conditional (${condN})</button>
                <button class="bc-pill" data-vfilter="pass">Passes (${passN})</button>
                <button class="bc-pill" data-vfilter="info">Info (${infoN})</button>
            </div>
            <div id="bc-sim-list" style="max-height:520px;overflow-y:auto;padding-right:6px;">
                ${verdicts.map(v => simVerdictHTML(v, verdictColor)).join('')}
            </div>
        `;
        const out = document.getElementById('bc-sim-results')!;
        out.innerHTML = rendered;
        attachRuleCardHandlers(out);
        out.querySelectorAll<HTMLButtonElement>('[data-vfilter]').forEach(b => b.addEventListener('click', () => {
            out.querySelectorAll('[data-vfilter]').forEach(x => x.classList.remove('bc-pill-active'));
            b.classList.add('bc-pill-active');
            const f = b.dataset.vfilter!;
            out.querySelectorAll<HTMLDivElement>('.bc-sim-row').forEach(row => {
                row.style.display = (f === 'all' || row.dataset.verdict === f) ? '' : 'none';
            });
        }));
    };

    function simVerdictHTML(v: { rule: Rule; verdict: string; reason: string }, colors: Record<string, string>): string {
        const icons: Record<string, string> = { pass: '✓', fail: '✗', conditional: '⚠', info: 'ⓘ' };
        const c = colors[v.verdict];
        return `<div class="bc-rule-card ${v.rule.kind} bc-sim-row" data-rule="${ruleKey(v.rule)}" data-verdict="${v.verdict}" style="border-left-color:${c};">
            <div class="bc-rule-card-row1">
                <span style="font-size:16px;font-weight:800;color:${c};">${icons[v.verdict]}</span>
                <span class="bc-rule-tag">${VARIABLE_LABELS[v.rule.variable] || v.rule.variable}</span>
                <span class="bc-rule-tag">${v.rule.nuts}</span>
                ${(v.rule.legally_binding || '').toLowerCase().startsWith('y') ? `<span class="bc-rule-tag bind">binding</span>` : `<span class="bc-rule-tag guide">guideline</span>`}
            </div>
            <div class="bc-rule-cond"><strong style="color:${c};">${v.reason}</strong></div>
            ${v.rule.source_name ? `<div class="bc-rule-source">${escapeHtml(v.rule.source_name.split('\n')[0])}${v.rule.year_decision ? ' · ' + v.rule.year_decision : ''}</div>` : ''}
        </div>`;
    }

    document.getElementById('bc-sim-run')!.addEventListener('click', run);
    run();
}

// ---------------------------------------------------------------------------
// LENS 7 — Strictness radar
// ---------------------------------------------------------------------------

function renderRadar(host: HTMLElement) {
    if (!data) return;
    const regions = Array.from(new Set(data.rules.map(r => r.nuts))).filter(r => r.length >= 2).sort();
    host.innerHTML = `
        <h3 class="bc-h2">Strictness radar</h3>
        <p class="bc-sub">Six normalised axes per region. Pick up to four regions to overlay; bigger polygon = stricter regulatory environment.</p>
        <div class="bc-controls">
            <label>Regions (multi)</label>
            <select class="bc-select" id="bc-radar-regions" multiple size="6" style="min-width:240px;">
                ${regions.map(r => `<option value="${r}" ${['DE2', 'EL', 'IE'].includes(r) ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <span style="flex:1"></span>
            <span style="font-size:11px;color:#64748b;font-style:italic;">Hold ⌘/Ctrl to multi-select. Up to 4 overlays.</span>
        </div>
        <div id="bc-radar-stage" style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;"></div>
    `;

    const axes = [
        { key: 'residential', variable: '1_distance_residential buildings', label: 'Residential setback', unit: 'm', maxBenchmark: 2000 },
        { key: 'motorway',    variable: '2_distance_motorway',              label: 'Motorway setback',    unit: 'm', maxBenchmark: 200 },
        { key: 'transmission',variable: '6_distance_transmission lines',    label: 'Transmission setback',unit: 'm', maxBenchmark: 200 },
        { key: 'noise',       variable: '13_noise limits',                  label: 'Noise strictness',    unit: 'dB(A)', maxBenchmark: 60, invert: true },
        { key: 'exclusion',   variable: '15_exclusion area',                label: 'Exclusion-area count',unit: 'count', maxBenchmark: 12 },
        { key: 'priority',    variable: '16_priority area',                 label: 'Priority designation',unit: 'count', maxBenchmark: 12, invert: true },
    ];

    function regionAxes(region: string) {
        const rs = rulesForRegion(region);
        return axes.map(ax => {
            const matchingRules = rs.filter(r => r.variable === ax.variable);
            let raw = 0;
            if (ax.unit === 'count') {
                raw = matchingRules.length;
            } else if (ax.unit === 'm') {
                raw = d3.max(matchingRules, r => r.values[0]?.value ?? 0) ?? 0;
            } else if (ax.unit === 'dB(A)') {
                const mins = matchingRules.map(r => r.values[0]?.value).filter(v => v != null) as number[];
                raw = mins.length > 0 ? Math.min(...mins) : 60;
            }
            let normalized = raw / ax.maxBenchmark;
            if (ax.invert) normalized = 1 - normalized;
            return { ...ax, raw, normalized: Math.max(0, Math.min(1, normalized)) };
        });
    }

    const draw = () => {
        const sel = document.getElementById('bc-radar-regions') as HTMLSelectElement;
        const regs = Array.from(sel.selectedOptions).map(o => o.value).slice(0, 4);
        const stageEl = document.getElementById('bc-radar-stage')!;
        stageEl.innerHTML = '';
        const chartBox = document.createElement('div');
        const sideBox = document.createElement('div');
        stageEl.appendChild(chartBox); stageEl.appendChild(sideBox);

        const w = 520, h = 520;
        const centerX = w / 2, centerY = h / 2;
        const radius = Math.min(w, h) / 2 - 60;

        const svg = d3.select(chartBox).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', '100%').style('max-height', '520px');
        const angleSlice = (Math.PI * 2) / axes.length;
        const palette = ['#0d9488', '#dc2626', '#7c3aed', '#d97706'];

        // gridlines (5 levels)
        for (let lvl = 1; lvl <= 5; lvl++) {
            const r = (radius / 5) * lvl;
            const points = axes.map((_, i) => {
                const a = angleSlice * i - Math.PI / 2;
                return [centerX + r * Math.cos(a), centerY + r * Math.sin(a)];
            });
            svg.append('polygon')
                .attr('points', points.map(p => p.join(',')).join(' '))
                .attr('fill', 'none').attr('stroke', '#e2e8f0').attr('stroke-width', 1).attr('stroke-dasharray', '3,3');
        }

        // axis labels
        axes.forEach((ax, i) => {
            const a = angleSlice * i - Math.PI / 2;
            const x = centerX + (radius + 30) * Math.cos(a);
            const y = centerY + (radius + 30) * Math.sin(a);
            svg.append('line').attr('x1', centerX).attr('y1', centerY).attr('x2', centerX + radius * Math.cos(a)).attr('y2', centerY + radius * Math.sin(a))
                .attr('stroke', '#cbd5e1').attr('stroke-width', 1);
            svg.append('text').attr('x', x).attr('y', y).style('font-size', '11px').style('font-weight', '600').style('fill', '#475569').style('text-anchor', 'middle').style('dominant-baseline', 'middle').text(ax.label);
        });

        regs.forEach((reg, idx) => {
            const vals = regionAxes(reg);
            const points = vals.map((v, i) => {
                const a = angleSlice * i - Math.PI / 2;
                const r = radius * v.normalized;
                return [centerX + r * Math.cos(a), centerY + r * Math.sin(a)];
            });
            svg.append('polygon')
                .attr('points', points.map(p => p.join(',')).join(' '))
                .attr('fill', palette[idx]).attr('opacity', 0.18).attr('stroke', palette[idx]).attr('stroke-width', 2);
            points.forEach((p, i) => {
                const ax = vals[i];
                svg.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 4).attr('fill', palette[idx])
                    .style('cursor', 'pointer')
                    .on('mousemove', (e: any) => tooltipShow(`<strong>${escapeHtml(reg)}</strong><br/>${ax.label}: <strong>${ax.raw} ${ax.unit === 'count' ? '' : ax.unit}</strong>`, e))
                    .on('mouseleave', tooltipHide);
            });
        });

        // Side legend + per-region breakdown
        sideBox.innerHTML = `
            <div class="bc-card">
                <div class="bc-card-h">Selected regions</div>
                ${regs.map((reg, idx) => {
                    const vals = regionAxes(reg);
                    const total = Math.round(vals.reduce((s, v) => s + v.normalized, 0) / vals.length * 100);
                    return `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <div style="width:14px;height:14px;background:${palette[idx]};border-radius:3px;"></div>
                            <strong style="font-size:13px;">${reg}</strong>
                            <span style="margin-left:auto;font-size:11px;color:#64748b;">${total} / 100</span>
                        </div>
                        ${vals.map(v => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#475569;"><span>${v.label}</span><span><strong>${v.raw}</strong> ${v.unit === 'count' ? '' : v.unit}</span></div>`).join('')}
                    </div>`;
                }).join('') || '<em style="color:#94a3b8;">Pick at least one region.</em>'}
            </div>
        `;
    };

    document.getElementById('bc-radar-regions')!.addEventListener('change', draw);
    draw();
}

// ---------------------------------------------------------------------------
// LENS 8 — Source-text inspector (browse mode)
// ---------------------------------------------------------------------------

function renderSourceInspector(host: HTMLElement) {
    if (!data) return;
    const variables = Array.from(new Set(data.rules.map(r => r.variable))).sort();
    const countries = Array.from(new Set(data.rules.map(r => r.country))).sort();
    host.innerHTML = `
        <h3 class="bc-h2">Source-text inspector</h3>
        <p class="bc-sub">All ${data.rules.length} rules with their original German / Greek text and English translation. Click any row to open the bilingual reader and the official source link.</p>
        <div class="bc-controls">
            <label>Tech</label>
            <button class="bc-pill bc-pill-active" data-stech="all">All</button>
            <button class="bc-pill" data-stech="wind">Wind</button>
            <button class="bc-pill" data-stech="solar">Solar</button>
            <button class="bc-pill" data-stech="ev">EV</button>
            <span style="flex:1"></span>
            <label>Country</label>
            <select class="bc-select" id="bc-src-country">
                <option value="all">All</option>
                ${countries.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <label>Variable</label>
            <select class="bc-select" id="bc-src-var">
                <option value="all">All</option>
                ${variables.map(v => `<option value="${v}">${VARIABLE_LABELS[v] || v}</option>`).join('')}
            </select>
            <label>Search</label>
            <input class="bc-select" id="bc-src-q" placeholder="quote / source / text…" style="min-width:200px;">
        </div>
        <div id="bc-src-list" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:600px;overflow-y:auto;padding-right:6px;"></div>
    `;

    let tech = 'all', country = 'all', variable = 'all', q = '';

    const draw = () => {
        const list = document.getElementById('bc-src-list')!;
        const filtered = data!.rules.filter(r => {
            if (tech !== 'all' && r.kind !== tech) return false;
            if (country !== 'all' && r.country !== country) return false;
            if (variable !== 'all' && r.variable !== variable) return false;
            if (q) {
                const blob = `${r.text_original || ''} ${r.text_translation || ''} ${r.source_name || ''} ${r.nuts_name || ''}`.toLowerCase();
                if (!blob.includes(q.toLowerCase())) return false;
            }
            return true;
        });
        list.innerHTML = filtered.length === 0 ? `<div class="bc-no-data" style="grid-column:1/-1;">No matching rules.</div>` : filtered.map(r => ruleCardHTML(r)).join('');
        attachRuleCardHandlers(list);
    };

    host.querySelectorAll<HTMLButtonElement>('[data-stech]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-stech]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); tech = b.dataset.stech!; draw();
    }));
    (document.getElementById('bc-src-country') as HTMLSelectElement).addEventListener('change', e => { country = (e.target as HTMLSelectElement).value; draw(); });
    (document.getElementById('bc-src-var') as HTMLSelectElement).addEventListener('change', e => { variable = (e.target as HTMLSelectElement).value; draw(); });
    (document.getElementById('bc-src-q') as HTMLInputElement).addEventListener('input', e => { q = (e.target as HTMLInputElement).value; draw(); });
    draw();
}

// ---------------------------------------------------------------------------
// LENS 10 — Decision-tree rules (Multiple_conditions = GROUP / ALL)
// ---------------------------------------------------------------------------

function renderDecisionTrees(host: HTMLElement) {
    if (!data) return;
    const grouped: Record<string, Rule[]> = {};
    for (const r of data.rules) {
        const key = `${r.country}|${r.installation_type || ''}|${r.variable}|${r.year_decision || ''}|${r.source_name || ''}`;
        (grouped[key] ||= []).push(r);
    }
    // Show rules that either explicitly have multiple_conditions = GROUP/ALL,
    // or whose grouping has more than one (Value, Condition) tuple.
    const treeRules: { key: string; rules: Rule[] }[] = Object.entries(grouped)
        .filter(([_, rs]) => rs[0].values.length > 1 || /group|all/i.test(rs[0].multiple_conditions || '') || rs.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([key, rs]) => ({ key, rules: rs }));

    host.innerHTML = `
        <h3 class="bc-h2">Decision-tree rules</h3>
        <p class="bc-sub">Rules with structured conditions. Each tree shows the branches of a single legal rule. Around 5% of the dataset carries this kind of branching logic — flat tables flatten it; here we render the structure.</p>
        <div class="bc-controls">
            <label>Filter</label>
            <button class="bc-pill bc-pill-active" data-tfilter="all">All (${treeRules.length})</button>
            <button class="bc-pill" data-tfilter="GROUP">GROUP only</button>
            <button class="bc-pill" data-tfilter="ALL">ALL only</button>
        </div>
        <div id="bc-tree-list" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:14px;"></div>
    `;

    let f = 'all';

    const draw = () => {
        const list = document.getElementById('bc-tree-list')!;
        let visible = treeRules;
        if (f !== 'all') visible = treeRules.filter(t => new RegExp(f, 'i').test(t.rules[0].multiple_conditions || ''));

        list.innerHTML = visible.slice(0, 24).map(t => {
            const r0 = t.rules[0];
            const branches: { label: string; value: string; cond: string; tag: string }[] = [];
            for (const r of t.rules) {
                for (const v of r.values) {
                    branches.push({
                        label: v.condition || '—',
                        value: v.value != null ? `${r.min_or_max ? r.min_or_max + ' ' : ''}${v.value} ${v.unit || ''}` : '(text)',
                        cond: v.condition || '',
                        tag: (r.legally_binding || '').toLowerCase().startsWith('y') ? 'binding' : 'guideline',
                    });
                }
            }
            const isGroup = /group/i.test(r0.multiple_conditions || '');
            const isAll = /all/i.test(r0.multiple_conditions || '');
            const op = isGroup ? 'one of' : (isAll ? 'all of' : 'cases');
            const opColor = isGroup ? '#7c3aed' : (isAll ? '#0d9488' : '#64748b');
            return `<div class="bc-card" style="padding:0;">
                <div style="padding:10px 14px;border-bottom:1px solid #e2e8f0;">
                    <div style="font-size:12.5px;font-weight:700;color:#1e293b;">${escapeHtml(VARIABLE_LABELS[r0.variable] || r0.variable)}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(r0.nuts)} · ${escapeHtml(r0.installation_type || '')} · ${r0.year_decision || ''}</div>
                </div>
                <div style="padding:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;font-weight:700;color:${opColor};text-transform:uppercase;letter-spacing:0.4px;">
                        <span style="width:10px;height:10px;background:${opColor};border-radius:50%;"></span>
                        Apply ${op} of these branches
                    </div>
                    ${branches.map(b => `<div style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
                        <div style="width:18px;border-top:1.5px dashed ${opColor};margin-top:8px;flex-shrink:0;"></div>
                        <div style="flex:1;">
                            <div style="font-size:12.5px;font-weight:600;color:#1e293b;">${escapeHtml(b.value)}</div>
                            ${b.cond ? `<div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4;">${escapeHtml(b.cond)}</div>` : ''}
                        </div>
                    </div>`).join('')}
                </div>
                <div style="padding:8px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:10px;color:#94a3b8;font-style:italic;">${escapeHtml((r0.source_name || '').split('\n')[0] || 'No source')}</div>
            </div>`;
        }).join('') || `<div class="bc-no-data" style="grid-column:1/-1;">No matching trees.</div>`;
    };

    host.querySelectorAll<HTMLButtonElement>('[data-tfilter]').forEach(b => b.addEventListener('click', () => {
        host.querySelectorAll('[data-tfilter]').forEach(x => x.classList.remove('bc-pill-active'));
        b.classList.add('bc-pill-active'); f = b.dataset.tfilter!; draw();
    }));
    draw();
}
