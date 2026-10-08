import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearVideoApproval,
  clearVideoApprovalsForProject,
  listVideoApprovals,
  recordVideoApproval,
  resetVideoApprovalKnownWorkspacesForTests,
} from './video-pending-approvals';
import { buildNeedsYouItems } from './needs-you';
import { buildTeamReplyPayload } from './needs-you-team-reply';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-you-video-'));
resetVideoApprovalKnownWorkspacesForTests();

// 1. Recording a quote persists it under the workspace data dir.
const rec = recordVideoApproval({
  workspacePath: ws, sessionId: 'chat-video', projectId: 'vp_demo', action: 'run',
  args: { storyboard: true, qa: true }, runId: 'run_1', quotedUsd: 4.25, summary: 'Autopilot run ~$4.25',
});
const file = path.join(ws, 'video-projects', '_pending-approvals.json');
assert.ok(fs.existsSync(file), 'approval store must be persisted to video-projects/_pending-approvals.json');
const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(onDisk.approvals.length, 1);
assert.equal(onDisk.approvals[0].projectId, 'vp_demo');
assert.equal(onDisk.approvals[0].sessionId, 'chat-video');
assert.equal(onDisk.approvals[0].runId, 'run_1');
assert.equal(onDisk.approvals[0].quotedUsd, 4.25);

// 2. A re-quote for the same project+action replaces the older record.
recordVideoApproval({ workspacePath: ws, sessionId: 'chat-video', projectId: 'vp_demo', action: 'run', args: {}, quotedUsd: 5, summary: 'requote' });
assert.equal(listVideoApprovals(ws).length, 1);
assert.equal(listVideoApprovals(ws)[0].quotedUsd, 5);

// 3. Needs-you collector normalizes the pending quote into a video_approval card.
const items = buildNeedsYouItems({ videoApprovals: listVideoApprovals(ws) });
assert.equal(items.length, 1);
assert.equal(items[0].kind, 'video_approval');
assert.equal(items[0].sessionId, 'chat-video');
assert.equal(items[0].id, `video-approval:${listVideoApprovals(ws)[0].id}`);

// 4. Approving (starting the run) clears the project's quote.
assert.equal(clearVideoApprovalsForProject(ws, 'vp_demo'), 1);
assert.equal(listVideoApprovals(ws).length, 0);

// 5. Dismiss removes a single record and reports whether it existed.
const second = recordVideoApproval({ workspacePath: ws, sessionId: 's2', projectId: 'vp_b', action: 'generate', args: {}, quotedUsd: 1, summary: 'gen' });
assert.equal(clearVideoApproval(ws, second.id), true);
assert.equal(clearVideoApproval(ws, second.id), false);
assert.equal(listVideoApprovals(ws).length, 0);
void rec;

// 6. Source guard: the media tool hooks recording on needsApproval and clears on approved start.
const toolSrc = fs.readFileSync(path.join(__dirname, '..', 'media-engine', 'tool.ts'), 'utf8');
assert.ok(toolSrc.includes("recordVideoApproval({ workspacePath: ws, sessionId: ctx.sessionId, projectId: pid, action: 'generate'"), 'generate must record its quote');
assert.ok(toolSrc.includes("action: 'run'"), 'run must record its quote');
assert.ok(toolSrc.includes('clearVideoApprovalsForProject(ws, pid);'), 'approved run must clear the quote');

// 7. Team inline reply payload: trimmed message, role user, member target only when named.
assert.deepEqual(buildTeamReplyPayload({ text: '  go ahead  ' }), { message: 'go ahead', role: 'user' });
assert.deepEqual(
  buildTeamReplyPayload({ text: 'use the blue variant', memberId: 'sub_ari', memberLabel: 'Ari' }),
  { message: 'use the blue variant', role: 'user', targetId: 'sub_ari', targetLabel: 'Ari' },
);
assert.throws(() => buildTeamReplyPayload({ text: '   ' }), /required/);
assert.throws(() => buildTeamReplyPayload({ text: 'x'.repeat(8001) }), /too long/);

console.log('needs-you video approval + team reply regression: PASS');
