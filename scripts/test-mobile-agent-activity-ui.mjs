import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const pages = read('web-ui/src/mobile/mobile-pages.js');
const renderer = read('web-ui/src/mobile/mobile-chat-renderer-runtime.js');
const activity = read('web-ui/src/tool-activity.js');
const chatCss = read('web-ui/src/styles/mobile-composer-stack.css');

assert.match(renderer, /function _mobileTracePresentationEntries\(/, 'legacy progress prose must be normalized into activity thoughts');
assert.doesNotMatch(pages, /function _mobileTracePresentationEntries\(/, 'chat activity presentation must stay out of the static page chunk');
assert.match(renderer, /details class="pm-trace-thought-group"/, 'thoughts must render as closable disclosures');
assert.doesNotMatch(pages, /function _renderMobileGroupedTrace\(/, 'grouped trace rendering must stay in the lazy renderer');
assert.match(pages, /_pmLiveActivityCompleted = true/, 'the renderer must know when a live turn crossed its final frame');
assert.match(renderer, /visibleKinds = null, openThoughts = false/, 'trace rendering must support separate thought and tool surfaces');
assert.match(renderer, /const liveCompletionThoughts = m\._pmLiveActivityCompleted === true/, 'completed live turns must keep thoughts outside the hidden tool drawer');
assert.match(renderer, /visibleKinds: \['thought', 'thought-summary'\][\s\S]*?openThoughts: true/, 'live-completion thoughts must be visible and closable');
assert.match(renderer, /group\.kind === 'thought' \|\| group\.kind === 'thought-summary'/, 'thought summaries and paragraph thoughts must render as distinct groups');
assert.match(renderer, /const isSummaryThought = group\.kind === 'thought-summary'/, 'summary thought disclosure state must be explicit');
assert.match(pages, /reasoningKind:[\s\S]{0,220}'full_thought'/, 'curated paragraph thoughts must be tagged separately from summaries');
assert.match(pages, /_pmAbortRequested = true/, 'expected user aborts must be marked before transport teardown');
assert.match(pages, /_isMobileRuntimeAbortEvent/, 'late runtime abort frames must use the existing stopped turn');
assert.match(pages, /_installMobileTimestampReveal\(sideThreadEl/, 'background detail threads must wire work-timer disclosure');
assert.match(renderer, /liveCompletionTools \|\| _renderMobileGroupedTrace/, 'the tool stream must remain in its collapsible drawer');
assert.match(renderer, /inlineActivityVisible/, 'the foreground progress dock must defer to the inline activity stream');
assert.match(renderer, /host\.hidden = !state\?\.message \|\| inlineActivityVisible/, 'the duplicate foreground progress pill must hide once inline activity exists');
assert.match(renderer, /aria-busy="true"/, 'streaming final responses must expose their busy state');
assert.match(activity, /tool-activity-status-icon/, 'tool results must expose a compact status indicator');
assert.match(activity, /state === 'succeeded' \? ''/, 'successful tool rows must not render a repeated checkmark');
assert.match(chatCss, /\.pm-trace-thought-group/, 'thought disclosure styling must be present in the chat component owner');
assert.match(chatCss, /\.pm-trace-thought-body[\s\S]*?width:\s*100%[\s\S]*?margin-left:\s*0[\s\S]*?border-left:\s*3px/, 'thought body rail must align with nested tool-result rails');
assert.match(chatCss, /\.pm-trace-thought-chevron::before/, 'thought chevron must use a centered shape instead of a font glyph');
assert.match(chatCss, /\.pm-trace-compaction\s*\{/, 'chat-owned compaction styling must stay with the activity component owner');
assert.match(chatCss, /\.pm-trace-tool-body \.tool-activity-status-icon/, 'tool-result status styling must be scoped to the activity stream');

console.log('[mobile-agent-activity-ui] live thoughts, collapsed tools, terminal status, and streaming response contract passed');
