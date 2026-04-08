---
name: DOCX Writer
description: Create professional Word documents (.docx files) — reports, proposals, contracts, memos, SOPs, templates. Uses the docx npm package (pure Node). Produces properly formatted documents with headings, tables, lists, headers/footers, and page numbers. DEPENDENCY CHECK: before first use verify docx is installed: node -e "require('docx')" from D:\Prometheus. If it fails run workspace/doc-skills-setup.js. Triggers on: create word doc, write a proposal, generate .docx, make a report, write a contract, SOP document, memo, letter, create a template, export as word.
emoji: "📝"
version: 1.0.0
triggers: create word doc, write proposal, generate docx, make report, write contract, SOP, memo, letter, create template, export word, word document, professional document, business document, formatted document, report with tables
---

# DOCX Writer

Create professional Word documents using the `docx` npm package. Pure Node — no Python, no LibreOffice.

## DEPENDENCY CHECK — Run First Time Only

```
node -e "require('docx'); console.log('OK')"
```
Run from `D:\Prometheus`. If it fails: `node workspace\doc-skills-setup.js`

---

## How It Works

Write a Node script to the workspace, run it, the script outputs a .docx file to the workspace. The pattern is always the same:

1. Write `_tmp_docwrite.js` to `workspace/`
2. Run: `shell({ command: "node _tmp_docwrite.js", cwd: "D:\\Prometheus\\workspace" })`
3. Tell user the file is at `workspace/[filename].docx`
4. Clean up the temp script

---

## Core Setup — Always Include These Imports

```javascript
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
  LevelFormat, TabStopType, TabStopPosition
} = require('../node_modules/docx');
const fs = require('fs');
```

---

## Page Setup — Always Explicit

```javascript
// US Letter, 1-inch margins — always set this, docx defaults to A4
const pageProps = {
  page: {
    size: { width: 12240, height: 15840 },  // 8.5 x 11 inches in DXA
    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }  // 1 inch = 1440 DXA
  }
};
```

---

## Style Setup — Always Define These

```javascript
const styles = {
  default: {
    document: { run: { font: 'Arial', size: 24 } }  // 12pt default
  },
  paragraphStyles: [
    {
      id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 36, bold: true, font: 'Arial', color: '1a1a2e' },
      paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 }
    },
    {
      id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 28, bold: true, font: 'Arial', color: '16213e' },
      paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 }
    },
    {
      id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 24, bold: true, font: 'Arial', color: '0f3460' },
      paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 }
    }
  ]
};
```

---

## Paragraph Patterns

```javascript
// Heading
new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Section Title')] })
new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Subsection')] })

// Body paragraph
new Paragraph({
  children: [new TextRun({ text: 'Body text here.', size: 24, font: 'Arial' })],
  spacing: { after: 120 }
})

// Bold + regular inline
new Paragraph({
  children: [
    new TextRun({ text: 'Key term: ', bold: true, size: 24, font: 'Arial' }),
    new TextRun({ text: 'explanation text.', size: 24, font: 'Arial' })
  ]
})

// Divider line (use paragraph border — NEVER use a table as a divider)
new Paragraph({
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '3366cc', space: 1 } },
  spacing: { after: 120 }
})

// Page break
new Paragraph({ children: [new PageBreak()] })
```

---

## Lists — NEVER Use Unicode Bullets

```javascript
// Define numbering config on the Document — required for lists
const numbering = {
  config: [
    {
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
    {
      reference: 'numbers',
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    }
  ]
};

// Then use in paragraphs:
new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text: 'Bullet item text', size: 24, font: 'Arial' })]
})
new Paragraph({
  numbering: { reference: 'numbers', level: 0 },
  children: [new TextRun({ text: 'Numbered item', size: 24, font: 'Arial' })]
})
```

---

## Tables

```javascript
// Critical: always set BOTH columnWidths on table AND width on each cell
// Content width for US Letter with 1" margins = 9360 DXA
const border = { style: BorderStyle.SINGLE, size: 4, color: 'cccccc' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [3120, 3120, 3120],  // must sum to 9360
  rows: [
    // Header row
    new TableRow({
      tableHeader: true,
      children: ['Column A', 'Column B', 'Column C'].map(text =>
        new TableCell({
          borders: cellBorders,
          width: { size: 3120, type: WidthType.DXA },
          shading: { fill: 'dce6f1', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 22, font: 'Arial' })] })]
        })
      )
    }),
    // Data row
    new TableRow({
      children: ['Value 1', 'Value 2', 'Value 3'].map(text =>
        new TableCell({
          borders: cellBorders,
          width: { size: 3120, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text, size: 22, font: 'Arial' })] })]
        })
      )
    })
  ]
})
```

---

## Header and Footer

```javascript
const header = new Header({
  children: [
    new Paragraph({
      children: [
        new TextRun({ text: 'Document Title', bold: true, size: 20, font: 'Arial', color: '555555' })
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'cccccc', space: 1 } }
    })
  ]
});

const footer = new Footer({
  children: [
    new Paragraph({
      children: [
        new TextRun({ text: 'Page ', size: 18, font: 'Arial', color: '888888' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, font: 'Arial', color: '888888' }),
        new TextRun({ text: ' of ', size: 18, font: 'Arial', color: '888888' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: 'Arial', color: '888888' })
      ],
      alignment: AlignmentType.CENTER
    })
  ]
});
```

---

## Full Document Template

```javascript
// _tmp_docwrite.js
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, LevelFormat
} = require('../node_modules/docx');
const fs = require('fs');

const doc = new Document({
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } }
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'Report Title', bold: true, size: 20, font: 'Arial', color: '555555' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 18, font: 'Arial' }), new TextRun({ children: [PageNumber.CURRENT], size: 18, font: 'Arial' })] })] }) },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Document Title')] }),
      new Paragraph({ children: [new TextRun({ text: 'Introduction paragraph text goes here.', size: 24, font: 'Arial' })], spacing: { after: 160 } }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Section 2')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'First bullet point', size: 24, font: 'Arial' })] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'Second bullet point', size: 24, font: 'Arial' })] }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = 'output.docx';
  fs.writeFileSync(outPath, buffer);
  console.log('Created:', outPath);
}).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
```

---

## Critical Rules

- **Never use `\n` in TextRun** — use separate Paragraph elements
- **Never use unicode bullets** (`•`, `\u2022`) — use `LevelFormat.BULLET` with numbering config
- **Always set table width with DXA** — never use WidthType.PERCENTAGE (breaks in Google Docs)
- **Tables need dual widths** — `columnWidths` array on the table AND `width` on every cell
- **columnWidths must sum exactly** to the table width
- **Always set `ShadingType.CLEAR`** — never SOLID for cell shading (causes black background)
- **Never use a table as a horizontal rule/divider** — use paragraph border instead
- **PageBreak must be inside a Paragraph** — standalone PageBreak creates invalid XML

---

## Output Location

Save files to `D:\Prometheus\workspace\` so the user can access them. Tell the user the exact path.
