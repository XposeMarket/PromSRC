// Regression: switching back into a running chat on desktop must not wipe or
// detach the live tool trace (#512 snapshot handler did both).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const start = src.indexOf("wsEventBus.on('session_stream_snapshot'");
assert(start > 0, 'desktop snapshot handler exists');
const end = src.indexOf("wsEventBus.on('session_activity'", start);
const handler = src.slice(start, end);

// 1. A turn this tab streams over SSE is never reset by a snapshot: the SSE
//    runtime holds the state object by reference and would freeze.
const guard = handler.indexOf('if (!desktopStreamStateHasLocalTurn(sid, streamId))');
const reset = handler.indexOf('resetSessionStreamState(sid)');
assert(guard > 0, 'snapshot only resets state when the tab has no local turn');
assert(reset > guard, 'resetSessionStreamState is inside the no-local-turn branch');
assert(/function desktopStreamStateHasLocalTurn[\s\S]{0,120}desktopSessionHasLocalSseTurn\(sid\)/.test(src),
  'a local SSE turn always counts as a local turn');
assert(/function desktopSessionHasLocalSseTurn[\s\S]{0,80}_sessionAbortControllers/.test(src),
  'local SSE turns are detected by their abort controller');

// 2. Snapshot tools become real tool-activity rows, never flat placeholder rows.
assert(!/processLog\.push\([^)]*_pmStreamSnapshot: true/.test(handler), 'no flat placeholder process rows');
assert(handler.includes("applyToolActivityToStreamState(state, 'call'"), 'calls become tool rows');
assert(handler.includes("applyToolActivityToStreamState(state, 'result'"), 'results attach to tool rows');

// 3. The authoritative rebuild replays the retained stream without rendering per frame
//    and without duplicating persisted process/history rows.
const replay = src.slice(src.indexOf('async function rebuildDesktopStreamFromReplay'), start);
assert(replay.includes('suppressRender: true'), 'replay renders once, not per frame');
assert(replay.includes('sess.processLog.length = logLength'), 'replay rolls back appended process rows');
assert(replay.includes('sess.history.length = historyLength'), 'replay rolls back appended history rows');
assert(replay.includes('desktopSessionHasLocalSseTurn(sid)'), 'replay never runs over a local SSE turn');
assert(/if \(!window\._sessionThinking\?\.\[sid\] \|\| sess\.activeRun !== true\) return false;/.test(replay),
  'replay never revives a run that finished while the request was in flight');
assert(replay.indexOf('sess.activeRun !== true') < replay.indexOf('window._sessionStreamState[sid] = fresh'),
  'finished-run guard runs before the state swap');
assert(/options\.suppressRender === true\) return;/.test(src), 'stream handler honours suppressRender');

// 4. Behavioural check of the swap semantics on a tiny model of the state map.
const stateMap = {};
const sseRef = (stateMap.s1 = { liveTraceEntries: [{ id: 'a' }], streamingAIText: '' });
const abortControllers = { s1: {} };
const hasLocalSse = (sid) => !!abortControllers[sid];
const onSnapshot = (sid) => { if (!hasLocalSse(sid)) stateMap[sid] = { liveTraceEntries: [] }; };
onSnapshot('s1');
sseRef.liveTraceEntries.push({ id: 'b' });
assert.equal(stateMap.s1, sseRef, 'SSE runtime and window share the same state after a switch');
assert.equal(stateMap.s1.liveTraceEntries.length, 2, 'trace keeps growing after the switch');

console.log('[test-desktop-stream-snapshot] snapshot keeps live trace, rebuilds tool rows, never detaches SSE state');
