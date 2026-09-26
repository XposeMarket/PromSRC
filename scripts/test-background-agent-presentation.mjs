import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { applyToolActivityEvent, coalesceToolActivityEntries, renderToolActivityEntry, toolActivitySummary } from '../web-ui/src/tool-activity.js';
import { normalizeBackgroundAgentWork, resolveBackgroundAgentIdentity } from '../web-ui/src/features/chat/core/background-agent-work.js';

globalThis.window = { addEventListener() {} };
const { createMobileChatRendererRuntime } = await import('../web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const { loadToolActivityFeature } = await import('../web-ui/src/features/chat/optional/tool-activity-runtime.js');
await loadToolActivityFeature();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { activeSessionId: 'main', mainPlanProgress: {} };
const persisted = new Map();
const appendTrace = (message, type, text, options = {}) => {
  (message.liveTraceEntries ||= []).push({ type, text, ...options });
};
const runtime = createMobileChatRendererRuntime({
  ICONS: {}, _formatTimeAgo: () => '',
  _isMobileVoiceTraceTurn: () => false,
  _mobileWorkflowTraceEntriesForMessage: message => message.liveTraceEntries || [],
  _renderMobileWorkTimer: () => '<div data-expandable="trace">Working for 1s</div>',
  _renderMobileMarkdown: text => `<p>${escapeHtml(text)}</p>`,
  _collectMessageMedia: () => [],
  _renderMobileRichArtifacts: () => '', _renderMobileProductCarousel: () => '',
  _renderMobileMediaGallery: () => '', _renderMobileFileChanges: () => '', _renderMobileThreadLinkArtifacts: () => '',
  _isMobileGenerateImageToolName: () => false, _isMobileGenerateVideoToolName: () => false,
  _isMobileExplicitMediaToolName: () => false,
  _dedupeMobileTraceProseText: text => String(text || '').trim(),
  _isMobileBareThinkingTraceText: () => false, _isMobileImageGenerationStreamEntry: () => false,
  _isMobileTraceReasoningSummaryType: type => type === 'reasoning_summary',
  _isMobileTraceThoughtFragmentText: () => false,
  _isMobileTraceThoughtType: type => ['preamble', 'think', 'assistant', 'reasoning_summary'].includes(type),
  _isMobileUserVisibleReasoningTraceEntry: entry => ['user', 'summary'].includes(entry.extra?.visibility),
  _isMobileVisionInjectionStatusText: () => false,
  _mobileTraceComparableText: text => String(text || '').toLowerCase(),
  _mobileTraceThoughtTextsSimilar: (a, b) => a === b,
  _renderMobileLiveTracePreview: entry => entry.preview ? `<img src="${escapeHtml(entry.preview.dataUrl)}" alt="Preview">` : '',
  __pmChat: state, wsEventBus: { on() {} }, mobileSourceState: {},
  findBackgroundAgentWork: id => persisted.get(id),
  persistBackgroundAgentWork: record => persisted.set(record.id, normalizeBackgroundAgentWork(record)),
  resolveBackgroundAgentIdentity,
  _mobileBackgroundSpawnIdFromSessionId: sid => String(sid).startsWith('background_') ? String(sid).slice(11) : '',
  _mobileBackgroundStoredProcessEntries: record => record?.events || [],
  _mergeMobileProcessEntries: () => {},
  _maybeFlushMobileThinkingBeforeEvent: () => {},
  _appendMobileLiveTrace: appendTrace,
  _appendMobileVisionTrace: (message, evt) => appendTrace(message, 'vision', evt.label, { preview: evt.preview }),
  _applyMobileToolActivity: (message, phase, evt) => applyToolActivityEvent(message.liveTraceEntries ||= [], phase, evt),
  _appendMobileProcess: (message, type, text, extra) => (message.processEntries ||= []).push({ type, text, extra }),
  _handleMobileReasoningSummaryDelta: (message, evt) => { appendTrace(message, 'think', evt.text, { extra: { source: 'agent_progress', visibility: 'summary' } }); return true; },
  _mergeMobileRichArtifacts: () => {},
  beginFinalResponse: message => { message.finalResponseStarted = true; },
  appendFinalResponseDelta: (text, chunk) => text + chunk,
  reconcileFinalResponse: (_, text) => text,
  _nowTime: () => '12:00', escapeHtml,
});

// Full assignments must survive every partial status/replay update, including
// cold hydration from durable work and more than one spawn in a recovery batch.
const fullPrompt = 'Inspect the background agent task. '.repeat(45) + 'END OF ASSIGNMENT';
runtime._upsertMobileBackgroundSpawnLane({ bgId: 'prompt-test', taskPrompt: fullPrompt }, 'main');
for (let poll = 0; poll < 4; poll += 1) {
  runtime._applyMobileBackgroundSpawnStatus({ id: 'prompt-test', state: 'running', promptPreview: fullPrompt.slice(0, 160) }, 'main');
  runtime._upsertMobileBackgroundSpawnLane({ bgId: 'prompt-test', taskPrompt: fullPrompt.slice(0, 250) }, 'main');
  assert.equal(runtime._mobileBackgroundSpawnLanes()['prompt-test'].prompt, fullPrompt);
}
persisted.set('cold-prompt', normalizeBackgroundAgentWork({ id: 'cold-prompt', sessionId: 'main', task: fullPrompt }));
runtime._applyMobileBackgroundSpawnStatus({ id: 'cold-prompt', state: 'running', promptPreview: fullPrompt.slice(0, 160) }, 'main');
assert.equal(runtime._mobileBackgroundSpawnLanes()['cold-prompt'].task, fullPrompt);
const nextPrompt = 'Second unrelated assignment. '.repeat(30).trim();
const recoveredPrompts = runtime._collectMobileBackgroundSpawnRecoveries([
  { type: 'tool_call', data: { action: 'background_spawn', args: { prompt: fullPrompt } } },
  { type: 'tool_result', data: { action: 'background_spawn', result: { id: 'recovered-first', promptPreview: fullPrompt.slice(0, 160) } } },
  { type: 'tool_call', data: { action: 'background_spawn', args: { prompt: nextPrompt } } },
  { type: 'tool_result', data: { action: 'background_spawn', result: { id: 'recovered-second', promptPreview: nextPrompt.slice(0, 160) } } },
], 'main');
assert.equal(recoveredPrompts[0].prompt, fullPrompt);
assert.equal(recoveredPrompts[1].prompt, nextPrompt);

// A server status cursor is not a receipt. Cold-open must consume earlier frames.
runtime._applyMobileBackgroundSpawnStatus({ id: 'a', state: 'running', model: 'gpt-6-astra', providerId: 'openai', reasoningEffort: 'high', stream: { streamId: 'run1', lastSeq: 90 } }, 'main');
const lane = runtime._mobileBackgroundSpawnLanes().a;
assert.equal(lane.lastSeq, 0);
function send(seq, type, data = {}, streamId = 'run1') {
  return runtime._pushMobileBackgroundSpawnEvent({ bgId: 'a', spawnerSessionId: 'main', eventType: type, streamId, seq, ...data }, 'main');
}
send(1, 'token', { text: 'I found the capture path.' });
send(2, 'tool_call', { action: 'desktop_act', toolCallId: 'click1', args: { action: 'click', window: 'ChatGPT', x: 20, y: 30 } });
assert.equal(lane, runtime._mobileBackgroundSpawnLanes().a, 'replay and checkpoint keep the same lane reference');
assert.equal(lane.message.content, '', 'pre-tool answer becomes commentary');
assert.equal(lane.message.liveTraceEntries[0].text, 'I found the capture path.');
assert.equal(lane.message.liveTraceEntries[0].extra.source, 'agent_thought');
send(3, 'reasoning_summary_delta', { text: 'Checking the next capture.' });
send(4, 'progress_state', { source: 'declared', items: [{ text: 'Inspect', status: 'done' }, { text: 'Verify', status: 'in_progress' }], activeIndex: 1 });
send(5, 'vision_injected', { source: 'media_analysis', label: 'Video sample 1', preview: { dataUrl: '/api/canvas/inline?path=frozen.png', artifactKind: 'sample_frame' } });
assert.equal(lane.plan.steps[1].status, 'in_progress');
assert.equal(lane.plan.activeIndex, 1);
assert.equal(lane.message.liveTraceEntries.at(-1).preview.artifactKind, 'sample_frame');
assert.equal(send(5, 'vision_injected', { label: 'Duplicate' }), false);
assert.equal(lane.lastSeq, 5);
runtime._applyMobileBackgroundSpawnStatus({ id: 'a', state: 'running', stream: { streamId: 'run1', lastSeq: 120 } }, 'main');
assert.equal(lane.lastSeq, 5, 'polling must not skip unread events');
runtime._flushMobileBackgroundWorkPersistence();
const saved = persisted.get('a');
assert.equal(saved.model, 'gpt-6-astra');
assert.equal(saved.reasoningEffort, 'high');
assert.equal(saved.plan.steps.length, 2);
assert.equal(saved.liveTraceEntries.at(-1).preview.dataUrl, '/api/canvas/inline?path=frozen.png');
const rendered = runtime._renderMobileAgentChatBubble({ ...lane.message, traceExpanded: true }, { sender: 'Juno', live: true, backgroundAgentId: 'a' });
assert.match(rendered, /I found the capture path/);
assert.match(rendered, /Checking the next capture/);
assert.match(rendered, /frozen\.png/);
const flatTrace = lane.message.liveTraceEntries.filter(entry => entry.extra?.source !== 'agent_progress');
const flatRendered = runtime._renderMobileAgentChatBubble({ ...lane.message, liveTraceEntries: flatTrace, traceExpanded: true }, { sender: 'Juno', live: true, backgroundAgentId: 'a' });
assert.match(flatRendered, /pm-trace-tool-rows pm-trace-tool-body/);
assert.doesNotMatch(flatRendered, /<details class="pm-trace-tool-group"/, 'work timer exposes rows without another generic disclosure');
send(1, 'tool_call', { action: 'write_note', args: { content: 'Restart recovered.' } }, 'run2');
assert.equal(lane.lastSeq, 1, 'new streams start with a fresh receipt cursor');
assert.equal(lane.message.liveTraceEntries.length, 1);
runtime._flushMobileBackgroundWorkPersistence();

for (const [action, args, expected, detail] of [
  ['background_ops', { action: 'wait', background_ids: ['a', 'b'], wait_ms: 30000 }, /Waiting for 2 agents for up to 30 s/, /30 seconds/],
  ['background_ops', { action: 'steer', background_id: 'a', message: 'Please check **capture timing**.' }, /Messaging 1 agent/, /capture timing/],
  ['background_ops', { action: 'spawn', prompt: 'Inspect the image.' }, /Starting background agent/, /Inspect the image/],
  ['desktop_act', { action: 'click', window: 'ChatGPT', x: 30, y: 45 }, /Clicking ChatGPT/, /30, 45/],
  ['browser_act', { action: 'click', url: 'https://x.com/home', label: 'Bookmarks' }, /Clicking “Bookmarks” on x.com/, /Bookmarks/],
  ['browser_act', { action: 'scroll', url: 'https://x.com/home', direction: 'down' }, /Scrolling on x.com/, /down/],
  ['write_note', { content: '## Findings\n\nCapture takes **40 ms**.' }, /Writing note/, /40 ms/],
]) {
  const entries = [];
  const entry = applyToolActivityEvent(entries, 'call', { action, args, toolCallId: action });
  assert.match(entry.text, expected);
  assert.match(toolActivitySummary(entries, { live: true }), expected);
  const html = renderToolActivityEntry(entry);
  assert.match(html, /<details/);
  assert.match(html, detail);
  assert.doesNotMatch(html, /&quot;action&quot;|\[object Object\]/);
}
const malicious = applyToolActivityEvent([], 'call', { action: 'write_note', args: { content: '<img src=x onerror=alert(1)>' } });
assert.doesNotMatch(renderToolActivityEntry(malicious), /<img src=x/);

// Extract small DOM owners from production for both geometry checks and the
// browser fixture. The fixture uses the actual disclosure handler and styles.
function extract(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.set(node.name.text, node.getText(source).replace(/^export /, ''));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return names.map(name => { assert.ok(functions.has(name), name); return functions.get(name); }).join('\n');
}
const pageFile = 'web-ui/src/mobile/mobile-chat-page-runtime.js';
const snapshotMerge = extract(pageFile, ['_mergeMobileBackgroundAgentSessionSnapshot']);
const snapshotContext = {
  mergeBackgroundAgentSteerMessages: (a, b) => [...(a || []), ...b],
  _normalizeMobileProcessEntry: entry => entry,
  _mapServerHistoryToMobile: () => [],
  _mergeMobileWorkflowTraceFromProcessEntries() {},
  persistBackgroundAgentWork() {},
  _mobileBackgroundSpawnWorkRecord: lane => lane,
};
vm.createContext(snapshotContext);
vm.runInContext(snapshotMerge, snapshotContext);
const coldLane = { id: 'cold', message: {}, task: fullPrompt.slice(0, 160), prompt: fullPrompt.slice(0, 160) };
assert.equal(snapshotContext._mergeMobileBackgroundAgentSessionSnapshot(coldLane, { history: [
  { role: 'user', content: 'Do not treat steer text as the assignment.', messageKind: 'background_agent_steer' },
  { role: 'user', content: fullPrompt, backgroundAgentId: 'cold' },
] }), true);
assert.equal(coldLane.prompt, fullPrompt, 'cold session snapshot restores the complete initial assignment');

const geometry = extract(pageFile, ['syncMobileSideSheetViewport']);
const vars = {};
const sideInput = {};

const sandbox = {
  document: { activeElement: null },
  sideInput,
  sideComposer: { getBoundingClientRect: () => ({ height: 54 }) },
  window: { innerHeight: 844, visualViewport: { height: 844, offsetTop: 0 } },
  sideSheet: { classList: { contains: () => true }, getBoundingClientRect: () => ({ top: 0, bottom: 844 }), style: { setProperty: (k, v) => { vars[k] = v; } } },
  page: { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }) },
};
vm.createContext(sandbox);
vm.runInContext(geometry, sandbox);
sandbox.syncMobileSideSheetViewport();
assert.equal(vars['--pm-side-top'], '108px');
assert.equal(vars['--pm-side-bottom'], '0px');
sandbox.window.visualViewport.height = 460;
sandbox.syncMobileSideSheetViewport();
assert.equal(vars['--pm-side-bottom'], '0px', 'viewport chrome alone does not lift the panel');
sandbox.document.activeElement = sideInput;
sandbox.syncMobileSideSheetViewport();
assert.equal(vars['--pm-side-bottom'], '384px', 'sheet ends at keyboard edge');
sandbox.window.visualViewport.offsetTop = 25;
sandbox.syncMobileSideSheetViewport();
assert.equal(vars['--pm-side-bottom'], '359px', 'Safari viewport panning is included');

if (process.argv.includes('--write-fixture')) {
  const rows = [];
  for (const [action, args] of [['background_ops', { action: 'steer', background_id: 'a', message: 'Check **capture timing**.\n\n- Read the latest frame\n- Record the elapsed time' }], ['write_note', { content: '## Capture check\n\nThe image arrived in **40 ms**.' }], ['desktop_act', { action: 'click', window: 'ChatGPT', x: 30, y: 45 }]]) {
    applyToolActivityEvent(rows, 'call', { action, args, toolCallId: action });
    applyToolActivityEvent(rows, 'result', { action, args, toolCallId: action, result: 'ok' });
  }
  const displayRows = coalesceToolActivityEntries(rows);
  const css = `@layer tokens, shell, route, components, state, compatibility; @layer route {${fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8')}}\n${fs.readFileSync('web-ui/src/styles/mobile-composer-stack.css', 'utf8')}`;
  const script = extract(pageFile, ['syncMobileSideSheetViewport', 'renderMobileSideSheetPlan']);
  const markdownScript = extract('web-ui/src/utils.js', ['escHtml', 'sanitizeHtml', 'renderMd']);
  const { buildSync } = await import('esbuild');
  const toolScript = buildSync({ stdin: { contents: `import { renderToolActivityEntry } from './web-ui/src/tool-activity.js'; window.renderToolActivityEntry = renderToolActivityEntry;`, resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false }).outputFiles[0].text;
  const renderer = fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js', 'utf8');
  // CRLF-independent extraction of the production work timer's handlers.
  const normalized = renderer.replace(/\r\n/g, '\n');
  const handlerStart = normalized.indexOf("threadEl.addEventListener('click', (event) => {\n      const timerEl = event.target?.closest?.('[data-expandable=\"trace\"]');");
  assert.ok(handlerStart > 0);
  const handler = normalized.slice(handlerStart, normalized.indexOf('const beginReveal', handlerStart));
  const photo = fs.existsSync('artifacts/media-analysis-sheet.png') ? `data:image/png;base64,${fs.readFileSync('artifacts/media-analysis-sheet.png').toString('base64')}` : '';
  fs.writeFileSync('artifacts/background-agent-presentation.html', `<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Background agent verification</title><style>${css}
  :root{--pm-text:#eee;--pm-muted:#aaa;--pm-surface:#19191b;--pm-surface-strong:#222;--pm-border:#444;--pm-tabbar-h:56px}body{margin:0;background:#080808;color:#eee;font:15px system-ui}.pm-header{position:fixed;top:38px;left:12px;right:12px;height:42px}.pm-app{height:100vh}.pm-composer{background:#303033;border-radius:28px}.pm-trace-tool-body{padding:0}.pm-send{background:#be9b48;color:white;border-radius:50%}.pm-mobile-side-plan[hidden]{display:none}
  </style><body class="pm-mobile-active"><div class="pm-app"><main class="pm-page"><header class="pm-header">☰　Claude Fable 5.1 High　　⋯</header><div class="pm-tabbar">Main navigation</div>
  <div class="pm-mobile-side-sheet background-agent-detail-mode open" role="dialog"><section class="pm-mobile-side-panel"><div class="pm-mobile-side-handle"></div><header class="pm-mobile-side-header"><div class="pm-mobile-side-title-wrap"><strong>Juno</strong><span>GPT-6 Astra High</span></div><button class="pm-mobile-side-close">×</button></header><div class="pm-mobile-side-thread"><div class="pm-msg from-user"><div class="pm-bubble">Check the capture path and show what you find.</div></div><div class="pm-msg from-ai pm-agent-chat-msg" data-pm-background-agent-message="a"><div class="pm-bubble"><span class="pm-sender">Juno</span><div class="pm-work-timer expanded" data-expandable="trace" role="button" tabindex="0" aria-expanded="true">Working for 32s　⌄</div><div class="pm-trace-drawer open" data-trace-completed="1"><p>I found the capture path. Checking the next frame.</p><div class="pm-trace-tool-body">${displayRows.map(row => renderToolActivityEntry(row)).join('')}</div>${photo ? `<figure class="pm-live-vision-preview"><img style="max-width:100%" src="${photo}" alt="Analyzed video contact sheet"></figure>` : ''}</div></div></div></div><div class="pm-mobile-side-plan" id="pm-mobile-side-plan"></div><form class="pm-composer pm-mobile-side-composer"><div class="pm-composer-row"><button class="pm-icon-btn" type="button">＋</button><div class="pm-composer-input-wrap"><textarea class="pm-composer-input" placeholder="Steer Juno directly"></textarea></div><button class="pm-send" type="button">↑</button></div></form></section></div></main></div>
  <script src="../web-ui/vendor/marked/marked.min.js"></script><script src="../node_modules/dompurify/dist/purify.min.js"></script><script>${markdownScript}\nwindow.renderMd=renderMd;${toolScript}\ndocument.querySelector('.pm-trace-tool-body').innerHTML=${JSON.stringify(displayRows)}.map(row=>window.renderToolActivityEntry(row)).join('');const page=document.querySelector('.pm-page'),sideSheet=document.querySelector('.pm-mobile-side-sheet'),threadEl=document.querySelector('.pm-mobile-side-thread'),sideInput=document.querySelector('.pm-composer-input'),sideComposer=document.querySelector('.pm-mobile-side-composer'),sideState={},escapeHtml=${escapeHtml.toString()},_materializeMobileCompletedTrace=()=>{},__pmChat={};${script}\n${handler}\nsyncMobileSideSheetViewport();renderMobileSideSheetPlan(${JSON.stringify(saved)});window.addEventListener('resize',syncMobileSideSheetViewport);window.visualViewport?.addEventListener('resize',syncMobileSideSheetViewport);</script></body></html>`);
}
console.log('[background presentation] replay cursor, commentary, model, plan, previews, readable details and keyboard geometry passed');
