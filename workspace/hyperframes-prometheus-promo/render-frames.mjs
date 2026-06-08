import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const framesDir = path.join(__dirname, 'frames');
await fs.rm(framesDir, { recursive: true, force: true });
await fs.mkdir(framesDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => { window.__PROMETHEUS_RENDERING__ = true; });
const fps = 30;
const duration = 45;
const total = duration * fps;
for (let i = 0; i < total; i++) {
  const t = i / fps;
  await page.evaluate((seconds) => window.__hf.seek(seconds), t);
  await page.screenshot({ path: path.join(framesDir, `frame-${String(i + 1).padStart(4, '0')}.png`), type: 'png' });
  if ((i + 1) % 150 === 0) console.log(`rendered ${i + 1}/${total}`);
}
await browser.close();
console.log(`rendered ${total} frames to ${framesDir}`);
