---
name: DOCX Reader
description: Read, extract, and analyze Word documents (.docx files). Use whenever a user uploads or references a .docx file and wants to know what's in it — summarize, extract tables, find action items, pull contact info, read contracts, analyze proposals. Uses the mammoth npm package (pure Node, no Python). DEPENDENCY CHECK: before first use, verify mammoth is installed by running: node -e "require('mammoth')" from D:\Prometheus. If it fails, run the setup script at workspace/doc-skills-setup.js. Triggers on: read this doc, summarize this Word file, extract tables, what does this contract say, find action items, analyze this document, .docx uploaded.
emoji: "📄"
version: 1.0.0
triggers: read this doc, summarize word file, extract tables, what does contract say, find action items, analyze document, docx, word document, read document, extract text, document summary, contract review, proposal review
---

# DOCX Reader

Extract and analyze Word documents using the `mammoth` npm package. Runs entirely in Node.js — no Python, no LibreOffice needed.

## DEPENDENCY CHECK — Run First Time Only

Before using this skill, verify mammoth is installed:
```
node -e "require('mammoth'); console.log('OK')"
```
Run from `D:\Prometheus`. If it fails: `node workspace\doc-skills-setup.js`

---

## How It Works

Write a small Node script to the workspace, run it with `shell()`, read the output. The script never needs to persist — write it, run it, delete it.

**The pattern for every document task:**
1. Write a `_tmp_docread.js` script into `workspace/`
2. Run it with `shell({ command: "node _tmp_docread.js", cwd: "D:\\Prometheus\\workspace" })`
3. Read the output
4. Delete the temp script

---

## Core Extraction Script

This extracts full text + basic structure from any .docx:

```javascript
// _tmp_docread.js
const mammoth = require('../node_modules/mammoth');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || 'document.docx';
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  // Extract as plain text
  const textResult = await mammoth.extractRawText({ path: absPath });
  const text = textResult.value;

  // Extract as HTML (preserves structure — headings, tables, lists)
  const htmlResult = await mammoth.convertToHtml({ path: absPath });
  const html = htmlResult.value;

  // Basic structure analysis
  const lines = text.split('\n').filter(l => l.trim());
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).length;

  // Detect headings from HTML
  const headings = [];
  const hMatches = html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi);
  for (const m of hMatches) {
    headings.push({ level: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() });
  }

  // Detect tables
  const tableCount = (html.match(/<table/gi) || []).length;

  // Output structured result
  const result = {
    file: path.basename(absPath),
    wordCount,
    paragraphs,
    headings,
    tableCount,
    text: text.slice(0, 8000), // first 8000 chars for context
    warnings: textResult.messages.filter(m => m.type === 'warning').map(m => m.message)
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

**Run it:**
```
node _tmp_docread.js "D:\path\to\document.docx"
```

---

## Table Extraction Script

When the user wants tables pulled out specifically:

```javascript
// _tmp_docread.js
const mammoth = require('../node_modules/mammoth');
const path = require('path');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const { value: html } = await mammoth.convertToHtml({ path: absPath });

  // Extract all tables as arrays
  const tables = [];
  const tableMatches = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const rows = [];
    const rowMatches = tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const row of rowMatches) {
      const cells = [];
      const cellMatches = row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      for (const cell of cellMatches) {
        cells.push(cell[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }

  console.log(JSON.stringify({ tableCount: tables.length, tables }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Section / Heading-Based Extraction

When the user wants a specific section (e.g. "find the payment terms"):

```javascript
// _tmp_docread.js
const mammoth = require('../node_modules/mammoth');
const path = require('path');

const filePath = process.argv[2];
const searchTerm = process.argv[3] || '';
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const { value: text } = await mammoth.extractRawText({ path: absPath });
  const lines = text.split('\n');

  // Find lines containing the search term and surrounding context
  const results = [];
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(searchTerm.toLowerCase())) {
      const context = lines.slice(Math.max(0, i-1), i+6).join('\n');
      results.push({ lineNumber: i+1, match: line.trim(), context });
    }
  });

  console.log(JSON.stringify({ searchTerm, matchCount: results.length, results }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Finding Document Paths

When a user uploads a file, it typically lands in one of these locations. Check in order:
1. `D:\Prometheus\workspace\` (if they explicitly placed it there)
2. Ask the user where the file is — they may need to move it to the workspace folder, or provide the full path

**Always use absolute paths in the script** to avoid confusion with cwd.

---

## Output Interpretation

After running, parse the JSON output and present to the user as:

- **Summary**: word count, heading structure, table count
- **Key content**: surface headings as section outline
- **Extracted tables**: render as markdown tables in chat
- **Full text**: use for answering specific questions about the document

---

## What to Do With Extracted Content

After extraction, you can:
- Answer specific questions about the document content
- Feed key facts into `BUSINESS.md` or entity files (use `doc-ingestion` skill for this)
- Summarize sections on request
- Find specific clauses, names, dates, or numbers
- Compare multiple documents by running extraction on each

---

## Error Handling

| Error | Fix |
|---|---|
| `Cannot find module 'mammoth'` | Run `node workspace\doc-skills-setup.js` from `D:\Prometheus` |
| `ENOENT: no such file` | File path is wrong — confirm location with user |
| `InvalidZip` | File is not a valid .docx (may be .doc — legacy format not supported by mammoth directly) |
| `.doc file` | mammoth only supports .docx. Ask user to save as .docx from Word first |
