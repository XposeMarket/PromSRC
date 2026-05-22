---
name: docx-reader
description: Read, extract, and summarize `.docx` Word documents using Node.js and the `mammoth` package. Use this when the user uploads a Word file and wants it read, summarized, outlined, searched, cleaned into markdown, or converted into usable text/table output. Triggers on requests like: read this docx, summarize this Word document, extract the text from this .docx, what does this document say, pull tables from this Word file, search this uploaded document, or turn this docx into markdown. Best for direct document-reading tasks where Prometheus should take the shortest reliable path instead of doing multi-step guesswork.
emoji: "🧩"
version: 2.0.0
triggers: read this docx, read this word document, summarize this docx, summarize this word file, extract this docx, extract text from this word document, what does this document say, pull tables from this docx, search this docx, convert this docx to markdown, analyze this uploaded word file
---

# DOCX Reader

Fast, direct Word-document reading for Prometheus.

**Default rule:** for normal `.docx` reading, use **one temp script, one `run_command`, one result parse, one cleanup**. Do not overcomplicate it.

---

## When to Use This

Use this skill when the user provides a `.docx` file and wants any of the following:
- a summary
- a section outline
- key points
- text extraction
- table extraction
- keyword search
- markdown conversion / cleanup

**Do not use this** for:
- PDFs → use `pdf-reader`
- spreadsheets → use `xlsx-reader`
- legacy `.doc` files → ask the user to resave as `.docx`

---

## The Fast Path — Default Workflow

For almost all requests, do exactly this:

1. Use the uploaded file path exactly as given by the user.
2. Write a single temp script in `workspace/_tmp_docread.js`.
3. Run it once with `run_command`.
4. Parse the JSON result.
5. Answer the user directly.
6. Delete the temp script.

**Do not** do extra dependency checks, extra file hunting, or multiple experimental scripts unless the first run fails.

---

## Default Temp Script

Use this as the standard script for nearly every `.docx` request:

```javascript
const mammoth = require('../node_modules/mammoth');
const path = require('path');

const filePath = process.argv[2];
if (!filePath) {
  console.error('ERROR: Missing .docx path');
  process.exit(1);
}

const absPath = path.isAbsolute(filePath)
  ? filePath
  : path.join(__dirname, filePath);

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const textResult = await mammoth.extractRawText({ path: absPath });
  const htmlResult = await mammoth.convertToHtml({ path: absPath });

  const text = (textResult.value || '').replace(/\r/g, '');
  const html = htmlResult.value || '';

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const headings = [];
  for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    headings.push({
      level: Number(match[1]),
      text: stripHtml(match[2]),
    });
  }

  const tables = [];
  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cells.push(stripHtml(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const result = {
    file: path.basename(absPath),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    paragraphCount: paragraphs.length,
    lineCount: lines.length,
    headingCount: headings.length,
    headings,
    tableCount: tables.length,
    tables,
    preview: text.slice(0, 12000),
    warnings: (textResult.messages || []).map((m) => m.message || String(m)),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e && e.message ? e.message : String(e));
  process.exit(1);
});
```

Run it with the exact uploaded path, for example:

```powershell
node workspace\_tmp_docread.js "D:\Prometheus\workspace\uploads\example.docx"
```

---

## Direct Response Format

After extraction, answer in this structure unless the user asked for something else:

- **File**
- **Quick stats**: words, paragraphs, tables, headings
- **What it is**: 1-3 sentence plain-English description
- **Main sections**: if headings exist, list them; if not, infer structure from repeated patterns
- **Key takeaways**: concise bullets

If the user asked something narrow like **"read this"**, give the useful summary directly. Do not dump raw JSON unless they explicitly want it.

---

## Common Follow-Up Modes

### 1) Full summary
Use the default script, then summarize the `preview`, headings, and tables.

### 2) Section outline
Prefer `headings` if present. If no headings exist, infer sections from repeated labels, numbering, or grouped phrases in the extracted text.

### 3) Pull all tables
Use the `tables` array from the default script. No second script is needed unless parsing failed.

### 4) Search for a term
If the user asks for a keyword/section search, use this focused script:

```javascript
const mammoth = require('../node_modules/mammoth');
const path = require('path');

const filePath = process.argv[2];
const searchTerm = (process.argv[3] || '').toLowerCase();
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const { value } = await mammoth.extractRawText({ path: absPath });
  const lines = value.replace(/\r/g, '').split('\n');
  const results = [];

  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(searchTerm)) {
      results.push({
        lineNumber: i + 1,
        match: line.trim(),
        context: lines.slice(Math.max(0, i - 2), i + 4).join('\n').trim(),
      });
    }
  });

  console.log(JSON.stringify({ searchTerm, matchCount: results.length, results }, null, 2));
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
```

### 5) Convert to markdown-ish cleaned text
Use the default script output and rewrite the content cleanly in chat or into a file if asked. Do not build a separate conversion pipeline unless the user specifically wants a saved `.md` file.

---

## Uploaded File Path Rules

When the user gives an upload path, trust it.

Example:
- `D:\Prometheus\workspace\uploads\my-file.docx`

**Do not** waste time re-discovering the file if the exact path is already in chat.

Only search for the file if the user did **not** provide a usable path.

---

## Failure Recovery — Only If the Fast Path Fails

If the default script fails, use this order:

1. Check whether `mammoth` is available.
2. Confirm the file path exists and ends in `.docx`.
3. Check whether the file is actually a valid DOCX/ZIP container.
4. Only then try a narrower fallback script.

### Dependency check script

```javascript
try {
  require('../node_modules/mammoth');
  console.log('OK');
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
```

Run:

```powershell
node workspace\_tmp_docx_check.js
```

If that fails, run:

```powershell
node workspace\doc-skills-setup.js
```

---

## Error Handling

| Error | Meaning | Fix |
|---|---|---|
| `Cannot find module 'mammoth'` | Dependency missing | Run `node workspace\doc-skills-setup.js` |
| `ENOENT` | Wrong file path | Use the exact uploaded path from chat |
| `InvalidZip` | File is not a valid `.docx` | Ask user to re-upload/export as proper `.docx` |
| missing path | Script called without file argument | Re-run with the exact path |
| `.doc` file | Old Word format | Ask user to save/export as `.docx` |

---

## Anti-Patterns

Do **not**:
- do multiple temp-script experiments before trying the default script
- perform dependency checks first on every run
- re-search the workspace when the upload path is already provided
- dump raw extraction JSON to the user unless requested
- claim the doc has no structure just because formal headings are absent

---

## Success Standard

A successful run should feel simple:
- Prometheus reads the `.docx` in one pass
- gives a clean summary quickly
- surfaces section structure when possible
- extracts tables when helpful
- only falls back to extra steps if something actually breaks
