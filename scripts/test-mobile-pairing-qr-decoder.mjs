import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const mobileDocument = read('web-ui/mobile.html');
const generatedMobileDocument = read('generated/public-web-ui/mobile.html');
const scannerOwner = read('web-ui/src/mobile/mobile-pages.js');

assert.match(
  mobileDocument,
  /<script\s+src="\/vendor\/jsqr\/jsQR\.js"\s+defer><\/script>/,
  'the dedicated mobile document must load the Safari/iOS jsQR fallback',
);
assert.match(
  generatedMobileDocument,
  /<script\s+src="\/vendor\/jsqr\/jsQR\.js"\s+defer><\/script>/,
  'the production mobile document must preserve the jsQR fallback',
);
assert.match(scannerOwner, /BarcodeDetector/, 'pairing scanner must retain the native BarcodeDetector fast path');
assert.match(scannerOwner, /jsQR/, 'pairing scanner must retain the jsQR fallback path');
assert.match(scannerOwner, /attemptBoth/, 'jsQR fallback must support normal and inverted QR frames');

console.log('Mobile pairing QR decoder document contract passed.');
