import csv
from collections import Counter

path = r'C:\Users\doguk\Documents\GitHub\regulations_test\public\data\climate_targets.csv'

EU27 = {
    'AUT', 'BEL', 'BGR', 'CYP', 'CZE', 'DEU', 'DNK', 'ESP', 'EST', 'FIN',
    'FRA', 'GRC', 'HRV', 'HUN', 'IRL', 'ITA', 'LTU', 'LUX', 'LVA', 'MLT',
    'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'SWE',
}

with open(path, encoding='utf-8-sig', newline='') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    rows = list(reader)

print('header:', header)
print('num data rows:', len(rows))
lens = set(len(r) for r in rows)
print('row length set (should be single value = no data changed):', lens)

idx_country = header.index('Country_code')

new_header = header + ['added_in_version', 'change_reason', 'status', 'status_changed_in_version']

out_rows = []
for row in rows:
    code = row[idx_country].strip()
    if code in EU27:
        version = 'V1'
        change_reason = ''
    else:
        version = 'V3'
        change_reason = 'New non-EU-27 observation added in V3'
    out_rows.append(row + [version, change_reason, 'active', version])

with open(path, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, delimiter=';')
    w.writerow(new_header)
    w.writerows(out_rows)

print('wrote', len(out_rows), 'rows with new header:', new_header)
print(Counter(r[-4] for r in out_rows))
