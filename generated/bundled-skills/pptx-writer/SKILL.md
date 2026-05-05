---
name: PPTX Writer
description: Create PowerPoint slide decks (.pptx) using `pptxgenjs` from Prometheus. Best for presentations, investor decks, status decks, proposals, and client-ready slides.
emoji: "📊"
version: 1.0.0
triggers: create powerpoint, create power point, create pptx, generate pptx, export powerpoint, export pptx, make slides, make slide deck, investor deck, status deck, presentation deck, powerpoint slides
---

# PPTX Writer

Create `.pptx` slide decks using `pptxgenjs`.

## Dependency Check

```powershell
node -e "require('pptxgenjs'); console.log('OK')"
```

Run from `D:\Prometheus`. If it fails:

```powershell
node workspace\doc-skills-setup.js --install pptxgenjs
```

## How It Works

1. Write a temp script to `D:\Prometheus\workspace\_tmp_pptxwrite.js`
2. Run it from `D:\Prometheus\workspace`
3. Save the final file as `workspace\[filename].pptx`
4. Tell the user the exact file path
5. Clean up the temp script

## Minimal Example

```javascript
const PptxGenJS = require('../node_modules/pptxgenjs');

async function main() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Prometheus';
  pptx.company = 'Prometheus';
  pptx.subject = 'Generated presentation';
  pptx.title = 'Business Update';
  pptx.lang = 'en-US';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };

  const cover = pptx.addSlide();
  cover.background = { color: 'F6F8FC' };
  cover.addText('Business Update', {
    x: 0.6, y: 0.8, w: 11.2, h: 0.7,
    fontFace: 'Aptos Display', fontSize: 24, bold: true, color: '152033',
  });
  cover.addText('Prepared by Prometheus', {
    x: 0.6, y: 1.6, w: 6, h: 0.3,
    fontFace: 'Aptos', fontSize: 11, color: '516079',
  });

  const agenda = pptx.addSlide();
  agenda.addText('Key Takeaways', {
    x: 0.6, y: 0.5, w: 6, h: 0.5,
    fontFace: 'Aptos Display', fontSize: 20, bold: true, color: '152033',
  });
  [
    'Revenue increased 18% quarter-over-quarter',
    'Retention held above 94%',
    'Pipeline quality improved after onboarding changes',
  ].forEach((text, index) => {
    agenda.addText(text, {
      x: 1.0, y: 1.4 + index * 0.6, w: 10.4, h: 0.3,
      fontFace: 'Aptos', fontSize: 16, color: '24324A',
      bullet: { indent: 14 },
    });
  });

  await pptx.writeFile({ fileName: 'business-update.pptx' });
  console.log('Created: business-update.pptx');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## Default Rule

- Use `pptxgenjs` for actual editable slide decks, not HTML screenshots.
- Prefer 16:9 (`LAYOUT_WIDE`) unless the user explicitly wants another aspect ratio.
- Keep each slide to one core message, and generate speaker notes separately in markdown if needed.
