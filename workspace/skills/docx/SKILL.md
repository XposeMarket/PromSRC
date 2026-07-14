---
name: "docx"
description: "Read, extract, create, and edit Microsoft Word DOCX documents with the installed Node document stack. Use when a task directly involves a .docx file or requires an editable Word deliverable; do not use for PDFs, spreadsheets, or generic prose that does not need a Word artifact."
---

# DOCX documents

Use the shortest reliable document path and verify the resulting artifact.

## Read

Use `mammoth` for text-oriented extraction from `.docx`. Preserve headings, lists, links, and tables when the task needs structure. For large files, extract once and analyze the result instead of repeatedly parsing the document. See [reading.md](references/reading.md) for table handling, markdown conversion, and recovery details.

## Create or edit

Use the installed `docx` package for editable Word output. Set page size and margins explicitly, define reusable paragraph/text/table styles, and write to a user-visible workspace path. For an existing document, preserve content and formatting not in scope. See [writing.md](references/writing.md) for components and formatting patterns.

## Verify

Confirm the file exists, has a nonzero size, opens through the parser, and contains expected text. When layout matters, render or open the document for visual QA. Report the exact path and any formatting limitation.

Do not claim legacy `.doc` support. Ask for conversion to `.docx` when necessary.
