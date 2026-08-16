from pathlib import Path

p = Path('src/gateway/routes/hub.router.ts')
text = p.read_text(encoding='utf-8')
old = r'''function readAuditLines(): string[] {
  const p = getAuditLogPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
}

let _auditCachePath = '';
let _auditCacheMtimeMs = 0;
let _auditCacheSize = 0;
let _auditCacheLines: string[] = [];

function readAuditLinesCached(): string[] {
  const p = getAuditLogPath();
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { return []; }
  if (
    p === _auditCachePath
    && st.mtimeMs === _auditCacheMtimeMs
    && st.size === _auditCacheSize
  ) {
    return _auditCacheLines;
  }
  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
  _auditCachePath = p;
  _auditCacheMtimeMs = st.mtimeMs;
  _auditCacheSize = st.size;
  _auditCacheLines = lines;
  return lines;
}
'''
new = r'''interface AuditTimeCache {
  path: string;
  size: number;
  firstBytes: string;
  earliestTimestamp: string;
}

let _auditTimeCache: AuditTimeCache | null = null;
const AUDIT_PREFIX_BYTES = 8 * 1024;
const AUDIT_INITIAL_SCAN_LIMIT_BYTES = 1024 * 1024;
const AUDIT_SCAN_CHUNK_BYTES = 64 * 1024;

function readFilePrefix(filePath: string, maxBytes = AUDIT_PREFIX_BYTES): string {
  let handle: number | null = null;
  try {
    const st = fs.statSync(filePath);
    const length = Math.max(0, Math.min(maxBytes, st.size));
    if (!length) return '';
    handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(length);
    const read = fs.readSync(handle, buffer, 0, length, 0);
    return buffer.subarray(0, read).toString('utf-8');
  } catch {
    return '';
  } finally {
    if (handle != null) {
      try { fs.closeSync(handle); } catch {}
    }
  }
}

function findFirstAuditTimestamp(filePath: string): string {
  let handle: number | null = null;
  try {
    const st = fs.statSync(filePath);
    const scanBytes = Math.min(st.size, AUDIT_INITIAL_SCAN_LIMIT_BYTES);
    if (scanBytes <= 0) return '';
    handle = fs.openSync(filePath, 'r');
    let position = 0;
    let remainder = '';
    while (position < scanBytes) {
      const length = Math.min(AUDIT_SCAN_CHUNK_BYTES, scanBytes - position);
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(handle, buffer, 0, length, position);
      if (read <= 0) break;
      position += read;
      const combined = `${remainder}${buffer.subarray(0, read).toString('utf-8')}`;
      const lines = combined.split('\n');
      remainder = combined.endsWith('\n') ? '' : (lines.pop() || '');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const timestamp = String(JSON.parse(line)?.timestamp || '').trim();
          if (timestamp && Number.isFinite(Date.parse(timestamp))) return timestamp;
        } catch { /* skip malformed audit rows */ }
      }
    }
    if (remainder.trim()) {
      try {
        const timestamp = String(JSON.parse(remainder)?.timestamp || '').trim();
        if (timestamp && Number.isFinite(Date.parse(timestamp))) return timestamp;
      } catch {}
    }
  } catch {
    return '';
  } finally {
    if (handle != null) {
      try { fs.closeSync(handle); } catch {}
    }
  }
  return '';
}

function readAuditEarliestTimestampCached(): string {
  const filePath = getAuditLogPath();
  let st: fs.Stats;
  try { st = fs.statSync(filePath); } catch {
    _auditTimeCache = null;
    return '';
  }
  const firstBytes = readFilePrefix(filePath);
  const cached = _auditTimeCache;
  if (
    cached
    && cached.path === filePath
    && cached.earliestTimestamp
    && st.size >= cached.size
    && firstBytes === cached.firstBytes
  ) {
    // Normal audit growth is append-only. The earliest timestamp cannot change,
    // so do not reread/split the entire JSONL merely because another row landed.
    cached.size = st.size;
    return cached.earliestTimestamp;
  }
  const earliestTimestamp = findFirstAuditTimestamp(filePath);
  _auditTimeCache = { path: filePath, size: st.size, firstBytes, earliestTimestamp };
  return earliestTimestamp;
}
'''
if old not in text:
    raise SystemExit('Hub raw audit cache anchor not found')
text = text.replace(old, new, 1)

old_route = r'''    const modelEvents = readModelUsageEvents();
    const observations = readAllToolObservations(100_000);
    const auditTimestamps: string[] = [];
    for (const line of readAuditLinesCached()) {
      try {
        const e = JSON.parse(line);
        if (e?.timestamp) auditTimestamps.push(String(e.timestamp));
      } catch { /* skip malformed */ }
    }
    const sessionTimestamps = listSessionSummaries()
'''
new_route = r'''    const modelEvents = readModelUsageEvents();
    const observations = readAllToolObservations(100_000);
    const auditEarliestTimestamp = readAuditEarliestTimestampCached();
    const sessionTimestamps = listSessionSummaries()
'''
if old_route not in text:
    raise SystemExit('Hub audit timestamp parse anchor not found')
text = text.replace(old_route, new_route, 1)
text = text.replace('      ...auditTimestamps,\n', "      ...(auditEarliestTimestamp ? [auditEarliestTimestamp] : []),\n", 1)
p.write_text(text, encoding='utf-8')

reg = Path('scripts/test-hub-audit-cache-contract.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/gateway/routes/hub.router.ts', 'utf8');
assert.doesNotMatch(source, /_auditCacheLines/, 'Hub must not retain the entire audit JSONL as cached strings');
assert.doesNotMatch(source, /readAuditLinesCached/, 'Hub token activity must not split/parse the full audit log after every append');
assert.match(source, /readAuditEarliestTimestampCached\(\)/);
assert.match(source, /st\.size >= cached\.size[\s\S]*?firstBytes === cached\.firstBytes/, 'append-only growth should reuse the compact earliest-time cache');
assert.match(source, /AUDIT_INITIAL_SCAN_LIMIT_BYTES = 1024 \* 1024/, 'cold-path malformed-row scanning must be bounded');
assert.match(source, /auditEarliestTimestamp \? \[auditEarliestTimestamp\] : \[\]/, 'Hub range calculation should consume only compact audit time metadata');
console.log('Hub audit cache contract regression: ok');
''', encoding='utf-8')
print('Hub audit cache patch applied')
