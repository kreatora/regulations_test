/**
 * Full-dataset export — shared by the world map download menu and data.html.
 */
import * as d3 from 'd3';
import * as XLSX_ from 'xlsx';
import { downloadBlob } from './graph-export';

const XLSX = (XLSX_ as any).default || XLSX_;

/** Combined export filename (snapshot label, not per-dataset Zenodo version). */
export const FULL_DATASET_XLSX_FILENAME = 'Climate_Policy_Atlas_July_2026.xlsx';
export const FULL_DATASET_CSV_ZIP_FILENAME = 'Climate_Policy_Atlas_July_2026_csv.zip';

export type DatasetSheet = { name: string; rows: Record<string, unknown>[]; headers: string[] };

export type DatasetSources = {
    policyCsv: Record<string, unknown>[];
    targetsCsv: Record<string, unknown>[];
    climateTargetsCsv: Record<string, unknown>[];
    evCsv: Record<string, unknown>[];
    buildRegulationsRules?: Record<string, unknown>[];
    windPriorityAreas?: Record<string, unknown>[];
};

function flattenBuildRegulationRule(rule: Record<string, unknown>): Record<string, unknown> {
    const { values, ...rest } = rule;
    const flat: Record<string, unknown> = { ...rest };
    if (Array.isArray(values)) {
        values.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') return;
            const valueEntry = entry as Record<string, unknown>;
            const slot = index + 1;
            flat[`value_${slot}`] = valueEntry.value ?? null;
            flat[`unit_${slot}`] = valueEntry.unit ?? null;
            flat[`condition_${slot}`] = valueEntry.condition ?? null;
        });
    }
    return flat;
}

async function fetchBuildRegulations(baseUrl?: string): Promise<{
    buildRegulationsRules: Record<string, unknown>[];
    windPriorityAreas: Record<string, unknown>[];
}> {
    const root = resolveBaseUrl(baseUrl);
    const text = await fetchText(`${root}data/build_regulations.json`, 'build regulations');
    const data = JSON.parse(text) as {
        rules?: Record<string, unknown>[];
        wind_priority_areas?: Record<string, unknown>[];
    };
    return {
        buildRegulationsRules: (data.rules || []).map(flattenBuildRegulationRule),
        windPriorityAreas: data.wind_priority_areas || [],
    };
}

async function ensureFullDatasetSources(
    sources?: DatasetSources,
    baseUrl?: string
): Promise<DatasetSources> {
    const base = sources ?? (await fetchDatasetSources(baseUrl));
    if (base.buildRegulationsRules && base.windPriorityAreas) {
        return base;
    }
    const regulations = await fetchBuildRegulations(baseUrl);
    return { ...base, ...regulations };
}

function resolveBaseUrl(baseUrl?: string): string {
    return baseUrl ?? (import.meta as ImportMeta & { env: { BASE_URL?: string } }).env.BASE_URL ?? '/';
}

function resolveSheetHeaders(rows: Record<string, unknown>[], columns?: string[]): string[] {
    if (columns && columns.length > 0) return columns.filter((c) => c && c.trim() !== '');
    return Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((k) => k !== ''))));
}

function parseSpreadsheetOrCsv(ab: ArrayBuffer, label: string): Record<string, unknown>[] {
    try {
        const bytes = new Uint8Array(ab);
        const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
        if (isZip) {
            const wb = XLSX.read(ab, { type: 'array' });
            const sheetName =
                wb.SheetNames.find((name) => name.toLowerCase().includes('target')) ||
                wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }
        const text = new TextDecoder('utf-8').decode(ab);
        return d3.csvParse(text) as Record<string, unknown>[];
    } catch (e) {
        console.error(`Error parsing ${label}:`, e);
        return [];
    }
}

async function fetchArrayBuffer(url: string, label: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
}

async function fetchText(url: string, label: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

/** Load and parse all atlas tabular sources (same paths/parsers as the world map). */
export async function fetchDatasetSources(baseUrl?: string): Promise<DatasetSources> {
    const root = resolveBaseUrl(baseUrl);
    const policyDataUrl = `${root}data/policy_data.xlsx`;
    const targetsDataUrl = `${root}data/targets_data.csv`;
    const climateTargetsDataUrl = `${root}data/climate_targets_data.xlsx`;
    const evDataUrl = `${root}data/ev_data.xlsx`;

    const [policyCsv, targetsCsv, climateTargetsCsv, evCsv, regulations] = await Promise.all([
        fetchArrayBuffer(policyDataUrl, 'policy data').then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            const firstSheetName = wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }),
        fetchArrayBuffer(targetsDataUrl, 'targets data').then((ab) =>
            parseSpreadsheetOrCsv(ab, 'targets data')
        ),
        fetchArrayBuffer(climateTargetsDataUrl, 'climate targets data').then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            const sheetName =
                wb.SheetNames.find((name) => name.toLowerCase().includes('target')) ||
                wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }),
        fetchArrayBuffer(evDataUrl, 'EV data').then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            const dataSheetName = wb.SheetNames.length > 1 ? wb.SheetNames[1] : wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[dataSheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }),
        fetchBuildRegulations(baseUrl),
    ]);

    return {
        policyCsv,
        targetsCsv,
        climateTargetsCsv,
        evCsv,
        buildRegulationsRules: regulations.buildRegulationsRules,
        windPriorityAreas: regulations.windPriorityAreas,
    };
}

export function buildFullDatasetSheets(sources: DatasetSources): DatasetSheet[] {
    const policyCsv = sources.policyCsv as Record<string, unknown>[] & { columns?: string[] };
    const targetsCsv = sources.targetsCsv as Record<string, unknown>[] & { columns?: string[] };
    const climateTargetsCsv = sources.climateTargetsCsv as Record<string, unknown>[] & { columns?: string[] };
    const evCsv = sources.evCsv as Record<string, unknown>[] & { columns?: string[] };

    const sheets: DatasetSheet[] = [
        {
            name: 'Policies',
            rows: policyCsv,
            headers: resolveSheetHeaders(policyCsv, policyCsv.columns),
        },
        {
            name: 'Targets',
            rows: targetsCsv,
            headers: resolveSheetHeaders(targetsCsv, targetsCsv.columns),
        },
        {
            name: 'ClimateTargets',
            rows: climateTargetsCsv,
            headers: resolveSheetHeaders(climateTargetsCsv, climateTargetsCsv.columns),
        },
        {
            name: 'EV_Support',
            rows: evCsv,
            headers: resolveSheetHeaders(evCsv, evCsv.columns),
        },
    ];

    const buildRegulationsRules = sources.buildRegulationsRules || [];
    if (buildRegulationsRules.length > 0) {
        sheets.push({
            name: 'Build_Regulations',
            rows: buildRegulationsRules,
            headers: resolveSheetHeaders(buildRegulationsRules),
        });
    }

    const windPriorityAreas = sources.windPriorityAreas || [];
    if (windPriorityAreas.length > 0) {
        sheets.push({
            name: 'Wind_Priority_Areas',
            rows: windPriorityAreas,
            headers: resolveSheetHeaders(windPriorityAreas),
        });
    }

    return sheets;
}

async function loadInfoSheetRows(baseUrl?: string): Promise<DatasetSheet | null> {
    try {
        const root = resolveBaseUrl(baseUrl);
        const infoBuffer = await fetchArrayBuffer(`${root}data/info_data.xlsx`, 'info sheet');
        const infoWb = XLSX.read(infoBuffer, { type: 'array' });
        if (infoWb.SheetNames.length === 0) return null;
        const sheetName = infoWb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(infoWb.Sheets[sheetName]) as Record<string, unknown>[];
        return { name: sheetName, rows, headers: resolveSheetHeaders(rows) };
    } catch (e) {
        console.error('Failed to load info sheet', e);
        return null;
    }
}

function appendSheetsToWorkbook(wb: XLSX_.WorkBook, sheets: DatasetSheet[]): void {
    sheets.forEach(({ name, rows, headers }) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: headers }), name);
    });
}

function rowsToCsv(rows: Record<string, unknown>[], headers: string[]): string {
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    return XLSX.utils.sheet_to_csv(ws);
}

async function downloadSheetsAsCsvZip(
    filename: string,
    sheets: DatasetSheet[],
    baseUrl?: string
): Promise<void> {
    const { zipSync } = await import('fflate');
    const zipEntries: Record<string, Uint8Array> = {};
    const encoder = new TextEncoder();

    const infoSheet = await loadInfoSheetRows(baseUrl);
    if (infoSheet) {
        zipEntries[`${infoSheet.name}.csv`] = encoder.encode(rowsToCsv(infoSheet.rows, infoSheet.headers));
    }

    sheets.forEach(({ name, rows, headers }) => {
        zipEntries[`${name}.csv`] = encoder.encode(rowsToCsv(rows, headers));
    });

    const zipped = zipSync(zipEntries);
    downloadBlob(new Blob([zipped], { type: 'application/zip' }), filename);
}

export async function downloadFullDataset(
    sources?: DatasetSources,
    baseUrl?: string
): Promise<void> {
    const dataset = await ensureFullDatasetSources(sources, baseUrl);
    const wb = XLSX.utils.book_new();
    const infoSheet = await loadInfoSheetRows(baseUrl);
    if (infoSheet) {
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(infoSheet.rows, { header: infoSheet.headers }),
            infoSheet.name
        );
    }
    appendSheetsToWorkbook(wb, buildFullDatasetSheets(dataset));
    XLSX.writeFile(wb, FULL_DATASET_XLSX_FILENAME, { compression: true });
}

export async function downloadFullDatasetCsv(
    sources?: DatasetSources,
    baseUrl?: string
): Promise<void> {
    const dataset = await ensureFullDatasetSources(sources, baseUrl);
    await downloadSheetsAsCsvZip(FULL_DATASET_CSV_ZIP_FILENAME, buildFullDatasetSheets(dataset), baseUrl);
}
