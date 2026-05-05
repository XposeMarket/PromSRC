const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'extensions', 'bundled');
const distDir = path.join(__dirname, '..', 'dist', 'extensions', 'bundled');

if (!fs.existsSync(srcDir)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(distDir), { recursive: true });
fs.cpSync(srcDir, distDir, { recursive: true, force: true });
console.log(`[build] Copied extension descriptors: ${srcDir} -> ${distDir}`);
