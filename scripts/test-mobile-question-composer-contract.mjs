import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const mobilePageFacade = read('web-ui/src/mobile/mobile-pages.js');
const mobilePageRuntime = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const mobilePages = `${mobilePageFacade}\n${mobilePageRuntime}`;
const mobileRenderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const mobileMessageRenderer = read('web-ui/src/mobile/mobile-chat-message-renderer.js');
const mobileCss = read('web-ui/src/styles/mobile.css');
const questionModel = read('web-ui/src/features/chat/questions/question-model.js');
const questionController = read('web-ui/src/features/chat/questions/question-controller.js');

const cardStart = mobileRenderer.indexOf('function _renderMobileQuestionCard(');
const cardEnd = mobileRenderer.indexOf('function _renderMobileGoalCompletionReport(', cardStart);
assert(cardStart >= 0 && cardEnd > cardStart, 'mobile question card renderer must remain discoverable');
const cardSource = mobileRenderer.slice(cardStart, cardEnd);

assert.match(cardSource, /data-pm-q-text/, 'text questions must own an inline answer field');
assert.match(cardSource, /data-pm-q-other/, 'Other answers must own an inline answer field');
assert.match(cardSource, /data-pm-q-submit/, 'question cards must expose a semantic submit control');
assert.match(cardSource, /_submitMobileQuestion\(\$\{idJson\}\)/, 'question submit must use the card action');
assert.match(cardSource, /pm-q-check/, 'select options must expose a checklist indicator');
assert.match(cardSource, /aria-pressed="false"/, 'select options must expose their selection state');
assert.match(cardSource, /data-pm-q-other=.*hidden/, 'Other text input must start hidden');
assert.match(questionModel, /const currentIndex = Number\.isFinite\(Number\(rawCurrentIndex\)\)/, 'the shared question model must preserve the active question index');
assert.match(mobilePages, /_renderMobileQuestionCard\(\{\s*\.\.\.question,\s*currentIndex\s*\}\)/, 'the mobile composer must pass the active question index into the renderer');
assert.match(questionController, /const missing = getMissingQuestionAnswers\(/, 'the lifecycle controller must validate question answers before submission');
assert.match(questionController, /questions: \[question\.questions\[currentStep\]\]/, 'the lifecycle controller must validate only the active step before advancing');
assert.match(mobilePages, /advanceStep: true/, 'the mobile question card must advance intermediate steps without submitting early');
assert.match(cardSource, /pm-q-progress-current/, 'question progress must separate the current step for styling');
assert.match(mobilePages, /const otherOpen = info\?\.open === true/, 'Other must only reopen after an explicit selection');
assert.doesNotMatch(cardSource, /pm-q-title|pm-q-prompt|pm-q-context|pm-q-help|data-pm-q-general/, 'question cards must not render card-level or helper copy');
assert.match(cardSource, /const visibleQuestions = pending \? \[currentQuestion\] : q\.questions/, 'pending cards must render one question at a time');
assert.match(cardSource, /pm-q-progress/, 'multi-question cards must expose step progress');
assert.match(cardSource, /Next question/, 'intermediate question steps must advance with a next action');
assert.match(mobilePages, /function _renderMobileQuestionCard\(\.\.\.args\) \{ return _mobileChatRendererInvoke\('_renderMobileQuestionCard', args\); \}/, 'question markup must remain renderer-owned');

assert.match(mobilePages, /const liveDraftMap = host\.hidden \? \{\} : _captureMobileQuestionDraftState\(host\)/, 'question takeover must capture live drafts before rebuilding');
assert.match(mobilePages, /document\.getElementById\('pm-composer-input'\)\?\.blur\?\.\(\)/, 'question takeover must dismiss the normal composer focus');
assert.match(mobilePages, /form\.classList\.toggle\('has-pending-question', questionPending\)/, 'composer state must expose pending question ownership');
assert.match(mobilePages, /Use the composer to answer:/, 'required-answer messaging must identify the active question composer');
assert.match(mobilePages, /function _rememberMobileQuestionPayload\(/, 'step transitions must persist the complete answer draft');
assert.match(questionController, /if \(inputOptions\.advanceStep === true && hasRequestedStep && !isLastQuestion\)/, 'intermediate answers must advance locally before backend submission');
assert.match(mobilePages, /_syncMobileQuestionComposerPopover\(sessionId \|\| q\.sessionId \|\| __pmChat\.activeSessionId, \{ \[qid\]: state \}\)/, 'next question must rebuild the composer card at the next step');
assert.match(mobilePages, /function _paintMobileQuestionComposerPopover\(/, 'question transitions must have a single repaint owner');
assert.match(mobilePages, /pm-q-step-transitioning/, 'question steps must animate instead of abruptly swapping');
assert.match(mobilePages, /submitButton\.disabled = true/, 'question submission must ignore duplicate taps during the handoff');

assert.match(mobileCss, /\.pm-composer\.has-pending-question \.pm-composer-row[\s\S]*?display: none !important/, 'pending questions must hide the normal mobile composer row');
assert.match(mobileCss, /\.pm-composer\.has-pending-question \.pm-mobile-question-popover[\s\S]*?position: relative/, 'pending questions must occupy the composer host');
assert.match(mobileCss, /\.pm-q-input:focus/, 'question fields must retain a visible focus treatment');
assert.match(mobileCss, /@keyframes pm-mobile-question-step-exit/, 'question step transitions must define an exit motion');

console.log('Mobile question composer contract passed.');
