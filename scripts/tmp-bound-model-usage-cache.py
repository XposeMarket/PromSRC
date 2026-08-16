from pathlib import Path

p = Path('src/providers/model-usage.ts')
text = p.read_text(encoding='utf-8')
old = r'''let _usageReadCachePath = '';
let _usageReadCacheMtimeMs = 0;
let _usageReadCacheSize = 0;
let _usageReadCacheEvents: ModelUsageEvent[] = [];
let _usageReadCacheRemainder = '';
let _usageReadCacheInitialized = false;
const _usageEventsBySession = new Map<string, ModelUsageEvent[]>();
const _usageCalibrationEvents = new Map<string, ModelUsageEvent[]>();
'''
new = r'''let _usageReadCachePath = '';
let _usageReadCacheMtimeMs = 0;
let _usageReadCacheSize = 0;
let _usageReadCacheEventCount = 0;
let _usageReadCacheRemainder = '';
let _usageReadCacheInitialized = false;
// The resident index exists only for bounded calibration state. Historical
// usage remains authoritative in model-usage.jsonl and is materialized only
// for explicit history queries instead of being mirrored in gateway heap.
const _usageCalibrationEvents = new Map<string, ModelUsageEvent[]>();
'''
if old not in text:
    raise SystemExit('model usage cache declarations anchor not found')
text = text.replace(old, new, 1)

old_index = r'''function indexUsageEvent(event: ModelUsageEvent): void {
  _usageReadCacheEvents.push(event);
  const sessionId = String(event.sessionId || '').trim();
  if (sessionId) {
    const events = _usageEventsBySession.get(sessionId) || [];
    events.push(event);
    _usageEventsBySession.set(sessionId, events);
  }
  if (isCalibrationEvent(event)) {
'''
new_index = r'''function indexUsageEvent(event: ModelUsageEvent): void {
  _usageReadCacheEventCount += 1;
  if (isCalibrationEvent(event)) {
'''
if old_index not in text:
    raise SystemExit('model usage indexUsageEvent anchor not found')
text = text.replace(old_index, new_index, 1)

old_reset = r'''  _usageReadCacheSize = 0;
  _usageReadCacheEvents = [];
  _usageReadCacheRemainder = '';
  _usageReadCacheInitialized = false;
  _usageEventsBySession.clear();
  _usageCalibrationEvents.clear();
'''
new_reset = r'''  _usageReadCacheSize = 0;
  _usageReadCacheEventCount = 0;
  _usageReadCacheRemainder = '';
  _usageReadCacheInitialized = false;
  _usageCalibrationEvents.clear();
'''
if old_reset not in text:
    raise SystemExit('model usage reset anchor not found')
text = text.replace(old_reset, new_reset, 1)

old_readers = r'''export function readModelUsageEvents(): ModelUsageEvent[] {
  try {
    ensureUsageReadCache();
    return _usageReadCacheEvents;
  } catch {
    return [];
  }
}

export function readModelUsageEventsForSession(sessionId: string): ModelUsageEvent[] {
  try {
    ensureUsageReadCache();
    return _usageEventsBySession.get(String(sessionId || '').trim()) || [];
  } catch {
    return [];
  }
}

export function warmModelUsageIndex(): { events: number; durationMs: number } {
  const startedAt = Date.now();
  ensureUsageReadCache();
  return { events: _usageReadCacheEvents.length, durationMs: Date.now() - startedAt };
}
'''
new_readers = r'''function readHistoricalUsageEvents(sessionId?: string): ModelUsageEvent[] {
  const wantedSessionId = String(sessionId || '').trim();
  const filePath = usageLogPath();
  let raw = '';
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }
  const out: ModelUsageEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ModelUsageEvent;
      if (wantedSessionId && String(event.sessionId || '').trim() !== wantedSessionId) continue;
      out.push(event);
    } catch {
      // Historical usage queries remain best-effort if telemetry contains a
      // malformed row; the resident calibration index follows the same rule.
    }
  }
  return out;
}

export function readModelUsageEvents(): ModelUsageEvent[] {
  try {
    ensureUsageReadCache();
    return readHistoricalUsageEvents();
  } catch {
    return [];
  }
}

export function readModelUsageEventsForSession(sessionId: string): ModelUsageEvent[] {
  try {
    ensureUsageReadCache();
    return readHistoricalUsageEvents(sessionId);
  } catch {
    return [];
  }
}

export function warmModelUsageIndex(): { events: number; durationMs: number } {
  const startedAt = Date.now();
  ensureUsageReadCache();
  return { events: _usageReadCacheEventCount, durationMs: Date.now() - startedAt };
}
'''
if old_readers not in text:
    raise SystemExit('model usage readers anchor not found')
text = text.replace(old_readers, new_readers, 1)
p.write_text(text, encoding='utf-8')

reg = Path('scripts/test-model-usage-cache-contract.mjs')
reg.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/providers/model-usage.ts', 'utf8');
assert.doesNotMatch(source, /_usageReadCacheEvents/, 'gateway must not retain every historical model call object');
assert.doesNotMatch(source, /_usageEventsBySession/, 'gateway must not duplicate lifetime usage into per-session arrays');
assert.match(source, /_usageReadCacheEventCount \+= 1/, 'warmup telemetry should retain only an integer event count');
assert.match(source, /events\.length > CALIBRATION_WINDOW/, 'provider-model calibration working sets must stay bounded');
assert.match(source, /function readHistoricalUsageEvents\(sessionId\?: string\)/, 'full history must remain available as an explicit disk-backed query');
console.log('model usage cache contract regression: ok');
''', encoding='utf-8')
print('model usage cache patch applied')
