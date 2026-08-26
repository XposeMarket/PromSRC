import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const baseSha = 'bc09eb2b9b586599fb416d38439cb518a9832d28';
const readBase = (relative) => execFileSync('git', ['show', `${baseSha}:${relative}`], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');

const {
  renderDesktopQuestionCard,
} = await import('../web-ui/src/features/chat/questions/desktop-question-view.js');
const {
  renderMobileQuestionCard,
} = await import('../web-ui/src/features/chat/questions/mobile-question-view.js');
const {
  questionForComposer,
  questionPlacement,
  shouldRenderQuestionInComposer,
  shouldRenderQuestionInHistory,
  syncQuestionComposerHost,
} = await import('../web-ui/src/features/chat/questions/question-composer-host.js');

const question = {
  id: 'view-question',
  title: 'Choose a channel',
  prompt: 'Where should this go?',
  questions: [{ id: 'channel', label: 'Channel', mode: 'single_select', options: ['web', 'desktop'] }],
  status: 'pending',
};
const answered = {
  ...question,
  status: 'answered',
  answers: [{ id: 'channel', selected: ['desktop'] }],
};

assert.equal(questionPlacement('pending'), 'composer');
assert.equal(questionPlacement('submitting'), 'composer');
assert.equal(questionPlacement('answered'), 'history');
assert.equal(shouldRenderQuestionInComposer(question), true);
assert.equal(shouldRenderQuestionInHistory(question), false);
assert.equal(shouldRenderQuestionInHistory(answered), true);
assert.equal(questionForComposer({ ...question, status: 'submitting' }).status, 'pending');
const submittingHost = { hidden: true, innerHTML: '', style: {}, setAttribute(name, value) { this[name] = value; }, removeAttribute() {} };
let submittingRenderStatus = '';
syncQuestionComposerHost({
  host: submittingHost,
  question: { ...question, status: 'submitting' },
  render: (value) => { submittingRenderStatus = value.status; return '<question-card />'; },
  mode: 'mobile',
});
assert.equal(submittingRenderStatus, 'pending', 'submitting questions are normalized once for the composer host');
assert.equal(submittingHost.hidden, false, 'submitting questions remain visible in the composer host');

const desktopPendingHtml = renderDesktopQuestionCard(question);
assert.match(desktopPendingHtml, /class="[^"]*chat-question-card/);
assert.match(desktopPendingHtml, /class="pq-option"/);
assert.match(desktopPendingHtml, /toggleQuestionOther/);
assert.doesNotMatch(desktopPendingHtml, /Question result/);
const desktopAnsweredHtml = renderDesktopQuestionCard(answered);
assert.match(desktopAnsweredHtml, /Question result/);
assert.match(desktopAnsweredHtml, /desktop/);
assert.doesNotMatch(desktopAnsweredHtml, /class="pq-option"/);

const mobilePendingHtml = renderMobileQuestionCard(question);
assert.match(mobilePendingHtml, /class="pm-question-card pm-question-pending"/);
assert.match(mobilePendingHtml, /data-pm-q-opt="desktop"/);
assert.match(mobilePendingHtml, /_mobileQuestionToggleOption/);
const mobileAnsweredHtml = renderMobileQuestionCard(answered);
assert.match(mobileAnsweredHtml, /Question result/);
assert.match(mobileAnsweredHtml, /desktop/);
assert.equal(renderMobileQuestionCard({ ...question, status: 'submitting' }), '', 'optimistic mobile submitting remains duplicate-free');

const desktopLegacy = readBase('web-ui/src/styles/components.css');
const mobileLegacy = readBase('web-ui/src/styles/mobile.css');
const desktopFeature = read('web-ui/src/features/chat/questions/questions.desktop.css');
const mobileFeature = read('web-ui/src/features/chat/questions/questions.mobile.css');

const movedBlocks = [
  ['desktop host', desktopLegacy, desktopFeature, /\.chat-question-popover \{[\s\S]*?\.chat-question-popover\[hidden\] \{ display: none; \}\n/],
  ['desktop dock', desktopLegacy, desktopFeature, /\/\* Pending question docked inside the live streaming bubble[\s\S]*?\.streaming-question-dock \.chat-approval-card \{ margin: 0; \}\n/],
  ['desktop card', desktopLegacy, desktopFeature, /\/\* Prometheus question card[\s\S]*?:root\[data-theme="dark"\] \.chat-question-card \.pq-option:hover \{ background: rgba\(56,189,248,0\.16\); border-color: #38bdf8; \}\n/],
  ['mobile card', mobileLegacy, mobileFeature, /\/\* Mobile Prometheus question card[\s\S]*?\.pm-q-resolved \{ font-size: 12px; opacity: 0\.6; \}\n/],
];
for (const [label, legacy, feature, pattern] of movedBlocks) {
  const oldMatch = legacy.match(pattern)?.[0];
  const newMatch = feature.match(pattern)?.[0];
  assert.ok(oldMatch, `${label} baseline block must be present at the approved base`);
  assert.equal(newMatch, oldMatch, `${label} CSS block must move byte-equivalently`);
}

assert.doesNotMatch(read('web-ui/src/styles/components.css'), /\.chat-question-popover \{|\.streaming-question-dock \{|\.chat-question-card,/);
assert.doesNotMatch(read('web-ui/src/styles/mobile.css'), /\.pm-question-card \{|\.pm-composer \.pm-mobile-question-popover|\.pm-q-head \{/);

const desktopEntry = read('web-ui/src/styles/desktop-entry.css');
assert.ok(desktopEntry.indexOf("@import './components.css';") < desktopEntry.indexOf("questions.desktop.css"), 'desktop feature CSS must load immediately after components.css');
const mobileEntry = read('web-ui/src/styles/mobile-entry.css');
assert.ok(mobileEntry.indexOf("@import './mobile.css' layer(route);") < mobileEntry.indexOf('questions.mobile.css'), 'mobile feature CSS must load immediately after mobile.css');
const indexHtml = read('web-ui/index.html');
assert.ok(indexHtml.indexOf('src/styles/components.css') < indexHtml.indexOf('src/features/chat/questions/questions.desktop.css'), 'desktop document link order must preserve the owning stylesheet slot');
const styleOwners = read('web-ui/src/mobile/mobile-style-owners.js');
assert.ok(styleOwners.indexOf("file: '../features/chat/questions/questions.mobile.css'") < styleOwners.indexOf("file: 'mobile-composer-stack.css'"), 'mobile chat owner must install question CSS before composer stack CSS');
assert.match(read('web-ui/src/mobile/mobile-pages.js'), /import\('\.\.\/features\/chat\/questions\/mobile-question-view\.js'\)/, 'mobile question view must remain dynamically loaded');
assert.match(read('web-ui/src/mobile/mobile-pages.js'), /import\('\.\.\/features\/chat\/questions\/question-composer-host\.js'\)/, 'mobile question host must remain dynamically loaded');
assert.doesNotMatch(read('web-ui/src/mobile/mobile-pages.js'), /from ['"]\.\.\/features\/chat\/questions\/(?:mobile-question-view|question-composer-host)\.js['"]/, 'mobile question view/host must not enter the mobile static page closure');
assert.doesNotMatch(read('web-ui/src/mobile/mobile-chat-renderer-runtime.js'), /from ['"]\.\.\/features\/chat\/questions\//, 'mobile renderer must receive question APIs through the lazy page adapter');
assert.match(read('web-ui/src/mobile/mobile-pages.js'), /_mobileQuestionRenderer.*mobileQuestionRendererApi/s, 'mobile renderer receives one lazy question API seam');

for (const feature of [
  'web-ui/src/features/chat/questions/desktop-question-view.js',
  'web-ui/src/features/chat/questions/mobile-question-view.js',
  'web-ui/src/features/chat/questions/question-composer-host.js',
]) {
  assert.doesNotMatch(read(feature), /ChatPage\.js|mobile-pages\.js/, `${feature} must not import a page owner`);
}

const generatedPairs = [
  ['web-ui/src/features/chat/questions/questions.desktop.css', 'generated/public-web-ui/static/features/chat/questions/questions.desktop.css'],
  ['web-ui/src/features/chat/questions/questions.mobile.css', 'generated/public-web-ui/static/features/chat/questions/questions.mobile.css'],
  ['web-ui/src/mobile/mobile-style-owners.js', 'generated/public-web-ui/static/mobile/mobile-style-owners.js'],
];
for (const [source, generated] of generatedPairs) {
  assert.equal(read(source), read(generated), `${source} must mirror generated output`);
}

const directDesktopSelectors = [
  '.chat-question-popover {', '.streaming-question-dock {', '.chat-question-card,',
];
const directMobileSelectors = [
  '.pm-question-card {', '.pm-composer .pm-mobile-question-popover', '.pm-streaming-question-dock',
  '.pm-q-head {', '.pm-q-opt', '.pm-q-input',
];
for (const selector of directDesktopSelectors) {
  assert.equal((read('web-ui/src/styles/components.css').match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 0, `desktop legacy CSS has no remaining direct ${selector} rule`);
}
for (const selector of directMobileSelectors) {
  assert.equal((read('web-ui/src/styles/mobile.css').match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 0, `mobile legacy CSS has no remaining direct ${selector} rule`);
}

console.log(JSON.stringify({
  placement: 'pending/submitting -> composer; terminal -> history',
  cssBlocks: movedBlocks.map(([label, legacy, feature, pattern]) => ({ label, bytes: legacy.match(pattern)[0].length })),
  collisionScan: 'no direct selector collisions remain in legacy CSS buckets; shared parent popover/card rules remain in their original buckets and feature CSS loads after them',
  lazyMobileQuestionModules: true,
}, null, 2));
console.log('Chat question view/placement contract passed.');
