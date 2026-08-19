import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cardPath = path.join(root, 'web-ui/src/features/chat/approvals/ApprovalCard.js');
const generatedCardPath = path.join(root, 'generated/public-web-ui/static/features/chat/approvals/ApprovalCard.js');
const escapePath = path.join(root, 'web-ui/src/features/chat/rendering/inline-escape.js');
const generatedEscapePath = path.join(root, 'generated/public-web-ui/static/features/chat/rendering/inline-escape.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(fs.readFileSync(cardPath, 'utf8'), fs.readFileSync(generatedCardPath, 'utf8'), 'Approval Card source must match its public mirror');
assert.equal(fs.readFileSync(escapePath, 'utf8'), fs.readFileSync(generatedEscapePath, 'utf8'), 'inline escape source must match its public mirror');

const escape = await import(`${pathToFileURL(escapePath).href}?test=${Date.now()}`);
const encoded = escape.encodeInlineJsString('approval"<&');
assert.match(encoded, /^&quot;/);
assert.equal(encoded.includes('<'), false);
assert.equal(encoded.includes('&amp;'), true);

// ApprovalCard imports the shared browser utility module for escHtml. Provide the
// same minimal DOM globals the component has in production before importing it.
const { window } = parseHTML('<html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;

const card = await import(`${pathToFileURL(cardPath).href}?test=${Date.now()}`);
const browserMarkup = card.renderInlineApprovalRequest({
  id: 'approval"<&',
  toolName: 'browser_click',
  toolArgs: { selector: '#save' },
  riskScore: 4,
  affectedSystems: ['browser'],
  status: 'pending',
});
assert.match(browserMarkup, /chat-approval-card-medium/);
assert.match(browserMarkup, /Browser action/);
assert.match(browserMarkup, /Approve browser click\./);
assert.match(browserMarkup, /Trust this session/);
assert.match(browserMarkup, /Always allow/);
assert.equal(browserMarkup.includes('data-approval-id="approval"<&"'), false, 'approval ids must be escaped in markup');

const oneShotMarkup = card.renderInlineApprovalRequest({
  id: 'admin-1',
  approvalKind: 'elevated_command',
  toolName: 'run_command',
  toolArgs: { command: 'whoami' },
  riskScore: 8,
  status: 'pending',
});
assert.match(oneShotMarkup, /chat-approval-card-high/);
assert.match(oneShotMarkup, /Administrator command/);
assert.equal(oneShotMarkup.includes('Trust this session'), false);
assert.equal(oneShotMarkup.includes('Always allow'), false);

const resolvedMarkup = card.renderInlineApprovalRequest({ id: 'done-1', toolName: 'browser_click', status: 'approved' });
assert.match(resolvedMarkup, /This request was approved\./);
assert.equal(resolvedMarkup.includes('chat-approval-actions'), false);

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/approvals\/ApprovalCard\.js'/);
assert.match(chat, /from '\.\.\/features\/chat\/rendering\/inline-escape\.js'/);
assert.equal(chat.includes('function renderInlineApprovalRequest('), false);
assert.equal(chat.includes('function encodeInlineJsString('), false);
assert.match(chat, /renderInlineApprovalRequest\(/);
assert.match(chat, /encodeInlineJsString\(/);

console.log('Chat Approval Card component contract passed.');
