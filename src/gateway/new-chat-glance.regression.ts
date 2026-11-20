import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildNewChatGlance, readGlanceName, GLANCE_RUNNING_FRESH_MS } from './new-chat-glance';

const now = Date.UTC(2026, 10, 20, 2, 0, 0);

// Running: only fresh "running" rows count; stale leftovers and other statuses drop out; newest first, max 3.
const glance = buildNewChatGlance({
  now,
  tasks: [
    { id: 'a', status: 'running', title: 'Old run', lastProgressAt: now - 60_000 * 5, modelRef: { providerId: 'anthropic' } },
    { id: 'b', status: 'running', title: '  Newest\n run  ', lastProgressAt: now - 1_000, modelRef: { providerId: 'openai_codex' } },
    { id: 'stale', status: 'running', title: 'Wedged since last week', lastProgressAt: now - GLANCE_RUNNING_FRESH_MS - 1 },
    { id: 'q', status: 'queued', title: 'Queued', lastProgressAt: now },
    { id: 'c', status: 'running', title: 'Third', updatedAt: new Date(now - 60_000).toISOString() },
    { id: 'd', status: 'running', title: 'Fourth', startedAt: now - 120_000 },
  ],
  needsYou: [
    { kind: 'team_escalation', source: 'X Growth Engine', createdAt: new Date(now - 86_400_000 * 5).toISOString() },
    { kind: 'paused_agent_run', createdAt: new Date(now - 3_600_000).toISOString() },
  ],
  usage: [
    { provider: 'anthropic', account_id: 'other', windows: [{ used_percent: 10 }] },
    { provider: 'anthropic', account_id: 'default', windows: [{ used_percent: 3, reset_at: 'r5h' }, { used_percent: 84, reset_at: 'rweek' }] },
    { provider: 'openai_codex', label: 'OpenAI · ChatGPT / Codex', windows: [{ used_percent: 57 }] },
    { provider: 'xai', windows: [] },
    { provider: 'custom', label: 'Local · Box', windows: [{ used_percent: 'n/a' }] },
  ],
  name: 'Raul',
});
assert.equal(glance.runningCount, 4);
assert.deepEqual(glance.running.map((r) => r.id), ['b', 'c', 'd']);
assert.equal(glance.running[0].title, 'Newest run');
assert.equal(glance.running[0].provider, 'openai_codex');
assert.equal(glance.needsYou.count, 2);
assert.equal(glance.needsYou.oldestAt, now - 86_400_000 * 5);
assert.equal(glance.needsYou.firstLabel, 'X Growth Engine');
assert.deepEqual(glance.usage, [
  { provider: 'anthropic', label: 'Claude', leftPercent: 16, resetAt: 'rweek' },
  { provider: 'openai_codex', label: 'ChatGPT', leftPercent: 43, resetAt: '' },
]);
assert.equal(glance.name, 'Raul');

// Quiet day: nothing running, nothing waiting, no usage rows.
const quiet = buildNewChatGlance({ tasks: [], needsYou: [], usage: [], now });
assert.equal(quiet.runningCount, 0);
assert.equal(quiet.needsYou.count, 0);
assert.equal(quiet.needsYou.oldestAt, 0);
assert.equal(quiet.needsYou.firstLabel, '');
assert.deepEqual(quiet.usage, []);

// Name: onboarding "Preferred name" wins; memory-tagged "Name" bullet works; missing file is ''.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glance-'));
try {
  assert.equal(readGlanceName(dir), '');
  fs.writeFileSync(path.join(dir, 'USER.md'), '# User\n- [m:hsmg9] Name: Raul\n');
  assert.equal(readGlanceName(dir), 'Raul');
  fs.writeFileSync(path.join(dir, 'USER.md'), '## identity\n- Name: Raul <!-- m:hsmg9 -->\n- **Preferred name:** Rafa\n');
  assert.equal(readGlanceName(dir), 'Rafa');
  fs.writeFileSync(path.join(dir, 'USER.md'), '- Username: nope\n- Platform: Windows\n');
  assert.equal(readGlanceName(dir), '');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('new-chat glance regression passed');
