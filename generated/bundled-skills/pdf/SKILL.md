---
name: "pdf"
description: "Read, extract, OCR, create, and edit PDF documents with the installed PDF toolchain. Use when a task directly involves a PDF file or requires a PDF deliverable; do not use for Word documents, spreadsheets, or generic text output."
---

# PDF documents

Determine whether the PDF is digital text or scanned imagery before choosing an extraction path.

## Read

Use `pdf-parse` for digital PDFs. Inspect a small sample first; if meaningful text is absent, use the available OCR path rather than returning empty output. Preserve page boundaries and cite page numbers when the task depends on location. See [reading.md](references/reading.md) for extraction and OCR patterns.

## Create or edit

Use `jspdf` for straightforward text-first PDFs. For visually complex or source-layout-sensitive work, use the product’s dedicated PDF/rendering surface when available. Keep content inside page bounds, repeat headers intentionally, and use page breaks rather than clipping. See [writing.md](references/writing.md) for generation patterns.

## Verify

Confirm the file exists, has a nonzero size, parses successfully, contains expected text, and has the expected page count. Render pages for visual QA when layout matters. Report the exact output path and any OCR/layout limitation.
