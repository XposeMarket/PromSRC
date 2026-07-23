'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const inputDir = path.resolve(inputArg ? inputArg.slice('--input='.length) : path.join(ROOT, 'release-public'));
const outputPath = path.resolve(outputArg ? outputArg.slice('--output='.length) : path.join(inputDir, 'latest-mac.yml'));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

const expectedPrefix = `Prometheus-${PACKAGE.version}-mac-`;
const distributables = walk(inputDir)
  .filter((file) => {
    const name = path.basename(file);
    return name.startsWith(expectedPrefix) && /\.(?:zip|dmg)$/i.test(name);
  })
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

for (const arch of ['arm64', 'x64']) {
  for (const extension of ['zip', 'dmg']) {
    const expected = `${expectedPrefix}${arch}.${extension}`;
    if (!distributables.some((file) => path.basename(file) === expected)) {
      throw new Error(`Missing macOS release artifact: ${expected}`);
    }
  }
}

const entries = distributables.map((file) => ({
  url: path.basename(file),
  sha512: sha512(file),
  size: fs.statSync(file).size,
}));
const legacy = entries.find((entry) => entry.url.endsWith('-x64.zip'));

const yaml = [
  `version: ${PACKAGE.version}`,
  'files:',
  ...entries.flatMap((entry) => [
    `  - url: ${entry.url}`,
    `    sha512: ${entry.sha512}`,
    `    size: ${entry.size}`,
  ]),
  `path: ${legacy.url}`,
  `sha512: ${legacy.sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, yaml);
console.log(`[merge-macos-update-manifest] Wrote ${outputPath} with ${entries.length} architecture-aware files.`);
