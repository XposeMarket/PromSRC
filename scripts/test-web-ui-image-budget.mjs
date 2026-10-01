// Guards against shipping oversized raster images that the UI loads on boot.
// The brand ring is rendered at <= 72 CSS px (themes.css, mobile.css,
// projects.css), but shipped as a 1254x1254 / 661 KB PNG that both the desktop
// and mobile shells downloaded on every cold load (twice: /src and /static).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOT_IMAGES = [
  { file: 'web-ui/src/assets/prometheus-one/p1-mark-ring.png', maxBytes: 64 * 1024, maxEdge: 384 },
];

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let failed = 0;
for (const img of BOOT_IMAGES) {
  for (const base of ['', 'generated/public-web-ui/static/'.replace(/static\/$/, '')]) {
    const rel = base ? img.file.replace(/^web-ui\/src\//, 'generated/public-web-ui/static/') : img.file;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const buf = fs.readFileSync(abs);
    const { width, height } = pngSize(buf);
    const ok = buf.length <= img.maxBytes && Math.max(width, height) <= img.maxEdge;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${rel} ${width}x${height} ${Math.round(buf.length / 1024)}KB (max ${Math.round(img.maxBytes / 1024)}KB, ${img.maxEdge}px)`);
    if (!ok) failed += 1;
  }
}
if (failed) {
  console.error(`[test-web-ui-image-budget] ${failed} boot image(s) over budget`);
  process.exit(1);
}
console.log('[test-web-ui-image-budget] passed');
