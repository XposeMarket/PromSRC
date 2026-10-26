import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : null;
const read = (path) => ref ? execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }) : fs.readFileSync(path, 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const identity = (text) => text;
const progress = (evt) => evt.visibility || evt.extra?.visibility || (evt.source === 'reasoning_summary' ? 'summary' : 'private');
const desktopReducer = new Function('normalizeLiveTraceProseText', 'dedupeDesktopTraceProseText', 'appendFinalResponseDelta', `${extract(desktop, 'setDesktopLiveProgressNarration')}\nreturn setDesktopLiveProgressNarration;`)(identity, identity, (a, b) => a + b);
const mobileHandlers = new Function('_nowTime', '_appendMobileStreamingText', 'chatProgressVisibility', `${['_setMobileLiveProgressNarration', '_handleMobileThinkingDelta', '_handleMobileReasoningSummaryDelta', '_handleMobileCleanThought'].map((name) => extract(mobile, name)).join('\n')}\nreturn {_setMobileLiveProgressNarration,_handleMobileThinkingDelta,_handleMobileReasoningSummaryDelta,_handleMobileCleanThought};`)(() => 'now', (a, b) => a + b, progress);
const chunks = ['*', '*', 'UPPER', '**', '\n', 'I', '!', '.', '  ', 'repeat', 'repeat', '\n\n', 'Next paragraph', '\n '];
for (const platform of ['desktop', 'mobile']) {
  const state = { liveTraceEntries: [] };
  const append = (type, text, options) => state.liveTraceEntries.push({ type, text, ...options });
  const delta = (text) => platform === 'desktop' ? desktopReducer(state, text, append, { source: 'reasoning_summary', delta: true }) : mobileHandlers._handleMobileReasoningSummaryDelta(state, { type: 'reasoning_summary_delta', text });
  const snapshot = (text) => platform === 'desktop' ? desktopReducer(state, text, append, { source: 'reasoning_summary', replace: true }) : mobileHandlers._handleMobileReasoningSummaryDelta(state, { type: 'reasoning_summary', text });
  chunks.forEach(delta);
  assert.equal(state.liveTraceEntries.length, 1, `${platform}: one active summary`);
  assert.equal(state.liveTraceEntries[0].text, chunks.join(''), `${platform}: exact raw chunks`);
  assert.equal(state.liveTraceEntries[0].extra.source, 'reasoning_summary');
  assert.equal(state.liveTraceEntries[0].extra.visibility, 'summary');
  snapshot('  Complete snapshot\n\nUNCHANGED!  ');
  assert.equal(state.liveTraceEntries[0].text, '  Complete snapshot\n\nUNCHANGED!  ');
  for (const boundary of [{ type: 'tool', text: 'read' }, { type: 'thought', text: 'Visible commentary', extra: { visibility: 'user', source: 'assistant' } }]) {
    const before = structuredClone(state.liveTraceEntries);
    state.liveTraceEntries.push(boundary);
    delta('New'); delta('!');
    assert.deepEqual(state.liveTraceEntries.slice(0, before.length), before, `${platform}: frozen boundary`);
    assert.equal(state.liveTraceEntries.at(-1).text, 'New!');
    assert.equal(state.liveTraceEntries.at(-2).text, boundary.text);
  }
  const generic = { liveTraceEntries: [] };
  const genericAppend = (type, text, options) => generic.liveTraceEntries.push({ type, text, ...options });
  if (platform === 'desktop') desktopReducer(generic, 'Checking status', genericAppend);
  else mobileHandlers._setMobileLiveProgressNarration(generic, 'Checking status');
  assert.equal(generic.liveTraceEntries[0].extra.source, 'agent_progress', 'generic progress unchanged');
}
const privateState = { liveTraceEntries: [] };
mobileHandlers._handleMobileThinkingDelta(privateState, { thinking: 'PRIVATE SECRET' });
assert.deepEqual(privateState.liveTraceEntries, []);
mobileHandlers._handleMobileThinkingDelta(privateState, { thinking: ' SAFE ', visibility: 'summary' });
mobileHandlers._handleMobileThinkingDelta(privateState, { thinking: 'UPPER!', visibility: 'summary' });
assert.equal(privateState.liveTraceEntries[0].text, ' SAFE UPPER!');
assert.equal(privateState.liveTraceEntries[0].extra.source, 'reasoning_summary');
mobileHandlers._handleMobileCleanThought(privateState, { text: '  Snapshot  ', visibility: 'summary' });
assert.equal(privateState.liveTraceEntries[0].text, '  Snapshot  ');
console.log('PASS main-chat reasoning summary: exact deltas, snapshots, boundaries, classification, private thinking, generic progress');

// Execute the real SSE switch and replay switch bodies, not a parallel model.
const sse = read('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js');
const sseStart = sse.indexOf("case 'thinking_delta': {");
const sseEnd = sse.indexOf("case 'agent_thought':", sseStart);
assert.ok(sseStart >= 0 && sseEnd > sseStart);
const runSse = new Function('event', 'streamState', 'appendLiveTrace', 'setDesktopLiveProgressNarration', 'chatProgressVisibility', 'window', 'thisSessionId', `let pendingThinkingBurst = ''; switch(event.type) { ${sse.slice(sseStart, sseEnd)} }`);
const replay = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const replayStart = replay.indexOf("case 'thinking_delta': {", replay.indexOf('function processEntriesFromReplayFrames('));
const replayEnd = replay.indexOf("case 'info':", replayStart);
assert.ok(replayStart >= 0 && replayEnd > replayStart);
const runReplay = new Function('evt', 'replayState', '_handleMobileReasoningSummaryDelta', '_setMobileLiveProgressNarration', 'chatProgressVisibility', `switch(evt.type) { ${replay.slice(replayStart, replayEnd)} }`);
for (const lane of ['desktop SSE', 'mobile replay']) {
  const state = { liveTraceEntries: [] };
  const actualAppend = new Function('isBareThinkingLiveTraceText', 'isDesktopTraceThoughtType', 'desktopTraceThoughtKind', `${extract(desktop, 'appendLiveTraceToStreamState')} return appendLiveTraceToStreamState;`)(() => false, () => true, () => 'summary');
  const send = (evt) => lane === 'desktop SSE'
    ? runSse(evt, state, (type, text, options) => actualAppend(state, type, text, options), desktopReducer, progress, {}, 'fixture')
    : runReplay(evt, state, mobileHandlers._handleMobileReasoningSummaryDelta, mobileHandlers._setMobileLiveProgressNarration, progress);
  ['  ', ...chunks].forEach((text) => send({ type: 'reasoning_summary_delta', text }));
  assert.equal(state.liveTraceEntries[0].text, '  ' + chunks.join(''), `${lane}: actual caller exact chunks`);
  send({ type: 'reasoning_summary', text: '  COMPLETE!  ' });
  assert.equal(state.liveTraceEntries[0].text, '  COMPLETE!  ', `${lane}: actual caller snapshot`);
  state.liveTraceEntries.push({ type: 'tool', text: 'boundary' });
  send({ type: 'thinking_delta', thinking: ' PRIVATE ', visibility: 'private' });
  assert.equal(state.liveTraceEntries.length, 2, `${lane}: private raw thinking hidden`);
  send({ type: 'thinking_delta', thinking: ' SAFE ', source: 'reasoning_summary', visibility: 'summary' });
  assert.equal(state.liveTraceEntries.at(-1).text, ' SAFE ');
  assert.equal(state.liveTraceEntries[0].text, '  COMPLETE!  ', `${lane}: boundary frozen`);
}
console.log('PASS actual desktop SSE and mobile replay callers: exact raw deltas, complete snapshot, privacy, frozen tool boundaries');
