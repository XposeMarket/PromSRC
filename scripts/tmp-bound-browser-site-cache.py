from pathlib import Path

p = Path('src/gateway/browser-site-knowledge.ts')
text = p.read_text(encoding='utf-8')
old = """const CACHE_TTL_MS = 30_000;\nconst siteKnowledgeCache = new Map<string, { ts: number; data: BrowserSiteKnowledge }>();\n\nfunction knowledgeRootDir(): string {\n"""
new = """const CACHE_TTL_MS = 30_000;\nconst CACHE_ENTRY_LIMIT = Math.max(16, Number(process.env.PROMETHEUS_BROWSER_SITE_CACHE_LIMIT || 128) || 128);\nconst siteKnowledgeCache = new Map<string, { ts: number; data: BrowserSiteKnowledge }>();\n\nfunction pruneSiteKnowledgeCache(now = Date.now()): void {\n  for (const [hostname, entry] of siteKnowledgeCache.entries()) {\n    if (now - entry.ts >= CACHE_TTL_MS) siteKnowledgeCache.delete(hostname);\n  }\n  if (siteKnowledgeCache.size <= CACHE_ENTRY_LIMIT) return;\n  const oldest = [...siteKnowledgeCache.entries()]\n    .sort((a, b) => a[1].ts - b[1].ts)\n    .slice(0, siteKnowledgeCache.size - CACHE_ENTRY_LIMIT);\n  for (const [hostname] of oldest) siteKnowledgeCache.delete(hostname);\n}\n\nfunction knowledgeRootDir(): string {\n"""
if old not in text:
    raise SystemExit('browser site cache declaration anchor not found')
text = text.replace(old, new, 1)

old_save = """  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');\n  siteKnowledgeCache.set(clean, { ts: Date.now(), data: payload });\n}\n"""
new_save = """  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');\n  const now = Date.now();\n  pruneSiteKnowledgeCache(now);\n  siteKnowledgeCache.set(clean, { ts: now, data: payload });\n  pruneSiteKnowledgeCache(now);\n}\n"""
if old_save not in text:
    raise SystemExit('browser site cache save anchor not found')
text = text.replace(old_save, new_save, 1)

old_load = """  const clean = cleanHostname(hostname);\n  if (!clean) return { hostname: '', updatedAt: 0, elements: [], itemRoots: [], extractionSchemas: [] };\n  const cached = siteKnowledgeCache.get(clean);\n  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;\n\n  const filePath = knowledgeFilePath(clean);\n"""
new_load = """  const clean = cleanHostname(hostname);\n  if (!clean) return { hostname: '', updatedAt: 0, elements: [], itemRoots: [], extractionSchemas: [] };\n  const now = Date.now();\n  pruneSiteKnowledgeCache(now);\n  const cached = siteKnowledgeCache.get(clean);\n  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;\n\n  const filePath = knowledgeFilePath(clean);\n"""
if old_load not in text:
    raise SystemExit('browser site cache load anchor not found')
text = text.replace(old_load, new_load, 1)

old_set = """  siteKnowledgeCache.set(clean, { ts: Date.now(), data });\n  return data;\n}\n"""
new_set = """  siteKnowledgeCache.set(clean, { ts: now, data });\n  pruneSiteKnowledgeCache(now);\n  return data;\n}\n"""
if old_set not in text:
    raise SystemExit('browser site cache load-set anchor not found')
text = text.replace(old_set, new_set, 1)
p.write_text(text, encoding='utf-8')

reg = Path('scripts/test-browser-site-cache-contract.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/browser-site-knowledge.ts', 'utf8');
assert.match(source, /CACHE_ENTRY_LIMIT = Math\.max\(16, Number\(process\.env\.PROMETHEUS_BROWSER_SITE_CACHE_LIMIT \|\| 128\)/);
assert.match(source, /now - entry\.ts >= CACHE_TTL_MS/);
assert.match(source, /siteKnowledgeCache\.size - CACHE_ENTRY_LIMIT/);
assert.match(source, /pruneSiteKnowledgeCache\(now\);\s*const cached = siteKnowledgeCache\.get\(clean\)/, 'reads must evict expired hostnames before lookup');
assert.match(source, /siteKnowledgeCache\.set\(clean, \{ ts: now, data: payload \}\);\s*pruneSiteKnowledgeCache\(now\)/, 'writes must enforce the hostname cap');
console.log('browser site cache contract regression: ok');
''', encoding='utf-8')
print('browser site cache patch applied')
