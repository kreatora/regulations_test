/**
 * Extracts the build-regulations workbook into public/data/build_regulations.json.
 * Node alternative when Python/openpyxl is unavailable.
 *
 * Run from repo root: node scripts/extract_build_regulations.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';

const EXCEL_PATH_CANDIDATES = [
    'docs/data/regulations_data.xlsx',
    'public/data/regulations_data.xlsx',
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
    const text = String(value).trim();
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

function normalizeCountry(value) {
    const raw = cleanStr(value);
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('germany')) return 'Germany';
    if (lower.startsWith('greece')) return 'Greece';
    if (lower.startsWith('ireland')) return 'Ireland';
    if (lower.startsWith('france')) return 'France';
    return raw;
}

function normalizeNuts(value) {
    const raw = cleanStr(value);
    if (!raw) return null;
    return raw.replace(/\s+/g, '').toUpperCase();
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

function parseSheet(rows, kind) {
    if (!rows.length) return [];
    const colmap = buildColmap(Object.keys(rows[0] || {}));
    const rules = [];

    rows.forEach((row, index) => {
        const country = normalizeCountry(getCell(row, colmap, 'Country'));
        if (!country) return;
        const nuts = normalizeNuts(getCell(row, colmap, 'NUTS'));
        if (!nuts) return;

        const statusRaw = cleanStr(getCell(row, colmap, 'status', 'active_inactive', 'active/inactive'));
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
            'constraining_promoting ',
        ));
        const policyType = (policyTypeRaw || 'constraining').toLowerCase();
        const policyEffect = policyType.includes('promot') ? 'promoting' : 'constraining';

        const sourceId = cleanStr(getCell(row, colmap, 'Source_ID', 'source_id'));
        const sourceName = cleanStr(getCell(row, colmap, 'Source_name', 'source_name'));
        const variable = cleanStr(getCell(row, colmap, 'Variable', 'variable'));
        const yearDecision = cleanNum(getCell(row, colmap, 'Year_decision', 'year_decision'));
        const yearEndedRaw = cleanStr(getCell(row, colmap, 'Year_ended', 'year_ended'));
        const yearEnded = yearEndedRaw && !/^n\/?a$/i.test(yearEndedRaw)
            ? cleanNum(yearEndedRaw)
            : null;
        let policyId = serialNumber || sourceId;
        if (!policyId) {
            const payload = [
                kind,
                country,
                nuts,
                variable || '',
                String(yearDecision || ''),
                sourceName || '',
                cleanStr(getCell(row, colmap, 'Text_translation', 'text_translation')) || '',
            ].join('|');
            policyId = `gen_${createHash('sha1').update(payload).digest('hex').slice(0, 12)}`;
        }

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
            nuts_name: cleanStr(getCell(row, colmap, 'NUTS_Name', 'NUTS_NAME', 'nuts_name')),
            country,
            year_decision: yearDecision == null ? null : Math.trunc(yearDecision),
            year_ended: yearEnded == null ? null : Math.trunc(yearEnded),
            location_or_characteristics: cleanStr(getCell(row, colmap, 'Location_or_characteristics', 'location_or_characteristics')),
            variable,
            installation_type: cleanStr(getCell(row, colmap, 'Installation_type', 'installation_type')),
            installation_scale: cleanStr(getCell(row, colmap, 'Installation_scale', 'installation_scale')),
            min_or_max: cleanStr(getCell(row, colmap, 'Minimum_or_maximum', 'min_or_max')),
            multiple_conditions: cleanStr(getCell(row, colmap, 'Multiple_conditions_attribute', 'multiple_conditions_attribute')),
            values: [],
            legally_binding: cleanStr(getCell(row, colmap, 'Legally_binding', 'legally_binding')),
            explicitly_mentioned: cleanStr(
                getCell(row, colmap, 'WT_explicitly_mentioned')
                || getCell(row, colmap, 'Solar_explicitly_mentioned')
                || getCell(row, colmap, 'EV_explicitly_mentioned')
            ),
            source_name: sourceName,
            source_id: sourceId,
            source_section: cleanStr(getCell(row, colmap, 'Source_section', 'source_section')),
            source_link: cleanStr(getCell(row, colmap, 'Source_link', 'source_link')),
            source_alternative: cleanStr(getCell(row, colmap, 'Source_alternative', 'source_alternative')),
            text_original: cleanStr(getCell(row, colmap, 'Text_original', 'text_original')),
            text_translation: cleanStr(getCell(row, colmap, 'Text_translation', 'text_translation')),
            miscellaneous: cleanStr(getCell(row, colmap, 'Miscellaneous', 'miscellaneous')),
            status: statusRaw,
            active: statusRaw,
            inactive_detail: cleanStr(getCell(row, colmap, 'inactive_policy_status', 'inactive_detail', 'inactive_reason')),
            supersedes_policy: cleanStr(getCell(row, colmap,
                'supersedes_policy',
                'Supersedes_policy',
            )),
            overwritten_by_row: cleanNum(getCell(row, colmap,
                'overwritten_by_row',
                'overwritten_policy_replacement',
                'replaced_by_row',
                'replacing_policy_row',
            )),
            last_update: cleanStr(getCell(row, colmap, 'last_update', 'last update')),
            notes_updated_laws: cleanStr(getCell(row, colmap, 'notes_updated_laws', 'notes - updated laws')),
            validated: cleanStr(getCell(row, colmap, 'Validated_by_experts', 'validated_by_experts')),
        };

        for (let i = 1; i <= 4; i += 1) {
            const value = cleanNum(getCell(row, colmap, `Value_${i}`, `value_${i}`));
            const unit = cleanStr(getCell(row, colmap, `Unit_${i}`, `unit_${i}`));
            const condition = cleanStr(getCell(row, colmap, `Condition_${i}`, `condition_${i}`));
            if (value != null || unit || condition) {
                rule.values.push({ value, unit, condition });
            }
        }

        if (!rule.variable) return;
        rules.push(rule);
    });

    return rules;
}

function parseWpa(rows) {
    if (!rows.length) return [];
    const colmap = buildColmap(Object.keys(rows[0] || {}));
    const out = [];
    rows.forEach((row, index) => {
        const nuts = normalizeNuts(getCell(row, colmap, 'NUTS'))
            || normalizeNuts(getCell(row, colmap, 'NUTS_NAME', 'NUTS_Name', 'nuts_name'));
        if (!nuts) return;
        const addedInVersion = cleanStr(getCell(row, colmap, 'added_in_version')) || 'V1.0';
        const statusChangedInVersion = cleanStr(getCell(row, colmap, 'status_changed_in_version')) || addedInVersion;
        out.push({
            kind: 'wind_priority_area',
            row_index: index + 2,
            serial_number: cleanStr(getCell(row, colmap, 'serial_number', 'serial number')),
            added_in_version: addedInVersion,
            status_changed_in_version: statusChangedInVersion,
            nuts,
            nuts_name: cleanStr(getCell(row, colmap, 'NUTS_NAME', 'NUTS_Name', 'nuts_name')),
            country: normalizeCountry(getCell(row, colmap, 'COUNTRY', 'Country')),
            indicator: cleanStr(getCell(row, colmap, 'INDICATOR', 'indicator')),
            source_link: cleanStr(getCell(row, colmap, 'SOURCE_LINK', 'source_link')),
            text_original: cleanStr(getCell(row, colmap, 'TEXT_ORIGINAL', 'text_original')),
            text_translation: cleanStr(getCell(row, colmap, 'TEXT_TRANSLATION', 'text_translation')),
            status: 'active',
            active: 'active',
        });
    });
    return out;
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
    const rules = [...wind, ...solar, ...ev];
    const summary = summarize(rules);

    const output = {
        meta: {
            source: path,
            rule_count: rules.length,
            ...summary,
            sheets: ['Wind regulations', 'Solar regulations', 'EV charging regulations', 'WPA_GR'],
        },
        rules,
        wind_priority_areas: wpa,
    };

    const outPath = join('public', 'data', 'build_regulations.json');
    mkdirSync(join('public', 'data'), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${outPath}: ${rules.length} rules, ${wpa.length} wind-priority-area rows.`);
    console.log('Countries:', summary.by_country);
}

main();
