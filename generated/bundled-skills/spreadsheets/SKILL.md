---
name: "spreadsheets"
description: "Read, analyze, create, and edit XLSX, XLS, and CSV spreadsheet artifacts with SheetJS. Use when the task directly involves workbook sheets, tabular spreadsheet data, formulas, or an Excel-compatible deliverable; do not use for database queries or prose reports without a workbook."
---

# Spreadsheets

Use `xlsx`/SheetJS for workbook operations and avoid dumping entire large sheets into context.

## Read and analyze

Inspect sheet names, dimensions, headers, formulas, and representative rows first. Select only the sheets and ranges relevant to the request. Preserve the distinction between displayed values, raw values, and formulas. See [reading.md](references/reading.md) for previews, filtering, aggregates, and large-sheet handling.

## Create or edit

Build workbooks from structured data, use clear sheet names and headers, set useful widths/formats, and preserve unrelated sheets and formulas when modifying an existing file. Write live formulas, not Python-computed constants, when outputs should update with inputs. For financial models, separate assumptions from calculations, label units and periods, use consistent currency/percent/date formats and input-cell coloring, and document sign conventions and sources of assumptions. Match existing colors and number formats when editing; libraries may drop external-link cached values, so disclose that risk and verify links in the target application. Use CSV only when a single flat table is sufficient. See [writing.md](references/writing.md) for multi-sheet and formatting patterns.

## Verify

Before filling a formula grid, hand-calculate expected values for 2 or 3 representative formulas and compare with workbook results, including boundary rows. After writing formulas, recalculate using a real calculation engine (LibreOffice headless if available, Excel COM on Windows, or another verified engine). Reloading with openpyxl `data_only=True` inspects cached values but does not recalculate formulas; missing caches are not evidence of success. Reopen the final saved workbook, confirm sheets, rows, live formulas, and types, then scan every populated cell for `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NUM!`, and `#NULL!`. Resolve all errors before shipping; disclose unsupported features and never claim clean recalculation when the engine cannot handle them. For a human-read workbook, render to PDF and inspect `####` columns, clipped headers, and frozen panes. Report the exact output path and any limitations.
