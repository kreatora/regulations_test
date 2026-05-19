"""
Extracts the build-regulations workbook into a single JSON payload that the
front-end Build Codes view can consume directly.

Run from repo root:
    python3 scripts/extract_build_regulations.py
"""
from __future__ import annotations
import json
import math
import os
import re
import sys
from collections import defaultdict

import pandas as pd

EXCEL_PATH_CANDIDATES = [
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
    rules = []
    for _, row in df.iterrows():
        country = normalize_country(row.get("Country"))
        if not country:
            continue
        nuts = normalize_nuts(row.get("NUTS"))
        if not nuts:
            continue
        rule = {
            "kind": kind,
            "nuts": nuts,
            "nuts_name": clean_str(row.get("NUTS_Name") or row.get("NUTS_NAME")),
            "country": country,
            "year_decision": int(clean_num(row.get("Year_decision")) or 0) or None,
            "location_or_characteristics": clean_str(row.get("Location_or_characteristics")),
            "variable": clean_str(row.get("Variable")),
            "installation_type": clean_str(row.get("Installation_type")),
            "installation_scale": clean_str(row.get("Installation_scale")),
            "min_or_max": clean_str(row.get("Minimum_or_maximum")),
            "multiple_conditions": clean_str(row.get("Multiple_conditions_attribute")),
            "values": [],
            "legally_binding": clean_str(row.get("Legally_binding")),
            "explicitly_mentioned": clean_str(
                row.get("WT_explicitly_mentioned")
                or row.get("Solar_explicitly_mentioned")
                or row.get("EV_explicitly_mentioned")
            ),
            "source_name": clean_str(row.get("Source_name")),
            "source_id": clean_str(row.get("Source_ID")),
            "source_section": clean_str(row.get("Source_section")),
            "source_link": clean_str(row.get("Source_link")),
            "source_alternative": clean_str(row.get("Source_alternative")),
            "text_original": clean_str(row.get("Text_original")),
            "text_translation": clean_str(row.get("Text_translation")),
            "miscellaneous": clean_str(row.get("Miscellaneous")),
            "active": clean_str(row.get("Active_inactive")),
            "validated": clean_str(row.get("Validated_by_experts")),
        }
        for i in (1, 2, 3, 4):
            v = clean_num(row.get(f"Value_{i}"))
            u = clean_str(row.get(f"Unit_{i}"))
            c = clean_str(row.get(f"Condition_{i}"))
            if v is not None or u or c:
                rule["values"].append({"value": v, "unit": u, "condition": c})
        if not rule["variable"]:
            continue
        rules.append(rule)
    return rules


def parse_wpa(df: pd.DataFrame):
    out = []
    for _, row in df.iterrows():
        nuts = normalize_nuts(row.get("NUTS"))
        if not nuts:
            continue
        out.append({
            "nuts": nuts,
            "nuts_name": clean_str(row.get("NUTS_NAME")),
            "country": normalize_country(row.get("COUNTRY")),
            "indicator": clean_str(row.get("INDICATOR")),
            "source_link": clean_str(row.get("SOURCE_LINK")),
            "text_original": clean_str(row.get("TEXT_ORIGINAL")),
            "text_translation": clean_str(row.get("TEXT_TRANSLATION")),
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
