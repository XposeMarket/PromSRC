---
name: "spreadsheets"
description: "Read, analyze, create, and edit XLSX, XLS, and CSV spreadsheet artifacts with SheetJS. Use when the task directly involves workbook sheets, tabular spreadsheet data, formulas, or an Excel-compatible deliverable; do not use for database queries or prose reports without a workbook."
---

# Spreadsheets

Use `xlsx`/SheetJS for workbook operations and avoid dumping entire large sheets into context.

## Read and analyze

Inspect sheet names, dimensions, headers, formulas, and representative rows first. Select only the sheets and ranges relevant to the request. Preserve the distinction between displayed values, raw values, and formulas. See [reading.md](references/reading.md) for previews, filtering, aggregates, and large-sheet handling.

## Create or edit

Build workbooks from structured data, use clear sheet names and headers, set useful widths/formats, and preserve unrelated sheets and formulas when modifying an existing file. Use CSV only when a single flat table is sufficient. See [writing.md](references/writing.md) for multi-sheet and formatting patterns.

## Verify

Reopen the saved workbook, confirm expected sheets/rows/formulas, and check that values retain the intended types. Report the exact output path plus any unsupported Excel feature or formatting limitation.
