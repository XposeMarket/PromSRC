import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatProgressVisibility } from '../web-ui/src/features/chat/trace-visibility.js';

const source = fs.readFileSync('web-ui/src/mobile/mobile-pages.js', 'utf8');
const renderer = fs.readFileSync('web-ui/src/mobile/mobile-chat-renderer-runtime.js', 'utf8');
const mobileCss = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
const generatedMobileCss = fs.readFileSync('generated/public-web-ui/static/styles/mobile.css', 'utf8');

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `could not locate ${name}`);
  return source.slice(start, end);
}

const transientEntry = new Function(
  `${functionSource('_isMobileTransientReasoningTraceEntry', '_mobileDurableReasoningEntries')}`
  + `${functionSource('_mobileDurableReasoningEntries', '_setMobileLiveProgressNarration')}`
  + 'return { _isMobileTransientReasoningTraceEntry, _mobileDurableReasoningEntries };',
)();

const handlers = new Function(
  'chatProgressVisibility',
  '_nowTime',
  '_appendMobileStreamingText',
  '_dedupeMobileTraceProseText',
  '_mobileTraceThoughtTextsSimilar',
  '_appendMobileLiveTrace',
  '_pushMobileStreamProcessEntry',
  `${functionSource('_setMobileLiveProgressNarration', '_handleMobileThinkingDelta')}`
  + `${functionSource('_handleMobileReasoningSummaryDelta', '_handleMobileCleanThought')}`
  + `${functionSource('_handleMobileCleanThought', '_handleMobileThinkingCallback')}`
  + 'return { _setMobileLiveProgressNarration, _handleMobileReasoningSummaryDelta, _handleMobileCleanThought };',
)(
  chatProgressVisibility,
  () => '12:00:00',
  (existing, chunk) => `${existing}${chunk}`,
  (value) => String(value || '').trim(),
  () => false,
  (message, type, text, { extra } = {}) => {
    message.liveTraceEntries.push({ type, text, extra });
  },
  (message, type, text, extra) => {
    message.processEntries.push({ type, text, extra });
  },
);

const message = { liveTraceEntries: [], processEntries: [], _thinking: '' };
handlers._handleMobileReasoningSummaryDelta(message, {
  type: 'reasoning_summary_delta',
  text: 'Launching parallel H3 Max queries',
});
handlers._handleMobileCleanThought(message, {
  type: 'agent_thought',
  visibility: 'summary',
  text: 'Launching parallel H3 Max queries',
});
handlers._handleMobileCleanThought(message, {
  type: 'agent_thought',
  reasoningKind: 'summary',
  text: 'Investigating H3 Max model licensing',
});
handlers._handleMobileReasoningSummaryDelta(message, {
  type: 'reasoning_summary_delta',
  text: 'Investigating H3 Max model licensing',
});

const progressEntries = message.liveTraceEntries.filter((entry) => entry.extra?.source === 'agent_progress');
assert.equal(progressEntries.length, 1, 'summary updates must reuse one mutable progress entry');
assert.equal(progressEntries[0].text, 'Investigating H3 Max model licensing');
assert.equal(message.processEntries.length, 0, 'summary packets must never enter the durable thought journal');
assert.equal(message._thinking, '', 'summary packets must not enter cached thinking text');

handlers._handleMobileCleanThought(message, {
  type: 'agent_thought',
  text: 'I will compare the public model claims with primary sources.',
});
assert.equal(message.processEntries.length, 1, 'full thoughts must remain journaled');
assert.equal(message.processEntries[0].text, 'I will compare the public model claims with primary sources.');

// A later summary starts a new replaceable slot instead of reaching back into
// the completed summary, and a thought that resembles the summary remains a
// separate durable surface.
const boundaryMessage = { liveTraceEntries: [], processEntries: [], _thinking: '' };
handlers._handleMobileReasoningSummaryDelta(boundaryMessage, {
  type: 'reasoning_summary_delta',
  text: 'Investigating H3 Max model licensing',
});
handlers._handleMobileCleanThought(boundaryMessage, {
  type: 'agent_thought',
  reasoningKind: 'full_thought',
  text: 'Investigating H3 Max model licensing',
});
handlers._handleMobileReasoningSummaryDelta(boundaryMessage, {
  type: 'reasoning_summary_delta',
  text: 'Checking the next source now',
});
const progressAfterThought = boundaryMessage.liveTraceEntries.filter((entry) => entry.extra?.source === 'agent_progress');
assert.equal(progressAfterThought.length, 2, 'a summary after a thought must get a new mutable progress slot');
assert.equal(boundaryMessage.liveTraceEntries.filter((entry) => entry.extra?.reasoningKind === 'full_thought').length, 1,
  'full thoughts after summaries must remain durable and distinct');

const durable = transientEntry._mobileDurableReasoningEntries([
  ...message.liveTraceEntries,
  { type: 'think', text: 'Launching parallel H3 Max queries', extra: { source: 'reasoning_summary' } },
  ...message.processEntries,
]);
assert.ok(durable.some((entry) => entry.extra?.source === 'agent_progress'),
  'cache must retain explicit public summary prose across reopening');
assert.ok(durable.some((entry) => entry.text === message.processEntries[0].text),
  'cache must retain full thought surfaces too');

assert.match(renderer, /const bodyEntries = group\.entries;/,
  'safe summary prose must remain visible inside its chronological segment');
assert.doesNotMatch(source, /_appendMobileReasoningSummary/,
  'the mobile stream must not retain a second durable reasoning-summary writer');
assert.match(renderer, /return '';/, 'progress summary fallback must stay empty when no mutable slot exists');

for (const css of [mobileCss, generatedMobileCss]) {
  assert.match(css, /\.pm-msheet\.is-reasoning \.pm-reasoning-control\s*\{[\s\S]*?width: min\(100%, calc\(100vw - max\(var\(--pm-mobile-chrome-inset, 22px\)/,
    'mobile reasoning control must use the same inset-based width calculation as the tab bar');
  assert.match(css, /\.pm-msheet\.is-reasoning \.pm-reasoning-control\s*\{[\s\S]*?transform: scale\(\.85\);/,
    'mobile reasoning control must be visually 15 percent smaller while staying centered');
  assert.match(css, /\.pm-msheet\.is-reasoning \.pm-reasoning-track\s*\{[\s\S]*?height: 56px;/,
    'mobile reasoning track must match the tab bar height');
  assert.match(css, /\.pm-msheet\.is-reasoning \.pm-reasoning-fill::after\s*\{[\s\S]*?width: 54px;[\s\S]*?height: 54px;[\s\S]*?top: 50%;[\s\S]*?transform: translateY\(-50%\);[\s\S]*?border-radius: 50%;/,
    'mobile reasoning thumb must be a slightly enlarged circular cap');
}

console.log('mobile reasoning-summary lifecycle regression passed');

// Background details and the main conversation must share the exact grouping
// algorithm, including public summary bodies and replacement-vs-delta semantics.
function rendererFunction(name, nextName) {
  const start = renderer.indexOf(`function ${name}(`);
  const end = renderer.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return renderer.slice(start, end);
}
const groupTrace = new Function(
  '_mobileVisibleTraceEntries', '_isMobileTraceCompactionEntry',
  '_renderMobileLiveTracePreview', '_isMobileTraceThoughtEntry',
  '_mobileTraceThoughtKind', '_isMobileMutableProgressTraceEntry',
  '_mobileTraceGroupStableKey',
  `${rendererFunction('_mobileTraceGroups', '_mobileTraceHasToolGroup')}return _mobileTraceGroups;`,
)(
  (entries) => entries, () => false, () => '',
  (entry) => entry.type === 'think', () => 'summary',
  (entry) => entry.extra?.source === 'agent_progress',
  (group, index) => `group_${index}`,
);
const background = { liveTraceEntries: [], processEntries: [] };
handlers._handleMobileReasoningSummaryDelta(background, {
  type: 'reasoning_summary', text: 'Inspecting target\nChecking the current file content.',
});
background.liveTraceEntries.push({ type: 'tool', text: 'Read file' });
handlers._handleMobileReasoningSummaryDelta(background, {
  type: 'reasoning_summary', text: 'Updating provider\nApplying the verified change.',
});
background.liveTraceEntries.push({ type: 'tool', text: 'Write file' });
const groups = groupTrace(background.liveTraceEntries);
assert.equal(groups.length, 4, 'summary/tool/summary/tool must create four inline segments');
assert.deepEqual(groups.map((group) => group.kind), ['thought-summary', 'tools', 'thought-summary', 'tools']);
assert.match(groups[0].entries[0].text, /Checking the current file content/);
assert.match(groups[2].entries[0].text, /Applying the verified change/);
assert.deepEqual(groupTrace(JSON.parse(JSON.stringify(background.liveTraceEntries))).map((group) => group.kind),
  groups.map((group) => group.kind), 'serialized/reopened traces must retain the same boundaries');
const latestSummary = [...background.liveTraceEntries].reverse().find((entry) => entry.extra?.source === 'agent_progress').text;
assert.match(latestSummary, /^Updating provider/);
assert.doesNotMatch(latestSummary, /Inspecting target/);
const replacement = { liveTraceEntries: [], processEntries: [] };
handlers._handleMobileReasoningSummaryDelta(replacement, { type: 'reasoning_summary', text: 'Old title' });
handlers._handleMobileReasoningSummaryDelta(replacement, { type: 'reasoning_summary', text: 'Latest title' });
assert.equal(replacement.liveTraceEntries[0].text, 'Latest title', 'complete summaries must replace, not concatenate');
assert.match(renderer, /const toolBodyEntries = visibleEntries;/, 'the real shared renderer must retain summary prose');
const pageRuntime = fs.readFileSync('web-ui/src/mobile/mobile-chat-page-runtime.js', 'utf8');
assert.match(pageRuntime, /_renderMobileAgentChatBubble\(/, 'sheet must use the shared chat bubble renderer');
console.log('mobile background stream parity fixture passed');

const summaryTitle = new Function('_dedupeMobileTraceProseText',
  `${rendererFunction('_mobileTraceProgressSummary', '_renderMobileLiveTrace')}return _mobileTraceProgressSummary;`,
)((text) => text);
assert.equal(summaryTitle(background.liveTraceEntries), 'Updating provider', 'collapsed title must be latest heading only');
assert.equal(summaryTitle(groups[0].entries), 'Inspecting target');

const renderEntry = new Function('renderToolActivityEntry', 'escapeHtml', '_renderMobileLiveTracePreview',
  '_isMobileTraceReasoningSummaryType', '_renderMobileMarkdown', '_dedupeMobileTraceProseText',
  `${rendererFunction('_renderMobileLiveTraceEntry', '_isMobileTraceCompactionEntry')}return _renderMobileLiveTraceEntry;`,
)(() => '', (s) => String(s), () => '', () => false, (s) => `<p>${s}</p>`, (s) => s);
assert.match(renderEntry(groups[0].entries[0]), /class="pm-live-prose think"[\s\S]*Checking the current file content/,
  'shared renderer must emit an inline thought block, not just a disclosure label');
assert.match(renderEntry(groups[2].entries[0]), /Applying the verified change/);
const paragraphDelta = { liveTraceEntries: [] };
handlers._handleMobileReasoningSummaryDelta(paragraphDelta, { type: 'reasoning_summary', text: 'First paragraph' });
handlers._handleMobileReasoningSummaryDelta(paragraphDelta, { type: 'reasoning_summary_delta', text: '\n\nsecond paragraph' });
assert.match(paragraphDelta.liveTraceEntries[0].text, /First paragraph[\s\S]*second paragraph/,
  'streaming paragraphs must not discard earlier thought text');
assert.equal(transientEntry._mobileDurableReasoningEntries([
  { type: 'reasoning_summary', text: 'not public', extra: { source: 'reasoning_summary', visibility: 'private' } },
]).length, 0, 'private provider reasoning must never survive the public trace filter');
