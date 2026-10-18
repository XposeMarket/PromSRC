import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backgroundAgentRecordToMessage,
  normalizeBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
} from '../web-ui/src/features/chat/core/background-agent-work.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const mobilePages = read('web-ui/src/mobile/mobile-pages.js');
const desktopPage = read('web-ui/src/pages/ChatPage.js');
const sessionStore = read('src/gateway/session.ts');

for (const value of ['undefined', 'null', '', 'Background agent']) {
  const identity = resolveBackgroundAgentIdentity('bg-stream-regression', { existingName: value });
  assert.ok(identity.name && !/^(?:undefined|null)$/i.test(identity.name), `identity must recover from ${value}`);
}

const normalized = normalizeBackgroundAgentWork({
  id: 'bg-stream-regression',
  sessionId: 'session-regression',
  agentName: 'undefined',
  status: 'running',
});
assert.ok(normalized?.agentName && normalized.agentName !== 'undefined', 'stored undefined agent names must be normalized');
assert.notEqual(backgroundAgentRecordToMessage(normalized).from, 'undefined', 'recovered messages must have a display name');

assert.match(sessionStore, /INTERNAL_SESSION_ID_RE = \/\^\(background_\|/, 'background runtime sessions must stay out of user session discovery');
assert.match(mobileRenderer, /Read durable work before[\s\S]{0,420}findBackgroundAgentWork\(id, parentSessionId\)/, 'mobile lane upserts must consult durable work before resolving identity');
assert.match(mobileRenderer, /_mergeMobileProcessEntries\(lane\.message, storedProcessEntries\)/, 'mobile recovery must merge durable process entries instead of replacing the live lane');
assert.match(mobileRenderer, /action: source\.action \|\| source\.name \|\| source\.toolName/, 'mobile events must retain structured current-tool metadata');
assert.match(mobileRenderer, /function _mobileBackgroundSpawnTraceEntries\(/, 'mobile background lanes must have a grouped-trace source');
assert.match(mobileRenderer, /pm-background-spawn-trace[\s\S]*?_renderMobileGroupedTrace\(/, 'mobile background lanes must render the shared grouped trace');
assert.doesNotMatch(mobileRenderer, /_renderMobileProcess\(entries\)/, 'mobile background lanes must not render the legacy flat process list');
assert.match(mobileRenderer, /latency:\\s\*provider_/, 'mobile trace must recognize provider latency diagnostics');
assert.match(mobilePages, /function _isMobileInternalToolProtocolText\(/, 'mobile recovery must recognize provider protocol diagnostics');
assert.match(desktopPage, /function isDesktopInternalToolProtocolTraceEntry\(/, 'desktop trace must recognize provider protocol diagnostics');
assert.match(read('web-ui/src/background-stream-summary.js'), /function mergeBackgroundReasoningSummary\(/, 'desktop background streams must own one mutable reasoning summary');
assert.match(desktopPage, /liveTraceEntries: Array\.isArray\(record\.liveTraceEntries\)/, 'desktop side panes must prefer persisted structured traces');
assert.match(
  desktopPage,
  /function renderBackgroundAgentSidePaneHtml[\s\S]{0,2400}renderUnifiedDesktopLiveMessageHtml\(message, \{ sessionId: `background:\$\{record\.id\}` \}\)/,
  'the background detail renderer must delegate to the unified desktop message renderer',
);
assert.match(
  desktopPage,
  /function backgroundAgentEventsToLiveTraceEntries\(events = \[\]\) \{[\s\S]*?if \(eventType === 'reasoning_summary' \|\| eventType === 'reasoning_summary_delta' \|\| eventType === 'reasoning_delta'\) \{\s*const text = String\(extra\.thinking \|\| extra\.text \|\| extra\.message \|\| entry\.content \|\| ''\)\.trim\(\);\s*mergeBackgroundReasoningSummary\(trace, text, \{\s*\.\.\.extra,\s*source: 'agent_progress',\s*visibility: 'summary',\s*reasoningKind: 'summary'/,
  'summary deltas must be tagged mutable so they cannot become a second stream row',
);
assert.match(read('web-ui/src/background-stream-summary.js'), /function backgroundSpawnCollapsedDetail\(/, 'background summaries need a stable dock detail selector');
assert.match(desktopPage, /const detail = backgroundSpawnCollapsedDetail\(lane, backgroundAgentPreview\)/, 'reasoning summary updates must not replace the collapsed background-agent header preview');
assert.match(
  desktopPage,
  /case 'reasoning_summary_delta':[\s\S]{0,450}eventType,\s*source: 'agent_progress',\s*visibility: 'summary',\s*reasoningKind: 'summary'/,
  'summary event metadata must survive websocket ingestion and reopen replay normalization',
);






console.log('[background-agent-stream-ui] grouped trace, reasoning summary, protocol filtering, and identity recovery passed');

const { backgroundSpawnCollapsedDetail, mergeBackgroundReasoningSummary } = await import('../web-ui/src/background-stream-summary.js');
assert.equal(backgroundSpawnCollapsedDetail({ events: [
  { content: 'Editing files', extra: { eventType: 'tool_call' } },
  { content: 'Private summary', extra: { reasoningKind: 'summary' } },
] }), 'Editing files');
assert.equal(backgroundSpawnCollapsedDetail({ result: 'done' }, (value, max) => `${value}:${max}`), 'done:120');
const summaryTrace = [];
mergeBackgroundReasoningSummary(summaryTrace, 'Checking', {}, 0);
mergeBackgroundReasoningSummary(summaryTrace, ' files', {}, 1, { delta: true });
assert.equal(summaryTrace.length, 1);
assert.equal(summaryTrace[0].text, 'Checkingfiles');
assert.equal(summaryTrace[0].extra.reasoningKind, 'summary');
