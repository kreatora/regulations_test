import csv
from collections import Counter

path = r'C:\Users\doguk\Documents\GitHub\regulations_test\public\data\targetRE_normalised targets_w_energy.csv'

EU27 = {
    'AUT', 'BEL', 'BGR', 'CYP', 'CZE', 'DEU', 'DNK', 'ESP', 'EST', 'FIN',
    'FRA', 'GRC', 'HRV', 'HUN', 'IRL', 'ITA', 'LTU', 'LUX', 'LVA', 'MLT',
    'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'SWE',
}

with open(path, encoding='utf-8-sig', newline='') as f:
    raw_lines = f.read().split('\n')

# Fix the known broken multi-line row for GIN (Guinea) by joining it with the next line.
fixed_lines = []
i = 0
n_fixed = 0
while i < len(raw_lines):
    line = raw_lines[i]
    if (
        line.startswith('GIN;2013;Guinea')
        and i + 1 < len(raw_lines)
        and raw_lines[i + 1].startswith('"Wind 2% of electricity')
    ):
        next_line = raw_lines[i + 1].rstrip('\r')
        note_part = next_line.split('";', 1)[0].lstrip('"')
        combined = line.rstrip('\r') + ' / ' + note_part
        fixed_lines.append(combined)
        i += 2
        n_fixed += 1
    else:
        fixed_lines.append(line)
        i += 1

print('rows fixed:', n_fixed)

reader = csv.reader(fixed_lines, delimiter=';')
header = next(reader)
rows = [row for row in reader if any(cell.strip() for cell in row)]
print('header:', header)
print('num data rows:', len(rows))
lens = set(len(r) for r in rows)
print('row length set:', lens)

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
print(Counter(r[idx_country].strip() in EU27 for r in out_rows))
