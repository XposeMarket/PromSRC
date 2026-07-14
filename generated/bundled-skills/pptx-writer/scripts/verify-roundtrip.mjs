import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import PptxGenJS from 'pptxgenjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

const outputDir = path.resolve(
  option('--output-dir') || fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-pptx-writer-')),
);
fs.mkdirSync(outputDir, { recursive: true });

const soffice = firstExisting([
  process.env.PPTX_RENDERER,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Prometheus', 'tools', 'LibreOffice', 'program', 'soffice.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
]);

if (!soffice) {
  throw new Error('No LibreOffice renderer found. Run test-backends.ps1 for the supported backend paths.');
}

const pptxPath = path.join(outputDir, 'pptx-writer-verification.pptx');
const pdfPath = path.join(outputDir, 'pptx-writer-verification.pdf');
const profileDir = path.join(outputDir, 'libreoffice-profile');
fs.mkdirSync(profileDir, { recursive: true });

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Prometheus PPTX Writer verification';
pptx.subject = 'Editable PPTX generation and rendering round trip';
pptx.title = 'PPTX Writer verification';
pptx.company = 'Prometheus';
pptx.lang = 'en-US';
pptx.theme = {
  headFontFace: 'Aptos Display',
  bodyFontFace: 'Aptos',
  lang: 'en-US',
};

const ink = '1F2522';
const paper = 'F4F0E7';
const ember = 'E76F3C';

const cover = pptx.addSlide();
cover.background = { color: paper };
cover.addText('PPTX Writer', {
  x: 0.75, y: 1.0, w: 8.2, h: 0.8,
  fontFace: 'Aptos Display', fontSize: 52, bold: true, color: ink,
  margin: 0, breakLine: false,
});
cover.addText('Editable generation · deterministic render · visual QA', {
  x: 0.78, y: 2.0, w: 8.7, h: 0.45,
  fontFace: 'Aptos', fontSize: 20, color: '505853', margin: 0,
});
cover.addShape(pptx.ShapeType.rect, {
  x: 0.78, y: 3.05, w: 2.15, h: 0.12,
  line: { color: ember, transparency: 100 }, fill: { color: ember },
});
cover.addText('ROUND TRIP VERIFIED', {
  x: 0.78, y: 3.38, w: 4.4, h: 0.42,
  fontFace: 'Aptos', fontSize: 16, bold: true, color: ember, margin: 0,
});

const detail = pptx.addSlide();
detail.background = { color: ink };
detail.addText('What this proves', {
  x: 0.75, y: 0.72, w: 7.6, h: 0.6,
  fontFace: 'Aptos Display', fontSize: 36, bold: true, color: paper, margin: 0,
});
detail.addText([
  { text: '01  ', options: { bold: true, color: ember } },
  { text: 'PptxGenJS produced editable text and shapes.' },
], {
  x: 0.8, y: 1.75, w: 10.6, h: 0.52,
  fontFace: 'Aptos', fontSize: 20, color: paper, margin: 0,
});
detail.addText([
  { text: '02  ', options: { bold: true, color: ember } },
  { text: 'LibreOffice opened and rendered the generated file.' },
], {
  x: 0.8, y: 2.65, w: 10.6, h: 0.52,
  fontFace: 'Aptos', fontSize: 20, color: paper, margin: 0,
});
detail.addText([
  { text: '03  ', options: { bold: true, color: ember } },
  { text: 'Every rendered page can be inspected before delivery.' },
], {
  x: 0.8, y: 3.55, w: 10.6, h: 0.52,
  fontFace: 'Aptos', fontSize: 20, color: paper, margin: 0,
});

await pptx.writeFile({ fileName: pptxPath });

const render = spawnSync(soffice, [
  '--headless',
  `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
  '--convert-to', 'pdf',
  '--outdir', outputDir,
  pptxPath,
], { encoding: 'utf8', windowsHide: true });

if (render.status !== 0 || !fs.existsSync(pdfPath)) {
  throw new Error(`LibreOffice render failed (${render.status}): ${render.stderr || render.stdout || 'no output'}`);
}

const result = {
  generator: 'pptxgenjs',
  renderer: soffice,
  pptxPath,
  pptxBytes: fs.statSync(pptxPath).size,
  pdfPath,
  pdfBytes: fs.statSync(pdfPath).size,
  slideCount: 2,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
