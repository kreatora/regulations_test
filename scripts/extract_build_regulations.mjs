/**
 * Extracts the build-regulations workbook into public/data/build_regulations.json.
 *
 * Run from repo root:
 *   npm run extract:regulations
 *   node scripts/extract_build_regulations.mjs
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';

const EXCEL_PATH_CANDIDATES = [
    'docs/data/regulations_data.xlsx',
    'public/data/regulations_data.xlsx',
];

const SUPPORTED_COUNTRIES = new Set(['Germany', 'Greece', 'Ireland', 'France']);
const WIND_PRIORITY_VARIABLE = '16_priority area';
const BUILD_REGULATIONS_XLSX_HEADERS = [
    'Technology',
    'Country',
    'Nuts',
    'Nuts Name',
    'Variable',
    'Year Decision',
    'Year Ended',
    'Status',
    'Policy Effect',
    'Installation Type',
    'Installation Scale',
    'Location Or Characteristics',
    'Min Or Max',
    'Multiple Conditions',
    'Legally Binding',
    'Explicitly Mentioned',
    'Value 1',
    'Unit 1',
    'Condition 1',
    'Value 2',
    'Unit 2',
    'Condition 2',
    'Value 3',
    'Unit 3',
    'Condition 3',
    'Value 4',
    'Unit 4',
    'Condition 4',
    'Source Name',
    'Source Id',
    'Source Section',
    'Source Link',
    'Source Alternative',
    'Text Original',
    'Text Translation',
    'Miscellaneous',
    'Inactive Detail',
    'Supersedes Policy',
    'Notes Updated Laws',
    'Validated',
    'Record Type',
    'Serial Number',
    'Added In Version',
    'Status Changed In Version',
];

function findExcel() {
    const found = EXCEL_PATH_CANDIDATES.find((path) => existsSync(path));
    if (!found) {
        throw new Error('Could not find regulations_data.xlsx in expected locations.');
    }
    return found;
}

function cleanStr(value) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isNaN(value)) return null;
    const text = String(value).replace(/\r/g, '').trim();
    return text || null;
}

function cleanNum(value) {
    if (value == null) return null;
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0].replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
}

function isPlaceholder(value) {
    const text = cleanStr(value);
    if (!text) return true;
    return /^(n\/?a|na|null|none|-|\.{2,}\d*)$/i.test(text);
}

function capitalizeWords(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function normalizeCountry(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('germany')) return 'Germany';
    if (lower.startsWith('greece')) return 'Greece';
    if (lower.startsWith('ireland')) return 'Ireland';
    if (lower.startsWith('france')) return 'France';
    return capitalizeWords(raw);
}

function normalizeNuts(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    const nuts = raw.replace(/\s+/g, '').toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]*$/.test(nuts) ? nuts : null;
}

function buildNutsNameLookup(rows, colmap) {
    const lookup = new Map();
    for (const row of rows) {
        const nuts = normalizeNuts(getCell(row, colmap, 'NUTS'));
        const nutsName = cleanStr(getCell(row, colmap, 'NUTS_Name', 'NUTS_NAME', 'nuts_name'));
        if (!nuts || !nutsName) continue;
        const key = nutsName.trim().toLowerCase();
        if (!lookup.has(key)) lookup.set(key, nuts);
    }
    return lookup;
}

function resolveNuts(row, colmap, lookup) {
    const direct = normalizeNuts(getCell(row, colmap, 'NUTS'));
    if (direct) return direct;
    const nutsName = cleanStr(getCell(row, colmap, 'NUTS_Name', 'NUTS_NAME', 'nuts_name'));
    if (!nutsName) return null;
    return lookup.get(nutsName.trim().toLowerCase()) || null;
}

function resolvePolicyId(serialNumber, sourceId, payload) {
    if (serialNumber) return serialNumber;
    const source = cleanStr(sourceId);
    if (source && /^S\d+$/i.test(source)) return source;
    return `gen_${createHash('sha1').update(payload).digest('hex').slice(0, 12)}`;
}

function normalizeNutsName(value, nuts) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    if (raw.toUpperCase() === String(nuts || '').toUpperCase()) return null;
    return capitalizeWords(raw);
}

function normalizeYesNo(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('y')) return 'yes';
    if (lower.startsWith('n')) return 'no';
    return lower;
}

function normalizeStatus(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return raw.toLowerCase();
}

function normalizePolicyEffect(value) {
    const raw = cleanStr(value);
    const lower = (raw || 'constraining').toLowerCase();
    return lower.includes('promot') ? 'promoting' : 'constraining';
}

function normalizeVariable(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return raw.toLowerCase().replace(/\s+/g, ' ');
}

function normalizeInstallationType(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return raw.toLowerCase().replace(/\s+/g, '_');
}

function normalizeInstallationScale(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return capitalizeWords(raw.replace(/_/g, ' '));
}

function normalizeMinOrMax(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return raw.toLowerCase();
}

function normalizeMultilineText(value) {
    const raw = cleanStr(value);
    if (!raw || isPlaceholder(raw)) return null;
    return raw.replace(/\n+/g, '\n');
}

function buildColmap(columns) {
    const map = new Map();
    for (const column of columns) {
        if (column == null) continue;
        map.set(String(column).trim().toLowerCase(), column);
    }
    return map;
}

function getCell(row, colmap, ...names) {
    for (const name of names) {
        const key = String(name).trim().toLowerCase();
        const column = colmap.get(key);
        if (column != null) return row[column];
    }
    return null;
}

function compareRules(a, b) {
    return (
        String(a.country).localeCompare(String(b.country))
        || String(a.nuts).localeCompare(String(b.nuts))
        || String(a.kind).localeCompare(String(b.kind))
        || String(a.variable).localeCompare(String(b.variable))
        || Number(a.year_decision || 0) - Number(b.year_decision || 0)
        || String(a.serial_number || '').localeCompare(String(b.serial_number || ''))
    );
}

function compareWpa(a, b) {
    return (
        String(a.country).localeCompare(String(b.country))
        || String(a.nuts).localeCompare(String(b.nuts))
        || String(a.indicator || '').localeCompare(String(b.indicator || ''))
    );
}

function hasWindPriorityRule(rules, nuts) {
    return rules.some(
        (rule) => rule.kind === 'wind'
            && rule.nuts === nuts
            && rule.variable === WIND_PRIORITY_VARIABLE,
    );
}

function wpaToWindRule(area) {
    return {
        kind: 'wind',
        row_index: area.row_index,
        serial_number: area.serial_number,
        added_in_version: area.added_in_version || 'V1.0',
        status_changed_in_version: area.status_changed_in_version || area.added_in_version || 'V1.0',
        policy_id: area.serial_number || `wpa_${area.nuts}`,
        policy_effect: 'promoting',
        policy_type_raw: 'Promoting',
        nuts: area.nuts,
        nuts_name: area.nuts_name,
        country: area.country,
        year_decision: null,
        year_ended: null,
        location_or_characteristics: null,
        variable: WIND_PRIORITY_VARIABLE,
        installation_type: 'wind_onshore',
        installation_scale: null,
        min_or_max: null,
        multiple_conditions: null,
        values: [],
        legally_binding: null,
        explicitly_mentioned: null,
        source_name: null,
        source_id: null,
        source_section: null,
        source_link: area.source_link,
        source_alternative: null,
        text_original: area.text_original,
        text_translation: area.text_translation,
        miscellaneous: area.indicator,
        status: area.status || 'active',
        active: area.active || 'active',
        inactive_detail: null,
        supersedes_policy: null,
        overwritten_by_row: null,
        notes_updated_laws: null,
        validated: null,
    };
}

function deriveWindPriorityAreas(rules) {
    return rules
        .filter((rule) => rule.kind === 'wind' && rule.variable === WIND_PRIORITY_VARIABLE)
        .map((rule) => ({
            kind: 'wind_priority_area',
            row_index: rule.row_index,
            serial_number: rule.serial_number,
            added_in_version: rule.added_in_version,
            status_changed_in_version: rule.status_changed_in_version,
            nuts: rule.nuts,
            nuts_name: rule.nuts_name,
            country: rule.country,
            indicator: rule.miscellaneous || 'Wind Priority Area (WPA)',
            source_link: rule.source_link,
            text_original: rule.text_original,
            text_translation: rule.text_translation,
            status: rule.status || rule.active || 'active',
            active: rule.active || rule.status || 'active',
        }))
        .sort(compareWpa);
}

function mergeWindPriorityAreas(baseRules, wpaRows) {
    const merged = [...baseRules];
    for (const area of wpaRows) {
        const asWind = wpaToWindRule(area);
        if (!hasWindPriorityRule(merged, asWind.nuts)) {
            merged.push(asWind);
        }
    }
    return merged.sort(compareRules);
}

function formatTechnologyLabel(value) {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'wind' || normalized === 'wind_priority_area') return 'Wind';
    if (normalized === 'solar') return 'Solar';
    if (normalized === 'ev') return 'Electric Vehicles';
    return capitalizeWords(String(value));
}

function formatVariableLabel(value) {
    if (!value) return null;
    return capitalizeWords(String(value).replace(/^\d+_/, '').replace(/_/g, ' '));
}

function flattenRuleForWorkbook(rule) {
    const row = {
        Technology: formatTechnologyLabel(rule.kind),
        Country: rule.country || null,
        Nuts: rule.nuts || null,
        'Nuts Name': rule.nuts_name || null,
        Variable: formatVariableLabel(rule.variable),
        'Year Decision': rule.year_decision ?? null,
        'Year Ended': rule.year_ended ?? null,
        Status: rule.status ? capitalizeWords(rule.status) : null,
        'Policy Effect': rule.policy_effect ? capitalizeWords(rule.policy_effect) : null,
        'Installation Type': rule.installation_type
            ? capitalizeWords(String(rule.installation_type).replace(/_/g, ' '))
            : null,
        'Installation Scale': rule.installation_scale || null,
        'Location Or Characteristics': rule.location_or_characteristics || null,
        'Min Or Max': rule.min_or_max ? capitalizeWords(rule.min_or_max) : null,
        'Multiple Conditions': rule.multiple_conditions || null,
        'Legally Binding': rule.legally_binding ? capitalizeWords(rule.legally_binding) : null,
        'Explicitly Mentioned': rule.explicitly_mentioned ? capitalizeWords(rule.explicitly_mentioned) : null,
        'Source Name': rule.source_name || null,
        'Source Id': rule.source_id || null,
        'Source Section': rule.source_section || null,
        'Source Link': rule.source_link || null,
        'Source Alternative': rule.source_alternative || null,
        'Text Original': rule.text_original || null,
        'Text Translation': rule.text_translation || null,
        Miscellaneous: rule.miscellaneous || null,
        'Inactive Detail': rule.inactive_detail ? capitalizeWords(rule.inactive_detail) : null,
        'Supersedes Policy': rule.supersedes_policy || null,
        'Notes Updated Laws': rule.notes_updated_laws ? capitalizeWords(rule.notes_updated_laws) : null,
        Validated: rule.validated ? capitalizeWords(rule.validated) : null,
        'Record Type': 'Regulation',
        'Serial Number': rule.serial_number || null,
        'Added In Version': rule.added_in_version || 'V1.0',
        'Status Changed In Version': rule.status_changed_in_version || rule.added_in_version || 'V1.0',
    };

    (rule.values || []).slice(0, 4).forEach((entry, index) => {
        const slot = index + 1;
        row[`Value ${slot}`] = entry?.value ?? null;
        row[`Unit ${slot}`] = entry?.unit ?? null;
        row[`Condition ${slot}`] = entry?.condition ? capitalizeWords(entry.condition) : null;
    });

    return row;
}

function buildWorkbookRows(rules) {
    return rules.map(flattenRuleForWorkbook).sort(
        (a, b) =>
            String(a.Country || '').localeCompare(String(b.Country || ''))
            || String(a.Nuts || '').localeCompare(String(b.Nuts || ''))
            || String(a.Technology || '').localeCompare(String(b.Technology || ''))
            || String(a.Variable || '').localeCompare(String(b.Variable || ''))
            || Number(a['Year Decision'] || 0) - Number(b['Year Decision'] || 0)
    );
}

function parseSheet(rows, kind) {
    if (!rows.length) return [];
    const colmap = buildColmap(Object.keys(rows[0] || {}));
    const nutsNameLookup = buildNutsNameLookup(rows, colmap);
    const rules = [];

    rows.forEach((row, index) => {
        const country = normalizeCountry(getCell(row, colmap, 'Country'));
        const nuts = resolveNuts(row, colmap, nutsNameLookup);
        const variable = normalizeVariable(getCell(row, colmap, 'Variable', 'variable'));
        if (!country || !SUPPORTED_COUNTRIES.has(country) || !nuts || !variable) return;

        const statusRaw = normalizeStatus(getCell(row, colmap, 'status', 'active_inactive', 'active/inactive', 'Status'));
        const addedInVersion = cleanStr(getCell(row, colmap, 'added_in_version')) || 'V1.0';
        const statusChangedInVersion = cleanStr(getCell(row, colmap, 'status_changed_in_version')) || addedInVersion;
        const serialNumber = cleanStr(getCell(row, colmap, 'serial_number', 'serial number'));
        const policyTypeRaw = cleanStr(getCell(row, colmap,
            'policy_type',
            'policy type',
            'type_of_policy',
            'constraining_promoting',
            'constraining_promoting ',
            'constraining/promoting',
            'type of policy',
            'Constraining_Promoting',
        ));
        const policyEffect = normalizePolicyEffect(policyTypeRaw);

        const sourceId = cleanStr(getCell(row, colmap, 'Source_ID', 'source_id'));
        const sourceName = normalizeMultilineText(getCell(row, colmap, 'Source_name', 'source_name'));
        const yearDecision = cleanNum(getCell(row, colmap, 'Year_decision', 'year_decision'));
        const yearEndedRaw = cleanStr(getCell(row, colmap, 'Year_ended', 'year_ended'));
        const yearEnded = yearEndedRaw && !/^n\/?a$/i.test(yearEndedRaw)
            ? cleanNum(yearEndedRaw)
            : null;
        const policyId = resolvePolicyId(serialNumber, sourceId, [
            kind,
            country,
            nuts,
            variable,
            String(yearDecision || ''),
            sourceName || '',
            cleanStr(getCell(row, colmap, 'Text_translation', 'text_translation')) || '',
        ].join('|'));

        const rule = {
            kind,
            row_index: index + 2,
            serial_number: serialNumber,
            added_in_version: addedInVersion,
            status_changed_in_version: statusChangedInVersion,
            policy_id: policyId,
            policy_effect: policyEffect,
            policy_type_raw: policyTypeRaw,
            nuts,
            nuts_name: normalizeNutsName(getCell(row, colmap, 'NUTS_Name', 'NUTS_NAME', 'nuts_name'), nuts),
            country,
            year_decision: yearDecision == null ? null : Math.trunc(yearDecision),
            year_ended: yearEnded == null ? null : Math.trunc(yearEnded),
            location_or_characteristics: capitalizeWords(
                cleanStr(getCell(row, colmap, 'Location_or_characteristics', 'location_or_characteristics')) || ''
            ) || null,
            variable,
            installation_type: normalizeInstallationType(getCell(row, colmap, 'Installation_type', 'installation_type')),
            installation_scale: normalizeInstallationScale(getCell(row, colmap, 'Installation_scale', 'installation_scale')),
            min_or_max: normalizeMinOrMax(getCell(row, colmap, 'Minimum_or_maximum', 'min_or_max')),
            multiple_conditions: capitalizeWords(
                cleanStr(getCell(row, colmap, 'Multiple_conditions_attribute', 'multiple_conditions_attribute')) || ''
            ) || null,
            values: [],
            legally_binding: normalizeYesNo(getCell(row, colmap, 'Legally_binding', 'legally_binding')),
            explicitly_mentioned: normalizeYesNo(
                getCell(row, colmap, 'WT_explicitly_mentioned')
                || getCell(row, colmap, 'Solar_explicitly_mentioned')
                || getCell(row, colmap, 'EV_explicitly_mentioned')
            ),
            source_name: sourceName,
            source_id: sourceId,
            source_section: cleanStr(getCell(row, colmap, 'Source_section', 'source_section')),
            source_link: cleanStr(getCell(row, colmap, 'Source_link', 'source_link')),
            source_alternative: cleanStr(getCell(row, colmap, 'Source_alternative', 'source_alternative')),
            text_original: normalizeMultilineText(getCell(row, colmap, 'Text_original', 'text_original')),
            text_translation: normalizeMultilineText(getCell(row, colmap, 'Text_translation', 'text_translation')),
            miscellaneous: normalizeMultilineText(getCell(row, colmap, 'Miscellaneous', 'miscellaneous')),
            status: statusRaw,
            active: statusRaw,
            inactive_detail: cleanStr(getCell(row, colmap, 'inactive_policy_status', 'inactive_detail', 'inactive_reason')),
            supersedes_policy: cleanStr(getCell(row, colmap, 'supersedes_policy', 'Supersedes_policy')),
            overwritten_by_row: cleanNum(getCell(row, colmap,
                'overwritten_by_row',
                'overwritten_policy_replacement',
                'replaced_by_row',
                'replacing_policy_row',
            )),
            notes_updated_laws: cleanStr(getCell(row, colmap, 'notes_updated_laws', 'notes - updated laws')),
            validated: normalizeYesNo(getCell(row, colmap, 'Validated_by_experts', 'validated_by_experts')),
        };

        for (let i = 1; i <= 4; i += 1) {
            const value = cleanNum(getCell(row, colmap, `Value_${i}`, `value_${i}`));
            const unit = cleanStr(getCell(row, colmap, `Unit_${i}`, `unit_${i}`));
            const condition = cleanStr(getCell(row, colmap, `Condition_${i}`, `condition_${i}`));
            if (value != null || unit || condition) {
                rule.values.push({ value, unit, condition });
            }
        }

        rules.push(rule);
    });

    return rules.sort(compareRules);
}

function parseWpa(rows) {
    if (!rows.length) return [];
    const colmap = buildColmap(Object.keys(rows[0] || {}));
    const out = [];

    rows.forEach((row, index) => {
        const nuts = normalizeNuts(getCell(row, colmap, 'NUTS'));
        const country = normalizeCountry(getCell(row, colmap, 'COUNTRY', 'Country'));
        const indicator = cleanStr(getCell(row, colmap, 'INDICATOR', 'indicator'));
        const sourceLink = cleanStr(getCell(row, colmap, 'SOURCE_LINK', 'source_link'));
        const textOriginal = normalizeMultilineText(getCell(row, colmap, 'TEXT_ORIGINAL', 'text_original'));
        const textTranslation = normalizeMultilineText(getCell(row, colmap, 'TEXT_TRANSLATION', 'text_translation'));

        if (!nuts || !country || !SUPPORTED_COUNTRIES.has(country) || !indicator) return;
        if (isPlaceholder(sourceLink) && isPlaceholder(textOriginal) && isPlaceholder(textTranslation)) return;

        const addedInVersion = cleanStr(getCell(row, colmap, 'added_in_version')) || 'V1.0';
        const statusChangedInVersion = cleanStr(getCell(row, colmap, 'status_changed_in_version')) || addedInVersion;

        out.push({
            kind: 'wind_priority_area',
            row_index: index + 2,
            serial_number: cleanStr(getCell(row, colmap, 'serial_number', 'serial number')),
            added_in_version: addedInVersion,
            status_changed_in_version: statusChangedInVersion,
            nuts,
            nuts_name: normalizeNutsName(getCell(row, colmap, 'NUTS_NAME', 'NUTS_Name', 'nuts_name'), nuts),
            country,
            indicator,
            source_link: isPlaceholder(sourceLink) ? null : sourceLink,
            text_original: textOriginal,
            text_translation: textTranslation,
            status: 'active',
            active: 'active',
        });
    });

    return out.sort(compareWpa);
}

function summarize(rules) {
    const countries = {};
    const byVariable = {};
    const byYear = {};
    for (const rule of rules) {
        countries[rule.country] = (countries[rule.country] || 0) + 1;
        byVariable[rule.variable] = (byVariable[rule.variable] || 0) + 1;
        if (rule.year_decision) {
            byYear[rule.year_decision] = (byYear[rule.year_decision] || 0) + 1;
        }
    }
    return {
        by_country: Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b))),
        by_variable: Object.fromEntries(Object.entries(byVariable).sort(([a], [b]) => a.localeCompare(b))),
        by_year: Object.fromEntries(Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b))),
    };
}

function main() {
    const path = findExcel();
    const workbook = XLSX.readFile(path);
    const sheetRows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name] || {}, { defval: null });

    const wind = parseSheet(sheetRows('Wind regulations'), 'wind');
    const solar = parseSheet(sheetRows('Solar regulations'), 'solar');
    const ev = parseSheet(sheetRows('EV charging regulations'), 'ev');
    const wpa = parseWpa(sheetRows('WPA_GR'));
    const rules = mergeWindPriorityAreas([...wind, ...solar, ...ev], wpa);
    const windPriorityAreas = deriveWindPriorityAreas(rules);
    const summary = summarize(rules);

    const output = {
        meta: {
            source: path,
            generated_at: new Date().toISOString(),
            rule_count: rules.length,
            wind_priority_area_count: windPriorityAreas.length,
            ...summary,
            sheets: ['Wind regulations', 'Solar regulations', 'EV charging regulations', 'WPA_GR'],
        },
        rules,
        wind_priority_areas: windPriorityAreas,
    };

    const publicPath = join('public', 'data', 'build_regulations.json');
    const docsPath = join('docs', 'data', 'build_regulations.json');
    const publicWorkbookPath = join('public', 'data', 'build_regulations.xlsx');
    const docsWorkbookPath = join('docs', 'data', 'build_regulations.xlsx');
    mkdirSync(join('public', 'data'), { recursive: true });
    mkdirSync(join('docs', 'data'), { recursive: true });
    const payload = `${JSON.stringify(output, null, 2)}\n`;
    writeFileSync(publicPath, payload, 'utf8');
    copyFileSync(publicPath, docsPath);
    const workbookRows = buildWorkbookRows(rules);
    const exportWorkbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(workbookRows, { header: BUILD_REGULATIONS_XLSX_HEADERS });
    XLSX.utils.book_append_sheet(exportWorkbook, sheet, 'Building_Regulations');
    XLSX.writeFile(exportWorkbook, publicWorkbookPath, { compression: true });
    copyFileSync(publicWorkbookPath, docsWorkbookPath);
    console.log(`Wrote ${publicPath}: ${rules.length} rules, ${windPriorityAreas.length} wind-priority-area rows.`);
    console.log(`Wrote ${docsWorkbookPath}: ${workbookRows.length} export rows.`);
    console.log('Countries:', summary.by_country);
}

main();
