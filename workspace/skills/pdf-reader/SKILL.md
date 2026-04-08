---
name: PDF Reader
description: 📌 CANONICAL PDF workflow. Extract text and data from any PDF file. Handles digital PDFs (text-based) using pdf-parse, and scanned/image PDFs using tesseract.js OCR (already installed). Use when a user uploads a PDF and wants to read, summarize, or extract specific content from it. DEPENDENCY CHECK: pdf-parse may need installing — run node -e "require('pdf-parse')" from D:\Prometheus. tesseract.js is already installed. If pdf-parse is missing run workspace/doc-skills-setup.js. Triggers on: read this PDF, summarize PDF, extract from PDF, what does this PDF say, find in PDF, PDF contract, PDF invoice, PDF report, scanned document.
emoji: "📋"
version: 2.0.0
triggers: read PDF, summarize PDF, extract from PDF, what does PDF say, find in PDF, PDF contract, PDF invoice, PDF report, scanned document, read this file, analyze PDF, PDF uploaded, extract text PDF, parse PDF, pdf to text, convert pdf
---

# PDF Reader — Canonical PDF Workflow

Extract text and data from any PDF file using `pdf-parse` (digital PDFs) and `tesseract.js` (scanned/image PDFs). Both are available in Prometheus.

## 📌 Canonical Skill Notice

**This is the primary PDF extraction workflow for Prometheus.** All PDF reading, extraction, parsing, and OCR requests should route here by default. This skill provides:
- **Fast extraction** with minimal dependencies (Node.js native, no Python required)
- **Automatic PDF type detection** (digital text vs. scanned images)
- **Built-in fallback chain**: text extraction → OCR when needed
- **Pre-installed runtime** — tesseract.js is included, pdf-parse installs on first use

**Legacy note:** The deprecated `pdf-extractor` skill previously offered Python-based extraction using pdfplumber and PyMuPDF. For backward compatibility and ease of transition, it now redirects to this skill. If you see `pdf-extractor` mentioned in old docs, use `pdf-reader` instead.


## DEPENDENCY CHECK

**pdf-parse** (digital PDFs):
```
node -e "require('pdf-parse'); console.log('OK')"
```
Run from `D:\Prometheus`. If missing: `node workspace\doc-skills-setup.js`

**tesseract.js** (scanned PDFs): already in `package.json` — always available.

---

## Detecting PDF Type First

Before choosing extraction method, determine if the PDF is digital (text-based) or scanned (image-based):

```javascript
// _tmp_pdfcheck.js
const pdfParse = require('../node_modules/pdf-parse');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const dataBuffer = fs.readFileSync(absPath);
  const data = await pdfParse(dataBuffer, { max: 3 }); // check first 3 pages only
  const hasText = data.text.trim().length > 100;
  console.log(JSON.stringify({
    isDigital: hasText,
    isScanned: !hasText,
    pageCount: data.numpages,
    textPreview: data.text.slice(0, 200)
  }));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Method 1: Digital PDF Extraction (pdf-parse)

Use for text-based PDFs — contracts, reports, exported documents.

```javascript
// _tmp_pdfread.js
const pdfParse = require('../node_modules/pdf-parse');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const dataBuffer = fs.readFileSync(absPath);
  const data = await pdfParse(dataBuffer);

  // Split into pages for structured access
  const pages = data.text.split(/\f/).map((p, i) => ({
    page: i + 1,
    text: p.trim(),
    wordCount: p.split(/\s+/).filter(Boolean).length
  })).filter(p => p.text.length > 0);

  const result = {
    file: path.basename(absPath),
    pageCount: data.numpages,
    totalWords: data.text.split(/\s+/).filter(Boolean).length,
    fullText: data.text.slice(0, 12000),  // first ~12k chars
    pages: pages.slice(0, 20),             // first 20 pages structure
    info: data.info || {}
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Method 2: Scanned PDF / Image OCR (tesseract.js)

Use when pdf-parse returns little or no text (scanned, photographed, or image-only PDFs).

**Strategy:** Use Playwright to render each PDF page as an image, then run tesseract.js OCR on it.

```javascript
// _tmp_pdfocr.js
const { chromium } = require('../node_modules/playwright');
const Tesseract = require('../node_modules/tesseract.js');
const path = require('path');
const fs = require('fs');

const filePath = process.argv[2];
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
const fileUrl = 'file:///' + absPath.replace(/\\/g, '/');
const maxPages = parseInt(process.argv[3] || '5'); // OCR up to N pages

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Load PDF in browser (Chromium has built-in PDF renderer)
  await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  const results = [];

  // Screenshot each page and OCR it
  for (let i = 1; i <= maxPages; i++) {
    const screenshotPath = `_tmp_page${i}.png`;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: i === 1 });
      const { data: { text } } = await Tesseract.recognize(screenshotPath, 'eng', { logger: () => {} });
      results.push({ page: i, text: text.trim() });
      fs.unlinkSync(screenshotPath);
    } catch (e) {
      break; // no more pages
    }
  }

  await browser.close();

  console.log(JSON.stringify({
    method: 'ocr',
    pagesProcessed: results.length,
    results
  }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Searching Within a PDF

When the user wants to find specific content (e.g. "find the termination clause"):

```javascript
// _tmp_pdfread.js
const pdfParse = require('../node_modules/pdf-parse');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const searchTerm = process.argv[3] || '';
const absPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

async function main() {
  const data = await pdfParse(fs.readFileSync(absPath));
  const text = data.text;
  const lines = text.split('\n');
  const results = [];

  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(searchTerm.toLowerCase())) {
      results.push({
        lineNumber: i + 1,
        match: line.trim(),
        context: lines.slice(Math.max(0, i - 1), i + 5).join('\n')
      });
    }
  });

  console.log(JSON.stringify({ searchTerm, matchCount: results.length, results }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Decision: pdf-parse vs OCR

| PDF type | Method | When |
|---|---|---|
| Exported from Word/Excel/software | `pdf-parse` | Text layer present |
| Government/legal scanned docs | `tesseract.js` via Playwright | Text check returns < 100 chars |
| Photographed documents | `tesseract.js` via Playwright | Same |
| Mixed (some pages text, some images) | `pdf-parse` first, OCR for blank pages | Check per page |

Always run the detection script first if you're unsure.

---

## 🎯 Routing & Trigger Precedence

All generic PDF keywords route here first:
- `read pdf`, `extract pdf`, `parse pdf` → **use pdf-reader**
- `pdf to text`, `convert pdf` → **use pdf-reader**
- `ocr pdf`, `scanned pdf` → **use pdf-reader** (tesseract.js handles this)

If a user specifically requests Python-based extraction or table-heavy analysis, pdf-reader can still deliver it via pdf-parse's structural extraction, or you may refer them to install Python tools as optional enhancement. However, the default and recommended path is Node.js (this skill).

Always run the detection script first if you're unsure.

---

## File Path Notes

- User must place the PDF in the workspace or provide an absolute path
- Ask the user for the full file path if it's not in the workspace
- Playwright's `file:///` URL requires forward slashes even on Windows

---

## Error Handling

| Error | Fix |
|---|---|
| `Cannot find module 'pdf-parse'` | Run `node workspace\doc-skills-setup.js` from `D:\Prometheus` |
| `Invalid PDF structure` | File may be corrupted or password-protected |
| `Password required` | pdf-parse cannot handle encrypted PDFs — inform the user |
| `No text extracted` | PDF is likely scanned — switch to OCR method |
| Playwright timeout | PDF file URL incorrect or PDF is very large — try smaller page count |
