import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-gate-'));
const config = require('../../config/config');
const cfg = config.getConfig();
cfg.getWorkspacePath = () => ws;

const store = require('./proposal-store');
const base = { type: 'general', priority: 'low', summary: 's', details: 'd', affectedFiles: [], executionSteps: [] } as any;

// Old automated pending proposal expires on next automated create.
const old = store.createProposal({ ...base, title: 'Old brain idea', sourceSessionId: 'brain_thought_1' });
old.createdAt = Date.now() - 20 * 86_400_000;
fs.writeFileSync(path.join(ws, 'proposals', 'pending', `${old.id}.json`), JSON.stringify(old));

store.createProposal({ ...base, title: 'Brain idea A', sourceSessionId: 'brain_dream_1' });
assert.equal(store.loadProposal(old.id).status, 'expired', 'stale automated proposal expired to archive');
assert.throws(() => store.createProposal({ ...base, title: 'brain idea a!', sourceSessionId: 'brain_dream_2' }), /already pending/);
store.createProposal({ ...base, title: 'Brain idea B', sourceSessionId: 'brain_dream_1' });
store.createProposal({ ...base, title: 'Brain idea C', sourceSessionId: 'brain_dream_1' });
assert.throws(() => store.createProposal({ ...base, title: 'Brain idea D', sourceSessionId: 'brain_dream_1' }), /Daily cap/);
// Human/main-chat proposals are never capped.
for (let i = 0; i < 5; i += 1) store.createProposal({ ...base, title: `User idea ${i}`, sourceSessionId: 'mobile_abc' });

fs.rmSync(ws, { recursive: true, force: true });
console.log('proposal-gate regression: ok');
