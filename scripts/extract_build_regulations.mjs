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

function parseSheet(rows, kind) {
    if (!rows.length) return [];
    const colmap = buildColmap(Object.keys(rows[0] || {}));
    const rules = [];

    rows.forEach((row, index) => {
        const country = normalizeCountry(getCell(row, colmap, 'Country'));
        const nuts = normalizeNuts(getCell(row, colmap, 'NUTS'));
        const variable = normalizeVariable(getCell(row, colmap, 'Variable', 'variable'));
        if (!country || !SUPPORTED_COUNTRIES.has(country) || !nuts || !variable) return;

        const statusRaw = normalizeStatus(getCell(row, colmap, 'status', 'active_inactive', 'active/inactive'));
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
        ));
        const policyEffect = normalizePolicyEffect(policyTypeRaw);

        const sourceId = cleanStr(getCell(row, colmap, 'Source_ID', 'source_id'));
        const sourceName = normalizeMultilineText(getCell(row, colmap, 'Source_name', 'source_name'));
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
                variable,
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
    const rules = [...wind, ...solar, ...ev].sort(compareRules);
    const summary = summarize(rules);

    const output = {
        meta: {
            source: path,
            generated_at: new Date().toISOString(),
            rule_count: rules.length,
            wind_priority_area_count: wpa.length,
            ...summary,
            sheets: ['Wind regulations', 'Solar regulations', 'EV charging regulations', 'WPA_GR'],
        },
        rules,
        wind_priority_areas: wpa,
    };

    const publicPath = join('public', 'data', 'build_regulations.json');
    const docsPath = join('docs', 'data', 'build_regulations.json');
    mkdirSync(join('public', 'data'), { recursive: true });
    mkdirSync(join('docs', 'data'), { recursive: true });
    const payload = `${JSON.stringify(output, null, 2)}\n`;
    writeFileSync(publicPath, payload, 'utf8');
    copyFileSync(publicPath, docsPath);
    console.log(`Wrote ${publicPath}: ${rules.length} rules, ${wpa.length} wind-priority-area rows.`);
    console.log('Countries:', summary.by_country);
}

main();
