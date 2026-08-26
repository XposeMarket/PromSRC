import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sourcePages = read('web-ui/src/mobile/mobile-pages.js');
const sourceVoicePage = read('web-ui/src/mobile/mobile-voice-page.js');
const sourceCss = read('web-ui/src/styles/mobile.css');
const generatedPages = read('generated/public-web-ui/static/mobile/mobile-pages.js');
const generatedVoicePage = read('generated/public-web-ui/static/mobile/mobile-voice-page.js');
const generatedCss = read('generated/public-web-ui/static/styles/mobile.css');

const cardStart = sourcePages.indexOf('function _renderMobileApprovalCard(');
const cardEnd = sourcePages.indexOf('function _mobileBackgroundSpawnIdFromSessionId(', cardStart);
assert(cardStart >= 0 && cardEnd > cardStart, 'mobile approval card renderer must remain discoverable');
const cardSource = sourcePages.slice(cardStart, cardEnd);

assert.match(cardSource, /pm-chat-approval-icon/, 'approval cards need the tool-approval shield/status icon');
assert.match(cardSource, /Allow this tool to run\?/, 'pending approvals need the tool-approval heading');
assert.match(cardSource, /pm-chat-approval-tool/, 'approval cards need the monospace tool name');
assert.doesNotMatch(cardSource, /pm-chat-approval-status/, 'approval cards should not render the status pill');
assert.match(cardSource, /pm-chat-approval-details/, 'approval details need a collapsible disclosure');
assert.match(cardSource, /View details/, 'approval details need the tool-approval disclosure label');
assert.match(cardSource, /Allow once/, 'approval cards need a one-shot allow action');
assert.match(cardSource, /Always allow/, 'command approvals need a persistent allow action');
assert.match(cardSource, /data-pm-approval-action="reject"/, 'approval cards need a deny action');
assert.doesNotMatch(cardSource, /pm-q-|pm-mobile-question-popover/, 'approval cards must not reuse question-card styling');
assert.match(sourceCss, /\.pm-chat-approval-parameters/, 'approval details need parameter-row styling');
assert.match(sourceCss, /\.pm-chat-approval-btn\.approve[\s\S]*?background: var\(--pm-text\)/, 'allow once must be the primary tool-approval action');
assert.match(sourceCss, /\.pm-chat-approval-btn\.reject[\s\S]*?color: var\(--pm-muted\)/, 'deny must be the restrained tool-approval action');
assert.match(sourceVoicePage, /pm-va-details/, 'voice approvals need the same tool-approval disclosure');
assert.match(sourceVoicePage, /Allow this tool to run\?/, 'voice approvals need the tool-approval heading');
assert.match(sourceVoicePage, /id="pm-va-tool"/, 'voice approvals need the monospace tool name slot');
assert.doesNotMatch(sourceVoicePage, /id="pm-va-risk"/, 'voice approvals should not render the status pill');
assert.match(sourceVoicePage, /id="pm-va-approve">Allow once/, 'voice approvals need a one-shot allow action');
assert.equal(generatedPages, sourcePages, 'generated mobile-pages.js must mirror source');
assert.equal(generatedVoicePage, sourceVoicePage, 'generated mobile-voice-page.js must mirror source');
assert.match(generatedCss, /\.pm-chat-approval-parameters/, 'generated mobile CSS must include tool-approval styles');
assert.match(generatedCss, /\.pm-va-details/, 'generated mobile CSS must include voice tool-approval styles');

console.log('Mobile tool approval UI contract passed.');
