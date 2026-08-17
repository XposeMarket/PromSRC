import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/browser-site-knowledge.ts', 'utf8');
assert.match(source, /CACHE_ENTRY_LIMIT = Math\.max\(16, Number\(process\.env\.PROMETHEUS_BROWSER_SITE_CACHE_LIMIT \|\| 128\)/);
assert.match(source, /now - entry\.ts >= CACHE_TTL_MS/);
assert.match(source, /siteKnowledgeCache\.size - CACHE_ENTRY_LIMIT/);
assert.match(source, /pruneSiteKnowledgeCache\(now\);\s*const cached = siteKnowledgeCache\.get\(clean\)/, 'reads must evict expired hostnames before lookup');
assert.match(source, /siteKnowledgeCache\.set\(clean, \{ ts: now, data: payload \}\);\s*pruneSiteKnowledgeCache\(now\)/, 'writes must enforce the hostname cap');
console.log('browser site cache contract regression: ok');
