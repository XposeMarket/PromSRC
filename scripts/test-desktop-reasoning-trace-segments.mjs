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

const renderContext = {
  liveTraceGroups(entries) {
    const groups = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const kind = entry?.activity
        ? 'tools'
        : String(entry?.extra?.source || '').toLowerCase() === 'agent_progress'
          ? 'thought-summary'
          : 'thought';
      const previous = groups.at(-1);
      if (previous?.kind === kind) previous.entries.push(entry);
      else groups.push({ kind, entries: [entry] });
    }
    return groups.map((group, index) => ({ ...group, id: `${group.kind}-${index}` }));
  },
  isDesktopMutableProgressTraceEntry: (entry) => String(entry?.extra?.source || '').toLowerCase() === 'agent_progress',
  desktopTraceProgressSummary: (entries) => [...(Array.isArray(entries) ? entries : [])]
    .reverse()
    .find((entry) => String(entry?.extra?.source || '').toLowerCase() === 'agent_progress')?.text || '',
  desktopTraceThoughtTextsSimilar: (left, right) => String(left || '') === String(right || ''),
  isDesktopTraceThoughtType: (type) => ['preamble', 'think', 'assistant'].includes(String(type || '').toLowerCase()),
  isDesktopTraceReasoningSummaryType: () => false,
  visibleLiveTraceEntries: (entries) => Array.isArray(entries) ? entries : [],
  renderLiveTraceEntry: (entry) => `<span>${String(entry?.text || '')}</span>`,
  renderLiveTraceList: (entries) => `<div>${(Array.isArray(entries) ? entries : []).map((entry) => `<span>${String(entry?.text || '')}</span>`).join('')}</div>`,
  renderLiveTraceCompactionBreak: () => '',
  renderLiveTracePreview: () => '',
  renderToolActivityIcon: () => '',
  liveTraceCurrentToolLabel: (entries) => entries?.[0]?.text || 'Tool',
  liveTraceToolSummary: (entries) => entries?.[0]?.text || 'Tool',
  liveTraceSummaryKey: (text) => String(text || ''),
  renderThinkingState: (text) => String(text || ''),
  escHtml: (text) => String(text || ''),
};
vm.runInNewContext(
  `${extractFunction(desktop, 'renderLiveTurnTrace')}`
    + '\nthis.renderLiveTurnTrace = renderLiveTurnTrace;',
  renderContext,
);

const renderedThoughtBeforeTool = renderContext.renderLiveTurnTrace([
  { id: 'summary-before-tool', type: 'think', text: 'Planning the next step', extra: { source: 'agent_progress' } },
  { id: 'tool-call', type: 'tool', text: 'Session in browser', activity: { kind: 'operation', action: 'browser_open' } },
], { streaming: true });
assert.match(renderedThoughtBeforeTool, /Planning the next step/, 'a tool event must not erase the preceding thought group');
assert.match(renderedThoughtBeforeTool, /Session in browser/, 'the tool group must remain rendered after a thought');
assert.equal((renderedThoughtBeforeTool.match(/data-live-trace-group=/g) || []).length, 2, 'thought and tool must remain separate keyed groups');

assert.match(desktop, /case 'agent_thought':\s*\{[\s\S]{0,100}event\.thinking \|\| event\.text/);
assert.match(desktop, /const hideMutableProgress = isSummaryThought && isLiveThought && Boolean\(progressSummary\)/);
assert.match(desktop, /const latestTraceEntry = Array\.isArray\(entries\) \? entries\.at\(-1\) : null/);
assert.match(desktop, /const activeProgressSummary = streaming && isDesktopMutableProgressTraceEntry\(latestTraceEntry\)/);
assert.doesNotMatch(desktop, /groups = groups\.filter\(\(group\) => !\([\s\S]{0,220}activeProgressSummary/,
  'an old progress summary must not remove a completed thought group when a tool follows it');
assert.match(teams, /function teamEventSource\(event\)/);
assert.match(teams, /source: isSummary \? 'agent_progress' : 'agent_thought'/);
assert.match(teams, /appendTeamVisibleThought\(teamChatStreamingState, thought, event\)/);

console.log('desktop reasoning trace segmentation regression passed');
