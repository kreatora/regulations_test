
const XLSX = require('xlsx');
const d3 = require('d3');
const fs = require('fs');
const path = require('path');

const xlsxPath = path.join(__dirname, 'public/data/policy_data.xlsx');
const buffer = fs.readFileSync(xlsxPath);

const wb = XLSX.read(buffer);
const ws = wb.Sheets[wb.SheetNames[0]];
const csvText = XLSX.utils.sheet_to_csv(ws);

const parsed = d3.csvParse(csvText);

console.log("Parsed columns:", parsed.columns);
console.log("First row:", parsed[0]);
console.log("Row count:", parsed.length);
console.log("CSV text preview:", csvText.substring(0, 500));
