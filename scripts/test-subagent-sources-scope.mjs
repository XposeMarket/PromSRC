import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

// Import the browser utility through a data URL so this contract test can run
// without changing the web-ui package's browser-oriented module handling.
const contextModule = await import(`data:text/javascript,${encodeURIComponent(read('web-ui/src/source-panel-context.js'))}`);
const {
  SOURCE_PANEL_SURFACE,
  normalizeSourcePanelContext,
  sourcePanelContextIsVisible,
  sourcePanelResourceBelongsToContext,
  subagentChatSessionId,
} = contextModule;

const agentA = normalizeSourcePanelContext({
  surface: SOURCE_PANEL_SURFACE.SUBAGENT_CHAT,
  agentId: 'Research Agent',
});
const agentB = normalizeSourcePanelContext({
  surface: SOURCE_PANEL_SURFACE.SUBAGENT_CHAT,
  agentId: 'Writer Agent',
});
const none = normalizeSourcePanelContext({ surface: SOURCE_PANEL_SURFACE.NONE });

assert.equal(subagentChatSessionId('Research Agent'), 'subagent_chat_research-agent');
assert.equal(sourcePanelContextIsVisible(agentA, { mode: 'subagents', activeSessionId: agentA.sessionId }), true);
assert.equal(sourcePanelContextIsVisible(agentA, { mode: 'chat', activeSessionId: agentA.sessionId }), false);
assert.equal(sourcePanelContextIsVisible(agentA, { mode: 'subagents', activeSessionId: agentB.sessionId }), false);
assert.equal(sourcePanelContextIsVisible(none, { mode: 'subagents' }), false);
assert.notEqual(agentA.key, agentB.key);
assert.equal(none.key, 'none');

assert.equal(sourcePanelResourceBelongsToContext({ threadId: agentA.sessionId }, agentA), true);
assert.equal(sourcePanelResourceBelongsToContext({ threadId: agentB.sessionId }, agentA), false);
assert.equal(sourcePanelResourceBelongsToContext({ sessionId: agentA.sessionId }, agentA), true);
assert.equal(sourcePanelResourceBelongsToContext({ threadId: 'main-session' }, agentA), false);
assert.equal(sourcePanelResourceBelongsToContext({ title: 'unowned legacy source' }, agentA), false);

const desktop = read('web-ui/src/pages/ChatPage.js');
const subagents = read('web-ui/src/pages/SubagentsPage.js');
const mobile = [
  read('web-ui/src/mobile/mobile-pages.js'),
  read('web-ui/src/mobile/mobile-subagent-pages.js'),
].join('\n');
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const resourceStore = read('src/gateway/resources/resource-store.ts');

assert.match(desktop, /showSourcesMinimizedPanel[\s\S]{0,500}!sourcePanelContextIsActive\(\)/);
assert.match(desktop, /sourcePanelResourceBelongsToContext\(resource, context\)/);
assert.match(desktop, /isSubagentChat \? \[\] : sourcePanelEditItems/);
assert.match(desktop, /case 'resources_changed'/);
assert.match(subagents, /syncSubagentSourcePanelContext\(agentId\)/);
assert.match(subagents, /activeSubagentId = null;\s+syncSubagentSourcePanelContext\(\)/);
assert.ok((subagents.match(/case 'resources_changed'/g) || []).length >= 2, 'live and replay stream handlers must refresh Sources');
assert.match(subagents, /function replaySubagentChatStream/);
assert.match(subagents, /refreshSubagentSourcePanelFromEvent\(agentId, event\)/);
assert.match(mobile, /requestToken: 0/);
assert.match(mobileRenderer, /case 'resources_changed'/);
assert.match(mobileRenderer, /_refreshMobileSourcesForSession/);
assert.match(mobile, /sourcePanelResourceBelongsToContext\(resource/);
assert.match(mobile, /const sessionId = subagentChatSessionId\(agentId\)/);
assert.match(mobile, /sessionId: options\.sessionId \|\| __pmChat\.activeSessionId/);
assert.match(resourceStore, /threadId: link\?\.threadId/);

console.log('Subagent Sources scope contracts passed.');
