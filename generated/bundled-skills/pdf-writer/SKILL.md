---
name: PDF Writer
description: Create PDF files (.pdf) using `jspdf` in pure Node. Good for reports, invoices, proposals, one-pagers, and simple formatted exports directly from Prometheus.
emoji: "📄"
version: 1.0.0
triggers: create pdf, generate pdf, export pdf, write pdf, make pdf, pdf report, pdf invoice, pdf proposal, one pager, handout, brochure pdf
---

# PDF Writer

Create PDF documents using the `jspdf` npm package. Pure Node, no Python, no browser required.

## Dependency Check

```powershell
node -e "const { jsPDF } = require('jspdf'); console.log(typeof jsPDF === 'function' ? 'OK' : 'MISSING')"
```

Run from `D:\Prometheus`. If it fails:

```powershell
node workspace\doc-skills-setup.js --install jspdf
```

## How It Works

1. Write a temp script to `D:\Prometheus\workspace\_tmp_pdfwrite.js`
2. Run it from `D:\Prometheus\workspace`
3. Save the final file as `workspace\[filename].pdf`
4. Tell the user the exact file path
5. Clean up the temp script

## Minimal Example

```javascript
const { jsPDF } = require('../node_modules/jspdf');

const pdf = new jsPDF({
  orientation: 'portrait',
  unit: 'pt',
  format: 'letter',
});

pdf.setFont('helvetica', 'bold');
pdf.setFontSize(22);
pdf.text('Quarterly Business Summary', 54, 68);

pdf.setFont('helvetica', 'normal');
pdf.setFontSize(11);
pdf.text('Prepared by Prometheus', 54, 92);

const lines = [
  'Revenue grew 18% quarter-over-quarter.',
  'Customer retention remained above 94%.',
  'Pipeline conversion improved after onboarding updates.',
];

let y = 132;
for (const line of lines) {
  pdf.text(`- ${line}`, 54, y);
  y += 22;
}

pdf.save('quarterly-summary.pdf');
console.log('Created: quarterly-summary.pdf');
```

## Multi-page Pattern

Use `pdf.splitTextToSize()` when paragraphs are long, and `pdf.addPage()` when you run out of vertical space.

```javascript
const { jsPDF } = require('../node_modules/jspdf');

const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
const pageWidth = 612;
const pageHeight = 792;
const margin = 54;
const usableWidth = pageWidth - margin * 2;

let y = margin;
function ensureRoom(requiredHeight = 24) {
  if (y + requiredHeight <= pageHeight - margin) return;
  pdf.addPage();
  y = margin;
}

function writeParagraph(text, size = 11) {
  pdf.setFontSize(size);
  const lines = pdf.splitTextToSize(text, usableWidth);
  ensureRoom(lines.length * 16 + 8);
  pdf.text(lines, margin, y);
  y += lines.length * 16 + 8;
}
```

## Default Rule

- Use `jspdf` for text-first PDFs, summaries, reports, invoices, and simple branded handouts.
- If the user wants a Word document first and a PDF second, generate the PDF directly instead of requiring Office or LibreOffice.
- Save outputs into `D:\Prometheus\workspace\` unless the user asked for a different workspace path.
