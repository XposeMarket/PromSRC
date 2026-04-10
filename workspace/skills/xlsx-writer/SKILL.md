---
name: XLSX Writer
description: Generate Excel spreadsheets (.xlsx files) with formatted data, multiple sheets, formula columns, and styled headers. Use when the user wants to export data as a downloadable Excel file — financial models, data exports, reports, trackers, invoices. Uses xlsx (SheetJS) npm package — pure Node. DEPENDENCY CHECK: run node -e "require('xlsx')" from D:\Prometheus. If missing run workspace/doc-skills-setup.js. Triggers on: create spreadsheet, export to Excel, generate xlsx, make an Excel file, export data as Excel, financial model, data export, create tracker, xlsx output.
emoji: "📈"
version: 1.0.0
triggers: create spreadsheet, export excel, generate xlsx, make excel file, export data excel, financial model, data export, create tracker, xlsx output, build spreadsheet, export table, download as excel, write excel
---

# XLSX Writer

Generate Excel spreadsheets using `xlsx` (SheetJS). Pure Node — works on Windows.

## DEPENDENCY CHECK — Run First Time Only

```
node -e "require('xlsx'); console.log('OK')"
```
Run from `D:\Prometheus`. If missing: `node workspace\doc-skills-setup.js`

---

## How It Works

Write a Node script, run it, it outputs a .xlsx file to the workspace. Tell the user where to find it.

---

## Simple Single-Sheet Spreadsheet

The fastest path — array of objects → xlsx:

```javascript
// _tmp_xlsxwrite.js
const XLSX = require('../node_modules/xlsx');

// Your data — array of objects, keys become column headers
const data = [
  { Name: 'Alice Johnson', Role: 'Engineer', Salary: 95000, Department: 'Engineering' },
  { Name: 'Bob Smith',     Role: 'Designer', Salary: 85000, Department: 'Product' },
  { Name: 'Carol White',   Role: 'Manager',  Salary: 110000, Department: 'Operations' }
];

const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Employees');
XLSX.writeFile(wb, 'output.xlsx');
console.log('Created: output.xlsx');
```

---

## Multi-Sheet Workbook

```javascript
// _tmp_xlsxwrite.js
const XLSX = require('../node_modules/xlsx');

const wb = XLSX.utils.book_new();

// Sheet 1: Revenue
const revenue = [
  { Month: 'Jan', Revenue: 42000, Expenses: 28000, Profit: 14000 },
  { Month: 'Feb', Revenue: 58000, Expenses: 31000, Profit: 27000 },
  { Month: 'Mar', Revenue: 51000, Expenses: 29000, Profit: 22000 }
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revenue), 'Revenue');

// Sheet 2: Customers
const customers = [
  { Company: 'Acme Corp', MRR: 4500, Plan: 'Business', Since: '2023-01' },
  { Company: 'TechFlow',  MRR: 2200, Plan: 'Pro',      Since: '2023-06' }
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customers), 'Customers');

XLSX.writeFile(wb, 'business-report.xlsx');
console.log('Created: business-report.xlsx');
```

---

## Styled Headers + Column Widths

SheetJS with styling (requires setting cell styles manually):

```javascript
// _tmp_xlsxwrite.js
const XLSX = require('../node_modules/xlsx');

const headers = ['Product', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'];
const rows = [
  ['Widget A', 1200, 1450, 1380, 1700, null],
  ['Widget B', 800,  950,  1100, 1250, null],
  ['Widget C', 2100, 2300, 2150, 2600, null]
];

// Add formula column for totals (SheetJS supports Excel formula strings)
rows.forEach(row => {
  row[5] = row[1] + row[2] + row[3] + row[4]; // calculated in JS
});

// Build sheet from array-of-arrays (gives more control than json_to_sheet)
const wsData = [headers, ...rows];
const ws = XLSX.utils.aoa_to_sheet(wsData);

// Set column widths
ws['!cols'] = [
  { wch: 16 }, // Product
  { wch: 10 }, // Q1
  { wch: 10 }, // Q2
  { wch: 10 }, // Q3
  { wch: 10 }, // Q4
  { wch: 12 }  // Total
];

// Freeze the header row
ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sales');
XLSX.writeFile(wb, 'sales-report.xlsx');
console.log('Created: sales-report.xlsx');
```

---

## From Extracted Data (Pipeline Pattern)

When you've already extracted data (from a CSV, JSON, API response) and need to export it:

```javascript
// _tmp_xlsxwrite.js
const XLSX = require('../node_modules/xlsx');
const fs = require('fs');

// Load previously extracted/processed data
const rawData = JSON.parse(fs.readFileSync('_tmp_data.json', 'utf-8'));

// Normalize to array of objects if needed
const rows = Array.isArray(rawData) ? rawData : rawData.rows || rawData.data || [];

if (rows.length === 0) {
  console.log('No data to write'); process.exit(0);
}

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Data');
XLSX.writeFile(wb, 'export.xlsx');
console.log(`Created: export.xlsx (${rows.length} rows)`);
```

---

## Summary Sheet Pattern

For reports with a summary sheet + detail sheets:

```javascript
// _tmp_xlsxwrite.js
const XLSX = require('../node_modules/xlsx');

const wb = XLSX.utils.book_new();

// Summary sheet — key metrics in two-column format
const summary = [
  ['Metric', 'Value'],
  ['Total Revenue', '$284,000'],
  ['Total Customers', 47],
  ['Avg MRR', '$6,042'],
  ['Report Date', new Date().toLocaleDateString()]
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

// Detail sheet
const detail = [
  { Customer: 'Acme Corp', MRR: 4500, Status: 'Active' },
  { Customer: 'TechFlow',  MRR: 2200, Status: 'Active' },
  { Customer: 'OldCo',     MRR: 0,    Status: 'Churned' }
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Customers');

XLSX.writeFile(wb, 'monthly-report.xlsx');
console.log('Created: monthly-report.xlsx');
```

---

## Key SheetJS APIs

| Task | Method |
|---|---|
| Array of objects → sheet | `XLSX.utils.json_to_sheet(arrayOfObjects)` |
| Array of arrays → sheet | `XLSX.utils.aoa_to_sheet(arrayOfArrays)` |
| Create workbook | `XLSX.utils.book_new()` |
| Add sheet to workbook | `XLSX.utils.book_append_sheet(wb, ws, 'SheetName')` |
| Write to file | `XLSX.writeFile(wb, 'filename.xlsx')` |
| Set column widths | `ws['!cols'] = [{ wch: 15 }, ...]` |
| Freeze header row | `ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' }` |
| Set row heights | `ws['!rows'] = [{ hpt: 20 }, ...]` |

---

## Output Location

Always write to `D:\Prometheus\workspace\`. Tell the user the exact filename after creation.
