"""
Extracts the build-regulations workbook into public/data/build_regulations.json.

Preferred entry point (Node, no openpyxl version issues):
    npm run extract:regulations

Python alternative:
    python scripts/extract_build_regulations.py
"""
from __future__ import annotations
import json
import math
import os
import re
import sys
import hashlib
from collections import defaultdict

import pandas as pd

EXCEL_PATH_CANDIDATES = [
    "docs/data/regulations_data.xlsx",
    "public/data/regulations_data.xlsx",
    "docs/data/regulations_data.xls",
    "public/data/regulations_data.xls",
    "../regulations_data.xlsx",
    "regulations_data.xlsx",
    "../regulations_data.xls",
    "regulations_data.xls",
    "../D2.2.1.1_Data colllection_regulations for energy infrastructure_feb25.xlsx",
    "D2.2.1.1_Data colllection_regulations for energy infrastructure_feb25.xlsx",
    os.path.expanduser(
        "~/Desktop/docs/regulations/D2.2.1.1_Data colllection_regulations for energy infrastructure_feb25.xlsx"
    ),
]


def find_excel() -> str:
    for path in EXCEL_PATH_CANDIDATES:
        if os.path.exists(path):
            return path
    sys.exit("Could not find the build-regulations workbook in expected locations.")


def clean_str(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    s = str(v).strip()
    return s or None


def clean_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) and not math.isnan(float(v)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r"-?\d+(?:[.,]\d+)?", v)
        if m:
            try:
                return float(m.group(0).replace(",", "."))
            except ValueError:
                return None
    return None


def normalize_country(c):
    s = clean_str(c)
    if not s:
        return None
    s = s.strip()
    if s.lower().startswith("germany"):
        return "Germany"
    if s.lower().startswith("greece"):
        return "Greece"
    if s.lower().startswith("ireland"):
        return "Ireland"
    if s.lower().startswith("france"):
        return "France"
    return s


def normalize_nuts(n):
    s = clean_str(n)
    if not s:
        return None
    return re.sub(r"\s+", "", s).upper()


def parse_sheet(df: pd.DataFrame, kind: str):
    colmap = {str(c).strip().lower(): c for c in df.columns}

    def col(*names: str):
        for name in names:
            key = str(name).strip().lower()
            if key in colmap:
                return colmap[key]
        return None

    def get(row, *names: str):
        c = col(*names)
        return row.get(c) if c is not None else None

    rules = []
    for idx, row in df.iterrows():
        country = normalize_country(get(row, "Country"))
        if not country:
            continue
        nuts = normalize_nuts(get(row, "NUTS"))
        if not nuts:
            continue
        status_raw = clean_str(get(row, "status", "active_inactive", "active/inactive", "Active_inactive"))
        added_in_version = clean_str(get(row, "added_in_version")) or "V1.0"
        status_changed_in_version = clean_str(get(row, "status_changed_in_version")) or added_in_version
        serial_number = clean_str(get(row, "serial_number", "serial number"))
        status = status_raw.lower() if status_raw else None
        policy_type_raw = clean_str(get(
            row,
            "policy_type",
            "policy type",
            "type_of_policy",
            "constraining_promoting",
            "constraining_promoting ",
            "constraining/promoting",
            "type of policy",
        ))
        policy_type = (policy_type_raw or "constraining").lower()
        if "promot" in policy_type:
            policy_effect = "promoting"
        else:
            policy_effect = "constraining"

        source_id = clean_str(get(row, "Source_ID", "source_id"))
        source_name = clean_str(get(row, "Source_name", "source_name"))
        variable = clean_str(get(row, "Variable", "variable"))
        year_decision = int(clean_num(get(row, "Year_decision", "year_decision")) or 0) or None
        year_ended_raw = clean_str(get(row, "Year_ended", "year_ended"))
        year_ended = None
        if year_ended_raw and not re.match(r"^n/?a$", year_ended_raw, re.I):
            year_ended_val = clean_num(year_ended_raw)
            year_ended = int(year_ended_val) if year_ended_val is not None else None
        policy_id = serial_number or source_id
        if not policy_id:
            id_payload = "|".join([
                kind,
                country or "",
                nuts or "",
                variable or "",
                str(year_decision or ""),
                source_name or "",
                clean_str(get(row, "Text_translation", "text_translation")) or "",
            ])
            policy_id = f"gen_{hashlib.sha1(id_payload.encode('utf-8')).hexdigest()[:12]}"

        rule = {
            "kind": kind,
            "row_index": int(idx) + 2,  # +2 for spreadsheet row index with header
            "serial_number": serial_number,
            "added_in_version": added_in_version,
            "status_changed_in_version": status_changed_in_version,
            "policy_id": policy_id,
            "policy_effect": policy_effect,
            "policy_type_raw": policy_type_raw,
            "nuts": nuts,
            "nuts_name": clean_str(get(row, "NUTS_Name", "NUTS_NAME", "nuts_name")),
            "country": country,
            "year_decision": year_decision,
            "year_ended": year_ended,
            "location_or_characteristics": clean_str(get(row, "Location_or_characteristics", "location_or_characteristics")),
            "variable": variable,
            "installation_type": clean_str(get(row, "Installation_type", "installation_type")),
            "installation_scale": clean_str(get(row, "Installation_scale", "installation_scale")),
            "min_or_max": clean_str(get(row, "Minimum_or_maximum", "min_or_max")),
            "multiple_conditions": clean_str(get(row, "Multiple_conditions_attribute", "multiple_conditions_attribute")),
            "values": [],
            "legally_binding": clean_str(get(row, "Legally_binding", "legally_binding")),
            "explicitly_mentioned": clean_str(
                get(row, "WT_explicitly_mentioned")
                or get(row, "Solar_explicitly_mentioned")
                or get(row, "EV_explicitly_mentioned")
            ),
            "source_name": source_name,
            "source_id": source_id,
            "source_section": clean_str(get(row, "Source_section", "source_section")),
            "source_link": clean_str(get(row, "Source_link", "source_link")),
            "source_alternative": clean_str(get(row, "Source_alternative", "source_alternative")),
            "text_original": clean_str(get(row, "Text_original", "text_original")),
            "text_translation": clean_str(get(row, "Text_translation", "text_translation")),
            "miscellaneous": clean_str(get(row, "Miscellaneous", "miscellaneous")),
            "status": status_raw,
            "active": status_raw,  # backward compatibility for existing clients
            "inactive_detail": clean_str(get(row, "inactive_policy_status", "inactive_detail", "inactive_reason")),
            "supersedes_policy": clean_str(get(row, "supersedes_policy", "Supersedes_policy")),
            "overwritten_by_row": clean_num(get(
                row,
                "overwritten_by_row",
                "overwritten_policy_replacement",
                "replaced_by_row",
                "replacing_policy_row",
            )),
            "notes_updated_laws": clean_str(get(row, "notes_updated_laws", "notes - updated laws")),
            "validated": clean_str(get(row, "Validated_by_experts", "validated_by_experts")),
        }
        for i in (1, 2, 3, 4):
            v = clean_num(get(row, f"Value_{i}", f"value_{i}"))
            u = clean_str(get(row, f"Unit_{i}", f"unit_{i}"))
            c = clean_str(get(row, f"Condition_{i}", f"condition_{i}"))
            if v is not None or u or c:
                rule["values"].append({"value": v, "unit": u, "condition": c})
        if not rule["variable"]:
            continue
        rules.append(rule)
    return rules


def parse_wpa(df: pd.DataFrame):
    out = []
    for idx, row in df.iterrows():
        nuts = normalize_nuts(row.get("NUTS"))
        country = normalize_country(row.get("COUNTRY"))
        indicator = clean_str(row.get("INDICATOR"))
        if not nuts or not country or not indicator:
            continue
        source_link = clean_str(row.get("SOURCE_LINK"))
        text_original = clean_str(row.get("TEXT_ORIGINAL"))
        text_translation = clean_str(row.get("TEXT_TRANSLATION"))
        if source_link and source_link.upper() in {"N/A", "NA"} and not text_original and not text_translation:
            continue
        added_in_version = clean_str(row.get("added_in_version")) or "V1.0"
        status_changed_in_version = clean_str(row.get("status_changed_in_version")) or added_in_version
        out.append({
            "kind": "wind_priority_area",
            "row_index": int(idx) + 2,
            "serial_number": clean_str(row.get("serial_number")),
            "added_in_version": added_in_version,
            "status_changed_in_version": status_changed_in_version,
            "nuts": nuts,
            "nuts_name": clean_str(row.get("NUTS_NAME")),
            "country": country,
            "indicator": indicator,
            "source_link": source_link,
            "text_original": text_original,
            "text_translation": text_translation,
            "status": "active",
            "active": "active",
        })
    return out


def main():
    path = find_excel()
    sheets = pd.read_excel(path, sheet_name=None, header=0)

    wind = parse_sheet(sheets.get("Wind regulations", pd.DataFrame()), "wind")
    solar = parse_sheet(sheets.get("Solar regulations", pd.DataFrame()), "solar")
    ev = parse_sheet(sheets.get("EV charging regulations", pd.DataFrame()), "ev")
    wpa = parse_wpa(sheets.get("WPA_GR", pd.DataFrame()))

    rules = wind + solar + ev

    countries = defaultdict(int)
    by_variable = defaultdict(int)
    by_year = defaultdict(int)
    for r in rules:
        countries[r["country"]] += 1
        by_variable[r["variable"]] += 1
        if r["year_decision"]:
            by_year[r["year_decision"]] += 1

    output = {
        "meta": {
            "source": "D2.2.1.1_Data collection_regulations for energy infrastructure_feb25.xlsx",
            "rule_count": len(rules),
            "by_country": dict(sorted(countries.items())),
            "by_variable": dict(sorted(by_variable.items())),
            "by_year": dict(sorted(by_year.items())),
            "sheets": ["Wind regulations", "Solar regulations", "EV charging regulations", "WPA_GR"],
        },
        "rules": rules,
        "wind_priority_areas": wpa,
    }

    out_path = os.path.join("public", "data", "build_regulations.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Wrote {out_path}: {len(rules)} rules, {len(wpa)} wind-priority-area rows.")


if __name__ == "__main__":
    main()
