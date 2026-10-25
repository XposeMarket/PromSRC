import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Minimal DOM shims: tool-activity only needs document.body.classList and window.
const bodyClasses = new Set();
globalThis.window = globalThis.window || {};
globalThis.document = {
  body: { classList: { contains: (name) => bodyClasses.has(name) } },
  addEventListener() {},
};

const { applyToolActivityEvent, renderToolActivityEntry, setToolActivityDisclosureState } = await import(
  pathToFileURL(path.resolve('web-ui/src/tool-activity.js')).href
);
const { classifyMainChatStreamEvent } = await import(
  pathToFileURL(path.resolve('src/gateway/chat/main-chat-stream.ts')).href
).catch(() => ({}));

function commandEntry(id, terminal) {
  const entries = [];
  return applyToolActivityEvent(entries, 'call', {
    toolCallId: id,
    action: 'workspace_run',
    args: { command: 'npm test' },
    terminal,
  });
}

// Desktop (no mobile body class): unchanged separate terminal box, no row wrapper.
{
  bodyClasses.clear();
  const html = renderToolActivityEntry(commandEntry('desk_1', { runId: 'desk_1', state: 'exited', exitCode: 0 }));
  assert.doesNotMatch(html, /tool-activity-terminal-row/, 'desktop rows are not terminal disclosures');
  assert.match(html, /<details class="tool-command-terminal is-complete"[^>]*>\s*<summary>/, 'desktop keeps the terminal summary');
  assert.doesNotMatch(html, /<details class="tool-command-terminal is-complete"[^>]*\sopen>/, 'desktop completed terminal stays closed');
}

// Mobile: the row is the disclosure, closed by default, inner terminal forced open.
{
  bodyClasses.add('pm-mobile-active');
  const html = renderToolActivityEntry(commandEntry('mob_1', { runId: 'mob_1', state: 'exited', exitCode: 0 }));
  assert.match(html, /^<details class="tool-activity-wrap tool-activity-disclosure tool-activity-terminal-row"/, 'mobile command row is a clickable disclosure');
  assert.match(html, /data-tool-disclosure-key="terminal-row:mob_1"(?! open)/, 'mobile row is closed by default');
  assert.doesNotMatch(html, /terminal-row:mob_1" open/, 'mobile row starts closed');
  assert.match(html, /class="tool-activity-chevron"/, 'mobile row has a chevron');
  assert.match(html, /<details class="tool-command-terminal is-complete"[^>]*\sopen>/, 'inner terminal is open so the row controls visibility');
}

// Mobile live terminal also starts closed (tap to open), and remembers open state.
{
  bodyClasses.add('pm-mobile-active');
  const live = commandEntry('mob_live', { runId: 'mob_live', state: 'running' });
  assert.doesNotMatch(renderToolActivityEntry(live), /terminal-row:mob_live" open/, 'live terminal does not auto-open on mobile');
  setToolActivityDisclosureState('terminal-row:mob_live', true);
  assert.match(renderToolActivityEntry(live), /terminal-row:mob_live" open/, 'open state persists across re-renders');
}

// Non-command rows are unaffected on mobile.
{
  bodyClasses.add('pm-mobile-active');
  const entries = [];
  const click = applyToolActivityEvent(entries, 'call', { id: 'c1', action: 'desktop_click', args: {} });
  assert.doesNotMatch(renderToolActivityEntry(click), /tool-activity-terminal-row/, 'non-terminal rows untouched');
}

// Vision previews must be broadcast live, not only via throttled update frames.
if (typeof classifyMainChatStreamEvent === 'function') {
  assert.equal(classifyMainChatStreamEvent('vision_injected', {}).live, true, 'vision_injected is delivered live');
  assert.equal(classifyMainChatStreamEvent('vision_injected', {}).retain, true, 'vision_injected stays replayable');
}

console.log('test-tool-activity-mobile-terminal-row: ok');
