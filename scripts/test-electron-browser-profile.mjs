import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  detectChromeProfiles,
  getChromeProfileCatalog,
  getImportedChromeProfile,
  copyChromeProfile,
} = require('../electron/chrome-profile.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-chrome-profile-'));
const chromeRoot = path.join(root, 'Google', 'Chrome', 'User Data');
const profilePath = path.join(chromeRoot, 'Default');
const appData = path.join(root, 'Prometheus');

try {
  fs.mkdirSync(profilePath, { recursive: true });
  fs.mkdirSync(path.join(profilePath, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(chromeRoot, 'Local State'), JSON.stringify({
    profile: { info_cache: { Default: { name: 'Test Chrome' } } },
  }));
  fs.writeFileSync(path.join(profilePath, 'History'), 'history');
  fs.writeFileSync(path.join(profilePath, 'Cookies'), 'cookies');
  fs.writeFileSync(path.join(profilePath, 'Cache', 'discard-me'), 'cache');
  fs.writeFileSync(path.join(profilePath, 'SingletonLock'), 'lock');

  const detected = detectChromeProfiles({ userDataCandidates: [chromeRoot] });
  assert.equal(detected.length, 1);
  assert.equal(detected[0].name, 'Test Chrome');
  assert.equal(detected[0].directory, 'Default');

  const imported = copyChromeProfile(appData, detected[0].id, { userDataCandidates: [chromeRoot] });
  assert.match(imported.id, /^imported-/);
  assert.equal(fs.readFileSync(path.join(imported.importedPath, 'History'), 'utf8'), 'history');
  assert.equal(fs.readFileSync(path.join(imported.importedPath, 'Cookies'), 'utf8'), 'cookies');
  assert.equal(fs.existsSync(path.join(imported.importedPath, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(imported.importedPath, 'SingletonLock')), false);
  assert.ok(getImportedChromeProfile(appData, imported.id));

  const catalog = getChromeProfileCatalog(appData, { userDataCandidates: [chromeRoot] });
  assert.equal(catalog.profiles[0].imported, true);
  assert.equal(catalog.profiles[0].importedId, imported.id);
  console.log('electron browser profile checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
