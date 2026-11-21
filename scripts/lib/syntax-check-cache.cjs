'use strict';

// Content-addressed record of web-ui files that already PASSED the syntax checks in
// check-public-web-ui-sync.js (`node --check` plus the esbuild browser-module parse).
// A file is skipped only when its exact bytes passed under the same salt (Node version,
// esbuild version and check options). Failures are never recorded, so a broken file is
// re-checked on every run. Disable with PROMETHEUS_NO_SYNTAX_CACHE=1.
//
// The record is a cache, not state: a missing, corrupt or foreign file just means every
// file is checked again. Writes go through a temp file + rename, so concurrent runs can
// only lose entries (a cache miss), never leave a half-written file behind.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT_VERSION = 1;
const MAX_ENTRIES = 5000;

function enabled(env = process.env) {
  return env.PROMETHEUS_NO_SYNTAX_CACHE !== '1';
}

function cacheKey(buffer, salt) {
  return crypto.createHash('sha256').update(String(salt)).update('\0').update(buffer).digest('hex');
}

function load(file, salt) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && data.version === FORMAT_VERSION && data.salt === salt && Array.isArray(data.passed)) {
      return new Set(data.passed.filter((key) => typeof key === 'string'));
    }
  } catch {
    // missing or unreadable: start empty
  }
  return new Set();
}

// `passed` keeps insertion order; keys for the files of this run are moved to the end so
// the cap drops the entries no checkout has used for the longest time.
function save(file, salt, passed, currentKeys = []) {
  const ordered = new Set(passed);
  for (const key of currentKeys) {
    if (ordered.delete(key)) ordered.add(key);
  }
  const keys = [...ordered].slice(-MAX_ENTRIES);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: FORMAT_VERSION, salt, passed: keys }));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

module.exports = { FORMAT_VERSION, MAX_ENTRIES, enabled, cacheKey, load, save };
