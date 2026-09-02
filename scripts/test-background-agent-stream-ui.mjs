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

assert.match(mobileRenderer, /function _mobileBackgroundSpawnTraceEntries\(/, 'mobile background lanes must have a grouped-trace source');
assert.match(mobileRenderer, /pm-background-spawn-trace[\s\S]*?_renderMobileGroupedTrace\(/, 'mobile background lanes must render the shared grouped trace');
assert.doesNotMatch(mobileRenderer, /_renderMobileProcess\(entries\)/, 'mobile background lanes must not render the legacy flat process list');
assert.match(mobileRenderer, /latency:\\s\*provider_/, 'mobile trace must recognize provider latency diagnostics');
assert.match(mobilePages, /function _isMobileInternalToolProtocolText\(/, 'mobile recovery must recognize provider protocol diagnostics');
assert.match(desktopPage, /function isDesktopInternalToolProtocolTraceEntry\(/, 'desktop trace must recognize provider protocol diagnostics');
assert.match(desktopPage, /function mergeBackgroundReasoningSummary\(/, 'desktop background streams must own one mutable reasoning summary');
assert.match(desktopPage, /liveTraceEntries: Array\.isArray\(record\.liveTraceEntries\)/, 'desktop side panes must prefer persisted structured traces');

console.log('[background-agent-stream-ui] grouped trace, reasoning summary, protocol filtering, and identity recovery passed');
