'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMPORTED_PROFILES_DIR_NAME = 'imported-browser-profiles';
const IMPORTED_PROFILES_INDEX_NAME = 'imported-browser-profiles.json';

// Chrome keeps the useful login/history databases in the selected profile, but
// its cache and lock trees can be very large and are not portable. Keep the
// import deliberately narrow and leave the source profile untouched.
const SKIPPED_DIRECTORY_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
  'ShaderCache',
  'Service Worker',
  'Session Storage',
  'blob_storage',
  'Crashpad',
  'CrashpadMetrics',
]);

const SKIPPED_FILE_NAMES = new Set([
  'LOCK',
  'LOCKfile',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'TransportSecurity',
]);

function uniquePaths(values) {
  const seen = new Set();
  return values.map((value) => path.resolve(String(value || ''))).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function getChromeUserDataCandidates({ platform = process.platform, homeDir = os.homedir(), env = process.env } = {}) {
  const home = path.resolve(String(homeDir || os.homedir()));
  const localAppData = String(env?.LOCALAPPDATA || '').trim() || path.join(home, 'AppData', 'Local');
  const appData = String(env?.APPDATA || '').trim() || path.join(home, 'AppData', 'Roaming');

  if (platform === 'darwin') {
    return uniquePaths([
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Chromium'),
    ]);
  }
  if (platform === 'win32') {
    return uniquePaths([
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Chromium', 'User Data'),
      path.join(appData, 'Google', 'Chrome', 'User Data'),
    ]);
  }
  return uniquePaths([
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'chromium'),
    path.join(home, '.config', 'google-chrome-unstable'),
  ]);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function profileIdFor(sourceRoot, directory) {
  const digest = crypto
    .createHash('sha256')
    .update(`${path.resolve(sourceRoot)}\0${String(directory || '')}`)
    .digest('hex')
    .slice(0, 16);
  return `chrome-${digest}`;
}

function isChromeProfileDirectory(directory) {
  const value = String(directory || '').trim();
  return value === 'Default' || /^Profile \d+$/i.test(value);
}

function detectChromeProfiles(options = {}) {
  const candidates = Array.isArray(options.userDataCandidates)
    ? uniquePaths(options.userDataCandidates)
    : getChromeUserDataCandidates(options);
  const profiles = [];
  const seen = new Set();

  for (const userDataPath of candidates) {
    if (!fs.existsSync(userDataPath)) continue;
    const localState = readJson(path.join(userDataPath, 'Local State'), {});
    const infoCache = localState && typeof localState === 'object' && localState.profile && typeof localState.profile.info_cache === 'object'
      ? localState.profile.info_cache
      : {};
    const directories = new Set();
    for (const [directory, info] of Object.entries(infoCache || {})) {
      if (!isChromeProfileDirectory(directory)) continue;
      directories.add(directory);
      const profilePath = path.join(userDataPath, directory);
      if (!fs.existsSync(profilePath)) continue;
      const id = profileIdFor(userDataPath, directory);
      if (seen.has(id)) continue;
      seen.add(id);
      const displayName = String(info?.gaia_name || info?.name || info?.user_name || directory).trim() || directory;
      profiles.push({
        id,
        name: displayName,
        directory,
        sourceRoot: userDataPath,
        sourcePath: profilePath,
        sourceLabel: path.basename(path.dirname(userDataPath)) === 'Google' ? 'Google Chrome' : 'Chromium',
      });
    }

    // Local State can be missing or stale after a profile migration. The
    // conventional directories are safe fallbacks and make detection work on
    // both macOS and Windows even before Chrome has written its profile index.
    let directoryEntries = [];
    try { directoryEntries = fs.readdirSync(userDataPath, { withFileTypes: true }); } catch { directoryEntries = []; }
    for (const entry of directoryEntries) {
      if (!entry.isDirectory() || !isChromeProfileDirectory(entry.name) || directories.has(entry.name)) continue;
      const profilePath = path.join(userDataPath, entry.name);
      const id = profileIdFor(userDataPath, entry.name);
      if (seen.has(id)) continue;
      seen.add(id);
      profiles.push({
        id,
        name: entry.name,
        directory: entry.name,
        sourceRoot: userDataPath,
        sourcePath: profilePath,
        sourceLabel: path.basename(path.dirname(userDataPath)) === 'Google' ? 'Google Chrome' : 'Chromium',
      });
    }
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory));
}

function importedProfilesIndexPath(appUserDataDir) {
  return path.join(path.resolve(String(appUserDataDir || '')), '.prometheus', IMPORTED_PROFILES_INDEX_NAME);
}

function importedProfilesRoot(appUserDataDir) {
  return path.join(path.resolve(String(appUserDataDir || '')), IMPORTED_PROFILES_DIR_NAME);
}

function isPathInside(parent, target) {
  const parentPath = path.resolve(parent);
  const targetPath = path.resolve(target);
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readImportedChromeProfiles(appUserDataDir) {
  const raw = readJson(importedProfilesIndexPath(appUserDataDir), []);
  if (!Array.isArray(raw)) return [];
  const root = importedProfilesRoot(appUserDataDir);
  return raw.map((entry) => {
    const importedPath = path.resolve(String(entry?.importedPath || ''));
    if (!entry?.id || !isPathInside(root, importedPath) || !fs.existsSync(importedPath)) return null;
    return {
      id: String(entry.id),
      name: String(entry.name || entry.directory || entry.id),
      directory: String(entry.directory || ''),
      sourceLabel: String(entry.sourceLabel || 'Chrome'),
      sourcePath: String(entry.sourcePath || ''),
      sourceRoot: String(entry.sourceRoot || ''),
      importedPath,
      importedAt: Number(entry.importedAt || 0) || 0,
    };
  }).filter(Boolean);
}

function writeImportedChromeProfiles(appUserDataDir, profiles) {
  const filePath = importedProfilesIndexPath(appUserDataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sanitized = (Array.isArray(profiles) ? profiles : []).map((entry) => ({
    id: String(entry?.id || ''),
    name: String(entry?.name || ''),
    directory: String(entry?.directory || ''),
    sourceLabel: String(entry?.sourceLabel || 'Chrome'),
    sourcePath: String(entry?.sourcePath || ''),
    sourceRoot: String(entry?.sourceRoot || ''),
    importedPath: String(entry?.importedPath || ''),
    importedAt: Number(entry?.importedAt || 0) || 0,
  })).filter((entry) => entry.id && entry.importedPath);
  fs.writeFileSync(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
}

function getImportedChromeProfile(appUserDataDir, profileId) {
  const wanted = String(profileId || '').trim();
  return readImportedChromeProfiles(appUserDataDir).find((entry) => entry.id === wanted) || null;
}

function getChromeProfileCatalog(appUserDataDir, options = {}) {
  const imported = readImportedChromeProfiles(appUserDataDir);
  const importedBySource = new Map(imported.map((entry) => [entry.sourcePath, entry]));
  const detected = detectChromeProfiles(options).map((profile) => ({
    ...profile,
    imported: importedBySource.has(profile.sourcePath),
    importedId: importedBySource.get(profile.sourcePath)?.id || '',
  }));
  return { profiles: detected, imported };
}

function shouldCopyChromeProfileEntry(sourcePath) {
  const baseName = path.basename(sourcePath);
  if (SKIPPED_DIRECTORY_NAMES.has(baseName) || SKIPPED_FILE_NAMES.has(baseName)) return false;
  if (/^(Singleton|.org\.chromium\.Chromium\.)/i.test(baseName)) return false;
  return true;
}

function copyChromeProfile(appUserDataDir, profileId, options = {}) {
  const detected = detectChromeProfiles(options).find((profile) => profile.id === String(profileId || '').trim());
  if (!detected) throw new Error('That Chrome profile is no longer available. Detect profiles again and retry.');
  const root = importedProfilesRoot(appUserDataDir);
  const importedPath = path.join(root, detected.id);
  fs.mkdirSync(root, { recursive: true });

  const importedId = detected.id.replace(/^chrome-/, 'imported-');
  const existing = getImportedChromeProfile(appUserDataDir, importedId);
  if (!existing || options.refresh === true) {
    if (options.refresh === true && fs.existsSync(importedPath)) {
      fs.rmSync(importedPath, { recursive: true, force: true });
    }
    fs.cpSync(detected.sourcePath, importedPath, {
      recursive: true,
      force: true,
      filter: shouldCopyChromeProfileEntry,
    });
    // Chrome's encryption metadata lives one level above Default/Profile N.
    // Copy it when present; the source remains untouched. The operating system
    // may still require a fresh sign-in when the encryption scope is app-bound.
    const localStatePath = path.join(detected.sourceRoot, 'Local State');
    if (fs.existsSync(localStatePath)) {
      try { fs.copyFileSync(localStatePath, path.join(importedPath, 'Local State')); } catch {}
    }
  }

  const imported = {
    id: importedId,
    name: detected.name,
    directory: detected.directory,
    sourceLabel: detected.sourceLabel,
    sourcePath: detected.sourcePath,
    sourceRoot: detected.sourceRoot,
    importedPath,
    importedAt: existing?.importedAt || Date.now(),
  };
  const profiles = readImportedChromeProfiles(appUserDataDir).filter((entry) => entry.id !== imported.id);
  profiles.push(imported);
  writeImportedChromeProfiles(appUserDataDir, profiles);
  return imported;
}

module.exports = {
  getChromeUserDataCandidates,
  detectChromeProfiles,
  getChromeProfileCatalog,
  importedProfilesIndexPath,
  importedProfilesRoot,
  readImportedChromeProfiles,
  getImportedChromeProfile,
  copyChromeProfile,
};
