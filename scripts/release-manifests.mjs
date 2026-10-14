// Normalize updater metadata only after all distributables are final/verified.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const [directory, tag] = process.argv.slice(2);
if (!directory || !/^v\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(tag || '')) throw Error('Usage: release-manifests.mjs <artifacts> <vVERSION>');
const version = tag.slice(1);
const channel = /-(beta|rc)\./.exec(version)?.[1] || 'latest';
for (const suffix of ['', '-mac']) {
  const source = path.join(directory, `${channel}${suffix}.yml`);
  const fallback = path.join(directory, `latest${suffix}.yml`);
  if (!fs.existsSync(source) && !fs.existsSync(fallback)) {
    if (!suffix) throw Error('Missing Windows updater manifest');
    continue;
  }
  const text = fs.readFileSync(fs.existsSync(source) ? source : fallback, 'utf8');
  const manifest = yaml.load(text);
  if (manifest.version !== version || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Updater manifest version/files mismatch');
  for (const file of manifest.files) {
    const name = decodeURIComponent(file.url);
    if (path.basename(name) !== name) throw Error(`Unexpected updater asset path: ${name}`);
    const assetPath = path.join(directory, name);
    if (!fs.existsSync(`${assetPath}.blockmap`)) throw Error(`Missing updater blockmap: ${name}.blockmap`);
    const bytes = fs.readFileSync(assetPath);
    if (crypto.createHash('sha512').update(bytes).digest('base64') !== file.sha512) throw Error(`Updater SHA512 mismatch: ${name}`);
  }
  // Beta users must also receive a promoted stable release. Stable users only
  // discover non-prerelease GitHub releases, not prerelease latest.yml assets.
  for (const target of ['latest', 'beta', 'rc']) fs.writeFileSync(path.join(directory, `${target}${suffix}.yml`), text);
}
console.log(`Verified updater manifests and published channel aliases for ${tag}`);
