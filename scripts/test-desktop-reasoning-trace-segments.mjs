import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const desktopPath = new URL('../web-ui/src/pages/ChatPage.js', import.meta.url);
const desktop = fs.readFileSync(desktopPath, 'utf8');
const teams = fs.readFileSync(new URL('../web-ui/src/pages/TeamsPage.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  if (name === 'setDesktopLiveProgressNarration') {
    const end = source.indexOf('\nfunction shouldAppendDesktopReasoningSummary', start);
    assert.notEqual(end, -1, `missing end marker for ${name}`);
    return source.slice(start, end);
  }
  const bodyStart = source.indexOf('{', source.indexOf(') {', start));
  assert.notEqual(bodyStart, -1, `missing body for ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const context = {
  appendFinalResponseDelta: (previous, incoming) => `${previous}${incoming}`,
  dedupeDesktopTraceProseText: (value) => String(value || ''),
  normalizeLiveTraceProseText: (value) => String(value || ''),
};
vm.runInNewContext(
  `${extractFunction(desktop, 'setDesktopLiveProgressNarration')}\nthis.setDesktopLiveProgressNarration = setDesktopLiveProgressNarration;`,
  context,
);

const appendTrace = (type, text, options = {}) => {
  testState.liveTraceEntries.push({
    id: `trace_${testState.liveTraceEntries.length}`,
    type,
    text,
    extra: options.extra,
  });
};

const testState = {
  liveTraceEntries: [
    {
      id: 'thought-before-tool',
      type: 'think',
      text: 'Inspecting the request',
      extra: { source: 'agent_progress', visibility: 'summary', reasoningKind: 'summary' },
    },
    { id: 'tool-call', type: 'tool', text: 'Session in browser', activity: { phase: 'start' } },
  ],
};

context.setDesktopLiveProgressNarration(testState, 'Reading the next result', appendTrace);
assert.equal(testState.liveTraceEntries.length, 3, 'a summary after a tool must start a new trace segment');
assert.equal(testState.liveTraceEntries[0].text, 'Inspecting the request', 'the prior thought must not be overwritten');
assert.equal(testState.liveTraceEntries[2].extra.source, 'agent_progress');
assert.equal(testState.liveTraceEntries[2].extra.reasoningKind, 'summary');

context.setDesktopLiveProgressNarration(testState, 'Reading the next result further', appendTrace);
assert.equal(testState.liveTraceEntries.length, 3, 'consecutive summary chunks should reuse the current segment');
assert.equal(testState.liveTraceEntries[2].text, 'Reading the next result further');

assert.match(desktop, /case 'agent_thought':\s*\{[\s\S]{0,100}event\.thinking \|\| event\.text/);
assert.match(desktop, /const hideMutableProgress = isSummaryThought && isLiveThought && Boolean\(progressSummary\)/);
assert.match(teams, /function teamEventSource\(event\)/);
assert.match(teams, /source: isSummary \? 'agent_progress' : 'agent_thought'/);
assert.match(teams, /appendTeamVisibleThought\(teamChatStreamingState, thought, event\)/);

console.log('desktop reasoning trace segmentation regression passed');
