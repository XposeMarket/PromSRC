import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, deleteProject, mutateProject } from '../media-engine/project.js';
import { decideVideoApproval, videoContentReview } from './video-content-review.js';
import { getVideoApproval, recordVideoApproval, resetVideoApprovalKnownWorkspacesForTests } from './video-pending-approvals.js';

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'video-approval-review-'));
  resetVideoApprovalKnownWorkspacesForTests();
  const project = await createProject(ws, { title: 'Review gate' });
  await mutateProject(ws, project.id, 'test.shot', (p) => { p.shots.push({ id: 'shot_1', title: 'Opening', prompt: 'A red fox at dawn', durationSec: 5 } as any); });

  // Same check the approve route runs: recorded review vs a fresh recompute of the stored record.
  const decide = (id: string) => {
    const record = getVideoApproval(ws, id)!;
    return decideVideoApproval(record.contentReview, () => videoContentReview(record.workspacePath, record.projectId, record.args, record.quotedUsd));
  };

  // 1. Recorded review + unchanged project -> allowed.
  const quoted = recordVideoApproval({ workspacePath: ws, sessionId: 's1', projectId: project.id, action: 'generate', args: {}, quotedUsd: 2, summary: 'gen' });
  assert.ok(quoted.contentReview, 'quote of a readable project must record a review');
  assert.ok(quoted.contentReview!.text.includes('A red fox at dawn'));
  assert.deepEqual(decide(quoted.id), { allow: true });

  // 2. Project edited after the quote -> refused.
  await mutateProject(ws, project.id, 'test.edit', (p) => { p.shots[0].prompt = 'A different scene the user never saw'; });
  const changed = decide(quoted.id);
  assert.equal(changed.allow, false);
  assert.match((changed as any).reason, /changed since this quote.*new generation approval/);

  // 3. No recorded review (quote recorded while the project was missing) -> refused.
  const legacy = recordVideoApproval({ workspacePath: ws, sessionId: 's1', projectId: 'vp_missing', action: 'run', args: {}, quotedUsd: 3, summary: 'run' });
  assert.equal(legacy.contentReview, undefined);
  const noReview = decideVideoApproval(undefined, () => { throw new Error('recompute must not matter'); });
  assert.equal(noReview.allow, false);
  assert.match((noReview as any).reason, /no recorded content review.*new generation approval/);
  assert.equal(decide(legacy.id).allow, false);
  // A missing review is refused even if the project now exists and recomputes fine.
  assert.equal(decideVideoApproval(undefined, () => quoted.contentReview).allow, false);

  // 4. Review cannot be recomputed (project deleted/unreadable) -> refused, not thrown.
  const requote = recordVideoApproval({ workspacePath: ws, sessionId: 's1', projectId: project.id, action: 'generate', args: {}, quotedUsd: 2, summary: 'gen' });
  assert.equal(decide(requote.id).allow, true);
  assert.equal(deleteProject(ws, project.id), true);
  const gone = decide(requote.id);
  assert.equal(gone.allow, false);
  assert.match((gone as any).reason, /could not be re-checked.*new generation approval/);
  assert.equal(decideVideoApproval(requote.contentReview, () => undefined).allow, false);

  // Refusals leave the record in place (visible, dismissable), never silently consumed.
  assert.ok(getVideoApproval(ws, requote.id));
  assert.ok(getVideoApproval(ws, legacy.id));

  fs.rmSync(ws, { recursive: true, force: true });
  console.log('video approval content review gate regression: PASS');
}

main().catch((err) => { console.error(err); process.exit(1); });
