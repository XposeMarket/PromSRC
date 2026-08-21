import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/features/chat/approvals/model.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/approvals/model.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(
  fs.readFileSync(sourcePath, 'utf8'),
  fs.readFileSync(generatedPath, 'utf8'),
  'approval model source must match its public mirror',
);

const mod = await import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}`);
assert.equal(mod.getApprovalRiskLevel(0), 'low');
assert.equal(mod.getApprovalRiskLevel(4), 'medium');
assert.equal(mod.getApprovalRiskLevel(7), 'high');

const command = mod.normalizeChatApprovalRecord({
  id: 'approval-command',
  approvalKind: 'elevated_command',
  toolName: 'run_command',
  toolArgs: { command: 'whoami', cwd: 'C:/repo' },
  riskScore: 8,
});
assert.equal(command.title, 'Administrator command');
assert.equal(command.command, 'whoami');
assert.equal(command.oneShot, true);

const browser = mod.normalizeChatApprovalRecord({
  id: 'approval-browser',
  toolName: 'browser_click',
  toolArgs: { selector: '#save' },
});
assert.equal(browser.title, 'Browser action');
assert.equal(browser.summary, 'Approve browser click.');
assert.equal(browser.humanDetail, '#save');

const dev = mod.normalizeChatApprovalRecord({
  id: 'approval-dev',
  approvalKind: 'dev_source_edit',
  devSourceEdit: { allowedFiles: ['a.js', 'b.js'] },
});
assert.equal(dev.title, 'Dev source edit approval');
assert.equal(dev.humanDetail, '2 files requested');
assert.equal(dev.oneShot, true);

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/approvals\/model\.js'/);
for (const name of ['getApprovalRiskLevel', 'getApprovalToolLabel', 'summarizeApprovalForHumans', 'normalizeChatApprovalRecord']) {
  assert.equal(chat.includes(`function ${name}(`), false, `${name} must no longer be declared in ChatPage.js`);
}
assert.match(chat, /normalizeChatApprovalRecord\(/);
assert.match(chat, /getApprovalRiskLevel\(/);

console.log('Chat approval model contract passed.');
