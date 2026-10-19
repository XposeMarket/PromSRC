import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'browser-tools.ts'), 'utf8');
const start = source.indexOf('async function removeXScrapeProfileDir');
const end = source.indexOf('/**\n * Kill X-scrape Chromes', start);
assert.ok(start >= 0 && end > start, 'removeXScrapeProfileDir must exist');
const remover = source.slice(start, end);

// Polarity 1: removal is asynchronous and every caller awaits it; no blocking rmSync on the event loop.
assert.match(remover, /^async function removeXScrapeProfileDir\(profileDir: string\): Promise<boolean>/);
assert.match(remover, /await fs\.promises\.rm\(resolved, \{ recursive: true, force: true/);
assert.doesNotMatch(source, /fs\.rmSync\(resolved/);
assert.match(source, /if \(await removeXScrapeProfileDir\(dir\)\) removedProfiles \+= 1;/);
assert.match(source, /if \(xProfileDir\) await removeXScrapeProfileDir\(xProfileDir\);/);
// No un-awaited call sites (the declaration and awaited calls are allowed).
assert.doesNotMatch(source, /(?<!await |function )removeXScrapeProfileDir\(/);

// Polarity 2: the safety guard still refuses anything outside the persistent profile root,
// anything not prefixed as an X-scrape profile, and live profiles.
assert.match(remover, /if \(path\.dirname\(resolved\)\.toLowerCase\(\) !== root\.toLowerCase\(\)\) return false;/);
assert.match(remover, /if \(!path\.basename\(resolved\)\.startsWith\(X_SCRAPE_PROFILE_PREFIX\)\) return false;/);
assert.match(remover, /if \(isLiveXScrapeProfile\(resolved\)\) return false;/);

console.log('PASS: X scrape orphan sweep removes profiles asynchronously and keeps the root/prefix/live guards');
