
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, 'public/data/policy_data.csv');
const xlsxPath = path.join(__dirname, 'public/data/policy_data.xlsx');

const csvContent = fs.readFileSync(csvPath, 'utf8');

// Parse CSV manually or let XLSX do it. XLSX.read with type:'string' handles CSV.
// But we need to handle semicolon.
const workbook = XLSX.read(csvContent, { type: 'string', raw: true }); // raw:true avoids parsing values, just strings. 
// Actually, let's just parse it as CSV with semicolon
// If XLSX doesn't auto-detect semicolon, we might need to replace it or use a different parser.
// Let's try to let XLSX handle it.

// Check if it parsed correctly
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

if (json.length > 0 && json[0].length === 1 && json[0][0].includes(';')) {
    console.log("XLSX didn't split by semicolon automatically. Fixing...");
    // It didn't split.
    // We can just construct a workbook from array of arrays
    const rows = csvContent.split('\n').map(line => line.split(';'));
    const newSheet = XLSX.utils.aoa_to_sheet(rows);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newSheet, "Sheet1");
    XLSX.writeFile(newWb, xlsxPath);
} else {
    XLSX.writeFile(workbook, xlsxPath);
}

console.log("Created policy_data.xlsx");
