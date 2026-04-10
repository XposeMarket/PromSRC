---
name: XLSX Reader
description: Read, analyze, and query Excel spreadsheets (.xlsx, .xls, .csv files). Extract data from sheets, summarize contents, calculate totals, find specific rows, and answer questions about spreadsheet data. Uses the xlsx (SheetJS) npm package — pure Node, no Python. DEPENDENCY CHECK: run node -e "require('xlsx')" from D:\Prometheus. If missing run workspace/doc-skills-setup.js. Triggers on: read this spreadsheet, analyze Excel file, what's in this xlsx, summarize the data, find rows where, calculate total, extract columns, csv file, spreadsheet uploaded.
emoji: "📊"
version: 1.0.0
triggers: read spreadsheet, analyze excel, xlsx file, xls file, csv file, what is in spreadsheet, summarize data, find rows, calculate total, extract columns, spreadsheet uploaded, financial spreadsheet, data file, tabular data
---

# XLSX Reader

Read and analyze Excel spreadsheets using the `xlsx` (SheetJS) npm package. Pure Node — works on Windows with no Python.

## DEPENDENCY CHECK — Run First Time Only

```
node -e "require('xlsx'); console.log('OK')"
```
Run from `D:\Prometheus`. If missing: `node workspace\doc-skills-setup.js`

---

## How It Works

Write a Node script to workspace, run with `shell()`, parse the JSON output. Same pattern as all document skills.

---

## Core Sheet Extraction

Gets all sheets and their data as JSON arrays:

```javascript
// _tmp_xlsxread.js
const XLSX = require('../node_modules/xlsx');
const path = require('path');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

const workbook = XLSX.readFile(absPath);
const result = {
  file: path.basename(absPath),
  sheetNames: workbook.SheetNames,
  sheets: {}
};

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Headers are first row, data is the rest
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));

  result.sheets[sheetName] = {
    rowCount: dataRows.length,
    colCount: headers.length,
    headers,
    preview: dataRows.slice(0, 10),    // first 10 rows as preview
    totalRows: dataRows.length
  };
}

console.log(JSON.stringify(result, null, 2));
```

---

## Targeted Sheet Reading (by name)

When the user wants data from a specific sheet:

```javascript
// _tmp_xlsxread.js
const XLSX = require('../node_modules/xlsx');
const path = require('path');

const filePath = process.argv[2];
const sheetName = process.argv[3]; // e.g. "Revenue" or "Sheet1"
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

const workbook = XLSX.readFile(absPath);
const targetSheet = sheetName || workbook.SheetNames[0];
const sheet = workbook.Sheets[targetSheet];

if (!sheet) {
  console.log(JSON.stringify({ error: `Sheet "${targetSheet}" not found`, available: workbook.SheetNames }));
  process.exit(1);
}

// As objects (uses first row as keys) — best for structured data
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

console.log(JSON.stringify({
  sheet: targetSheet,
  rowCount: rows.length,
  columns: Object.keys(rows[0] || {}),
  data: rows.slice(0, 50)  // first 50 rows
}, null, 2));
```

---

## Aggregation / Summary Script

When the user wants totals, averages, or summaries:

```javascript
// _tmp_xlsxread.js
const XLSX = require('../node_modules/xlsx');
const path = require('path');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

const workbook = XLSX.readFile(absPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

if (rows.length === 0) { console.log('{}'); process.exit(0); }

const columns = Object.keys(rows[0]);
const summary = {};

for (const col of columns) {
  const values = rows.map(r => r[col]).filter(v => v !== null && v !== '');
  const numbers = values.map(v => parseFloat(v)).filter(n => !isNaN(n));

  summary[col] = {
    count: values.length,
    nullCount: rows.length - values.length,
    sampleValues: values.slice(0, 3)
  };

  if (numbers.length > 0) {
    const sum = numbers.reduce((a, b) => a + b, 0);
    summary[col].isNumeric = true;
    summary[col].sum = Math.round(sum * 100) / 100;
    summary[col].avg = Math.round((sum / numbers.length) * 100) / 100;
    summary[col].min = Math.min(...numbers);
    summary[col].max = Math.max(...numbers);
  }
}

console.log(JSON.stringify({ rowCount: rows.length, columns, summary }, null, 2));
```

---

## Row Filter / Search

When the user wants rows matching a condition:

```javascript
// _tmp_xlsxread.js
const XLSX = require('../node_modules/xlsx');
const path = require('path');

const filePath = process.argv[2];
const filterCol = process.argv[3];    // column name to filter on
const filterVal = process.argv[4];    // value to match (partial, case-insensitive)
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

const workbook = XLSX.readFile(absPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

const matches = rows.filter(row => {
  const cellVal = String(row[filterCol] || '').toLowerCase();
  return cellVal.includes(filterVal.toLowerCase());
});

console.log(JSON.stringify({
  filterColumn: filterCol,
  filterValue: filterVal,
  matchCount: matches.length,
  matches: matches.slice(0, 50)
}, null, 2));
```

---

## CSV Files

SheetJS handles CSV too — same API, just reads differently:

```javascript
// _tmp_xlsxread.js
const XLSX = require('../node_modules/xlsx');
const path = require('path');
const fs = require('fs');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

// CSV-specific read
const workbook = XLSX.read(fs.readFileSync(absPath, 'utf-8'), { type: 'string' });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

console.log(JSON.stringify({
  rowCount: rows.length,
  columns: Object.keys(rows[0] || {}),
  preview: rows.slice(0, 20)
}, null, 2));
```

---

## Presenting Results to the User

After extraction, format the data clearly in chat:

- **Sheet overview**: list sheet names, row counts, column headers
- **Data preview**: render as markdown table (max 10–15 rows visible)
- **Aggregates**: present as KPI-style summary (sum, avg, min, max per numeric column)
- **Filtered results**: show matching rows as markdown table
- **Large datasets**: summarize and offer to drill down — don't dump 1000 rows

---

## Error Handling

| Error | Fix |
|---|---|
| `Cannot find module 'xlsx'` | Run `node workspace\doc-skills-setup.js` from `D:\Prometheus` |
| `ENOENT` | Wrong file path — confirm with user |
| `CFB: Corrupted file` | File may be corrupted or in wrong format |
| `.xls` (old format) | SheetJS handles .xls too — same code works |
| Empty sheet | Filter out empty rows with `.filter(r => r.some(c => c !== ''))` |
