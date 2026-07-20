const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'extensions', 'bundled');
const distDir = path.join(__dirname, '..', 'dist', 'extensions', 'bundled');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(path.dirname(distDir), { recursive: true });
  fs.cpSync(srcDir, distDir, { recursive: true, force: true });
  console.log(`[build] Copied extension descriptors: ${srcDir} -> ${distDir}`);
}

const personalChromeSrc = path.join(__dirname, '..', 'extensions', 'prometheus-personal-chrome');
const personalChromeDist = path.join(__dirname, '..', 'dist', 'extensions', 'prometheus-personal-chrome');
if (fs.existsSync(personalChromeSrc)) {
  fs.mkdirSync(path.dirname(personalChromeDist), { recursive: true });
  fs.cpSync(personalChromeSrc, personalChromeDist, { recursive: true, force: true });
  console.log(`[build] Copied Personal Chrome extension: ${personalChromeSrc} -> ${personalChromeDist}`);
}
