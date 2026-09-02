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

const durable = transientEntry._mobileDurableReasoningEntries([
  ...message.liveTraceEntries,
  { type: 'think', text: 'Launching parallel H3 Max queries', extra: { source: 'reasoning_summary' } },
  ...message.processEntries,
]);
assert.equal(durable.length, 2, 'cache filtering must retain the full thought surfaces');
assert.ok(durable.every((entry) => entry.text === message.processEntries[0].text),
  'cache filtering must remove mutable and legacy summary rows');

assert.match(renderer, /const bodyEntries = group\.entries\.filter\(\(entry\) => !_isMobileMutableProgressTraceEntry\(entry\)\)/,
  'the mutable summary row must not render its prose a second time as a body row');
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
  assert.match(css, /\.pm-msheet\.is-reasoning \.pm-reasoning-fill::after\s*\{[\s\S]*?width: 50px;[\s\S]*?height: 50px;[\s\S]*?top: 50%;[\s\S]*?transform: translateY\(-50%\);[\s\S]*?border-radius: 50%;/,
    'mobile reasoning thumb must be a circular tab-sized cap');
}

console.log('mobile reasoning-summary lifecycle regression passed');
