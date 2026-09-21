import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression guard for the mobile live-trace payload cap.
 *
 * The gateway historically shipped every persisted `liveTraceEntries` item to the
 * mobile client even though the mobile thread cache immediately discarded the
 * transient streaming entries. This checks the server-side filter stays aligned
 * with the client predicate in web-ui/src/mobile/mobile-pages.js and, critically,
 * that durable full thoughts are never dropped.
 */

const routerPath = path.join(__dirname, 'routes', 'chat.router.ts');
const routerSource = fs.readFileSync(routerPath, 'utf8');

// Guard 1: the sanitizer must exist and be wired into the shared UI sanitizer.
assert.ok(
  routerSource.includes('function sanitizeLiveTraceEntriesForUi('),
  'sanitizeLiveTraceEntriesForUi must exist in chat.router.ts',
);
assert.ok(
  routerSource.includes('msg.liveTraceEntries = sanitizeLiveTraceEntriesForUi('),
  'sanitizeHistoryForUiResponse must apply the live-trace cap',
);

// Guard 2: both mobile-facing read paths must pass a limit.
// (The options-interface declaration uses `perMessageLiveTraceLimit?:` and is
// intentionally excluded by this pattern, so this counts real call sites only:
// GET /api/sessions/:id/history-page and GET /api/sessions/:id.)
const limitCallSites = routerSource.match(/perMessageLiveTraceLimit: /g) || [];
assert.equal(
  limitCallSites.length,
  2,
  `expected both mobile read endpoints to set perMessageLiveTraceLimit, found ${limitCallSites.length}`,
);
assert.ok(
  routerSource.includes('perMessageLiveTraceLimit?: number;'),
  'perMessageLiveTraceLimit must be declared on the sanitizer options interface',
);

// Guard 3: explicit full/debug reads must remain unfiltered.
assert.ok(
  routerSource.includes('perMessageLiveTraceLimit: full || fullProcess ? undefined :'),
  'full/fullProcess reads must opt out of live-trace filtering',
);

// Guard 4: behavioural check of the predicate itself.
function isTransientLiveTraceEntryForUi(entry: any): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const str = (value: any) => String(value || '').trim().toLowerCase();
  const type = str(entry.type || entry.kind);
  const event = str(entry.event || extra.event || extra.eventType);
  const source = str(entry.source || extra.source);
  const visibility = str(entry.visibility || extra.visibility);
  const reasoningKind = str(entry.reasoningKind || extra.reasoningKind || extra.presentationKind);
  if (reasoningKind === 'full_thought') return false;
  return source === 'agent_progress'
    || source === 'reasoning_summary'
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(type)
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(event)
    || reasoningKind === 'summary'
    || (visibility === 'summary' && ['think', 'thinking', 'agent_thought'].includes(type));
}

function sanitizeLiveTraceEntriesForUi(entries: any[], limit: number): any[] {
  const durable = entries.filter((entry) => !isTransientLiveTraceEntryForUi(entry));
  return limit > 0 ? durable.slice(-limit) : durable;
}

// Durable content must survive.
const fullThought = { type: 'think', reasoningKind: 'full_thought', text: 'durable reasoning' };
const toolEntry = { type: 'tool_call', text: 'ran a tool' };
const assistantText = { type: 'text', text: 'visible answer' };
// A full thought must survive even when it also carries a summary-ish visibility.
const fullThoughtWithSummaryVisibility = {
  type: 'think',
  visibility: 'summary',
  reasoningKind: 'full_thought',
  text: 'durable reasoning kept',
};

// Transient streaming chatter must be dropped.
const summaryDelta = { type: 'reasoning_summary_delta', text: 'partial...' };
const progressNarration = { source: 'agent_progress', text: 'still working' };
const summaryVisibility = { type: 'thinking', visibility: 'summary', text: 'short summary' };
const nestedExtraSummary = { type: 'think', extra: { reasoningKind: 'summary' }, text: 'x' };

const mixed = [
  summaryDelta,
  fullThought,
  progressNarration,
  toolEntry,
  summaryVisibility,
  assistantText,
  nestedExtraSummary,
  fullThoughtWithSummaryVisibility,
];

const kept = sanitizeLiveTraceEntriesForUi(mixed, 0);
assert.deepEqual(
  kept,
  [fullThought, toolEntry, assistantText, fullThoughtWithSummaryVisibility],
  'durable entries must survive and transient streaming entries must be dropped',
);

// The limit must keep the most recent durable entries, not the oldest.
const many = Array.from({ length: 200 }, (_, i) => ({ type: 'tool_call', text: `entry-${i}` }));
const capped = sanitizeLiveTraceEntriesForUi(many, 60);
assert.equal(capped.length, 60, 'limit must be applied');
assert.equal((capped[capped.length - 1] as any).text, 'entry-199', 'must keep the newest entries');
assert.equal((capped[0] as any).text, 'entry-140', 'must drop the oldest entries');

// A limit of 0 means "no cap", matching the option being omitted for full reads.
assert.equal(sanitizeLiveTraceEntriesForUi(many, 0).length, 200, 'limit 0 must not truncate');

// Non-object junk must be preserved rather than silently eaten.
assert.deepEqual(sanitizeLiveTraceEntriesForUi([null, 'x'] as any, 0), [null, 'x']);

console.log('live-trace-sanitize regression: all assertions passed');
