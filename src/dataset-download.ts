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
    buildRegulationsRows?: Record<string, unknown>[];
};

const BUILD_REGULATIONS_EXPORT_HEADERS = [
    'technology',
    'country',
    'nuts',
    'nuts_name',
    'variable',
    'year_decision',
    'year_ended',
    'status',
    'policy_effect',
    'installation_type',
    'installation_scale',
    'location_or_characteristics',
    'min_or_max',
    'multiple_conditions',
    'legally_binding',
    'explicitly_mentioned',
    'value_1',
    'unit_1',
    'condition_1',
    'value_2',
    'unit_2',
    'condition_2',
    'value_3',
    'unit_3',
    'condition_3',
    'value_4',
    'unit_4',
    'condition_4',
    'source_name',
    'source_id',
    'source_section',
    'source_link',
    'source_alternative',
    'text_original',
    'text_translation',
    'miscellaneous',
    'inactive_detail',
    'notes_updated_laws',
    'validated',
    'record_type',
    'serial_number',
    'added_in_version',
    'status_changed_in_version',
] as const;

type BuildRegulationExportKey = (typeof BUILD_REGULATIONS_EXPORT_HEADERS)[number];

const BUILD_REGULATIONS_PRESENTATION_HEADERS = BUILD_REGULATIONS_EXPORT_HEADERS.map((header) =>
    header
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
);

const BUILD_REGULATIONS_TITLE_CASE_FIELDS = new Set<BuildRegulationExportKey>([
    'technology',
    'country',
    'nuts_name',
    'variable',
    'status',
    'policy_effect',
    'installation_type',
    'installation_scale',
    'location_or_characteristics',
    'min_or_max',
    'multiple_conditions',
    'legally_binding',
    'explicitly_mentioned',
    'condition_1',
    'condition_2',
    'condition_3',
    'condition_4',
    'inactive_detail',
    'notes_updated_laws',
    'validated',
    'record_type',
]);

function capitalizeWords(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function formatTechnologyLabel(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'wind') return 'Wind';
    if (normalized === 'solar') return 'Solar';
    if (normalized === 'ev') return 'Electric Vehicles';
    if (normalized === 'wind_priority_area') return 'Wind Priority Area';
    return capitalizeWords(value);
}

function formatVariableLabel(value: string): string {
    return capitalizeWords(value.replace(/^\d+_/, '').replace(/_/g, ' '));
}

function formatBuildRegulationCell(key: BuildRegulationExportKey, value: unknown): unknown {
    if (value == null || value === '') return null;
    if (!BUILD_REGULATIONS_TITLE_CASE_FIELDS.has(key)) return value;
    if (typeof value !== 'string') return value;
    if (key === 'technology') return formatTechnologyLabel(value);
    if (key === 'variable') return formatVariableLabel(value);
    if (key === 'installation_type') return capitalizeWords(value.replace(/_/g, ' '));
    return capitalizeWords(value);
}

function presentBuildRegulationExportRow(row: Record<string, unknown>): Record<string, unknown> {
    const presented: Record<string, unknown> = {};
    BUILD_REGULATIONS_EXPORT_HEADERS.forEach((key, index) => {
        presented[BUILD_REGULATIONS_PRESENTATION_HEADERS[index]] = formatBuildRegulationCell(key, row[key]);
    });
    return presented;
}

function formatBuildRegulationExportRow(source: Record<string, unknown>): Record<string, unknown> {
    const technology = source.technology ?? source.kind ?? null;
    const row: Record<string, unknown> = {};
    BUILD_REGULATIONS_EXPORT_HEADERS.forEach((header) => {
        if (header === 'technology') {
            row.technology = technology;
            return;
        }
        row[header] = source[header] ?? null;
    });
    return row;
}

function flattenBuildRegulationRule(rule: Record<string, unknown>): Record<string, unknown> {
    const {
        values,
        kind,
        row_index: _rowIndex,
        policy_id: _policyId,
        policy_type_raw: _policyTypeRaw,
        active: _active,
        overwritten_by_row: _overwrittenByRow,
        supersedes_policy: _supersedesPolicy,
        last_update: _lastUpdate,
        ...rest
    } = rule;
    const flat: Record<string, unknown> = {
        record_type: 'regulation',
        technology: kind ?? null,
        ...rest,
    };
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
    return formatBuildRegulationExportRow(flat);
}

function flattenWindPriorityArea(area: Record<string, unknown>): Record<string, unknown> {
    return formatBuildRegulationExportRow({
        record_type: 'wind_priority_area',
        technology: 'wind_priority_area',
        country: area.country ?? null,
        nuts: area.nuts ?? null,
        nuts_name: area.nuts_name ?? null,
        variable: area.indicator ?? null,
        status: area.status ?? area.active ?? 'active',
        source_link: area.source_link ?? null,
        text_original: area.text_original ?? null,
        text_translation: area.text_translation ?? null,
        serial_number: area.serial_number ?? null,
        added_in_version: area.added_in_version ?? 'V1.0',
        status_changed_in_version: area.status_changed_in_version ?? area.added_in_version ?? 'V1.0',
    });
}

function buildRegulationsExportRows(sources: DatasetSources): Record<string, unknown>[] {
    const rules = (sources.buildRegulationsRows || []).filter((row) => row.kind !== 'wind_priority_area');
    const windPriorityAreas = (sources.buildRegulationsRows || []).filter((row) => row.kind === 'wind_priority_area');
    const compareExportRows = (a: Record<string, unknown>, b: Record<string, unknown>) => (
        String(a.country ?? '').localeCompare(String(b.country ?? ''))
        || String(a.nuts ?? '').localeCompare(String(b.nuts ?? ''))
        || String(a.technology ?? '').localeCompare(String(b.technology ?? ''))
        || String(a.variable ?? '').localeCompare(String(b.variable ?? ''))
        || Number(a.year_decision ?? 0) - Number(b.year_decision ?? 0)
    );
    return [
        ...rules.map(flattenBuildRegulationRule),
        ...windPriorityAreas.map(flattenWindPriorityArea),
    ]
        .sort(compareExportRows)
        .map(presentBuildRegulationExportRow);
}

function resolveBuildRegulationsHeaders(_rows: Record<string, unknown>[]): string[] {
    return [...BUILD_REGULATIONS_PRESENTATION_HEADERS];
}

function resolveBaseUrl(baseUrl?: string): string {
    return baseUrl ?? (import.meta as ImportMeta & { env: { BASE_URL?: string } }).env.BASE_URL ?? '/';
}

function resolveDataUrl(relativePath: string, baseUrl?: string): string {
    const normalizedPath = relativePath.replace(/^\//, '');
    if (typeof window !== 'undefined' && window.location?.href) {
        return new URL(normalizedPath, window.location.href).toString();
    }
    const root = resolveBaseUrl(baseUrl);
    const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
    return `${normalizedRoot}${normalizedPath}`;
}

function parseBuildRegulationsPayload(data: {
    rules?: Record<string, unknown>[];
    wind_priority_areas?: Record<string, unknown>[];
}): Record<string, unknown>[] {
    return [
        ...(data.rules || []),
        ...(data.wind_priority_areas || []),
    ];
}

async function fetchBuildRegulations(baseUrl?: string): Promise<{
    buildRegulationsRows: Record<string, unknown>[];
}> {
    const url = resolveDataUrl('data/build_regulations.json', baseUrl);
    const text = await fetchText(url, 'build regulations');
    const data = JSON.parse(text) as {
        rules?: Record<string, unknown>[];
        wind_priority_areas?: Record<string, unknown>[];
    };
    const buildRegulationsRows = parseBuildRegulationsPayload(data);
    if (buildRegulationsRows.length === 0) {
        throw new Error('Build regulations file loaded but contained no rows.');
    }
    return { buildRegulationsRows };
}

async function ensureFullDatasetSources(
    sources?: DatasetSources,
    baseUrl?: string
): Promise<DatasetSources> {
    const base = sources ?? (await fetchDatasetSources(baseUrl));
    if (base.buildRegulationsRows && base.buildRegulationsRows.length > 0) {
        return base;
    }
    try {
        const regulations = await fetchBuildRegulations(baseUrl);
        return { ...base, ...regulations };
    } catch (error) {
        console.error('Failed to load build regulations for export:', error);
        throw new Error(
            'Building regulations could not be loaded. Ensure data/build_regulations.json is deployed, then try again.'
        );
    }
}

function resolveSheetHeaders(rows: Record<string, unknown>[], columns?: string[]): string[] {
    if (columns && columns.length > 0) return columns.filter((c) => c && c.trim() !== '');
    return Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((k) => k !== ''))));
}

/** Sniff the field delimiter (comma or semicolon) from a CSV/DSV text's header line. */
function detectDsvDelimiter(text: string): string {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
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
        const delimiter = detectDsvDelimiter(text);
        return (delimiter === ',' ? d3.csvParse(text) : d3.dsvFormat(delimiter).parse(text)) as Record<string, unknown>[];
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
    const policyDataUrl = resolveDataUrl('data/policy_data.xlsx', baseUrl);
    const targetsDataUrl = resolveDataUrl('data/targets_data.csv', baseUrl);
    const climateTargetsDataUrl = resolveDataUrl('data/climate_targets_data.csv', baseUrl);
    const evDataUrl = resolveDataUrl('data/ev_data.xlsx', baseUrl);

    const [policyCsv, targetsCsv, climateTargetsCsv, evCsv] = await Promise.all([
        fetchArrayBuffer(policyDataUrl, 'policy data').then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            const firstSheetName = wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }),
        fetchArrayBuffer(targetsDataUrl, 'targets data').then((ab) =>
            parseSpreadsheetOrCsv(ab, 'targets data')
        ),
        fetchArrayBuffer(climateTargetsDataUrl, 'climate targets data').then((ab) =>
            parseSpreadsheetOrCsv(ab, 'climate targets data')
        ),
        fetchArrayBuffer(evDataUrl, 'EV data').then((ab) => {
            const wb = XLSX.read(ab, { type: 'array' });
            const dataSheetName = wb.SheetNames.length > 1 ? wb.SheetNames[1] : wb.SheetNames[0];
            const csvText = XLSX.utils.sheet_to_csv(wb.Sheets[dataSheetName]);
            return d3.csvParse(csvText) as Record<string, unknown>[];
        }),
    ]);

    const { buildRegulationsRows } = await fetchBuildRegulations(baseUrl);

    return {
        policyCsv,
        targetsCsv,
        climateTargetsCsv,
        evCsv,
        buildRegulationsRows,
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

    const buildRegulationsRows = buildRegulationsExportRows(sources);
    if (buildRegulationsRows.length === 0) {
        throw new Error('Building regulations export is empty.');
    }
    sheets.push({
        name: 'Building_Regulations',
        rows: buildRegulationsRows,
        headers: resolveBuildRegulationsHeaders(buildRegulationsRows),
    });

    return sheets;
}

async function loadInfoSheetRows(baseUrl?: string): Promise<DatasetSheet | null> {
    try {
        const infoBuffer = await fetchArrayBuffer(resolveDataUrl('data/info_data.xlsx', baseUrl), 'info sheet');
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
