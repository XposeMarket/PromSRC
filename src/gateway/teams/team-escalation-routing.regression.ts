import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-escalation-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const H = 60 * 60 * 1000;

async function main() {
  const managed = await import('./managed-teams');
  const delivery = await import('./team-escalation-delivery');
  const { summarizeTeamForList } = await import('./team-list-summary');

  // Stub the review-task queue: record jobs, never start a model run.
  const jobs: any[] = [];
  delivery.setEscalationReviewRunner(async (job) => { jobs.push(job); });

  const team = managed.createManagedTeam({
    name: 'Escalation Test', description: 'd', subagentIds: [], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  const t0 = Date.now();

  // 1) wait_for_reply escalation: listed open, exactly one delivery.
  const esc = managed.appendMainAgentThread(team.id, {
    from: 'coordinator', content: 'Need authorization for the Studio target', read: false,
    type: 'planning', level: 'main', waitForReply: true, status: 'open',
  })!;
  assert.deepEqual(managed.listOpenEscalations(team.id).map(v => v.id), [esc.id], 'escalation listed open');
  const first = await delivery.deliverTeamEscalation(team.id, esc.id, { now: t0 });
  assert.equal(first.reason, 'delivered');
  assert.equal(jobs.length, 1, 'exactly one delivery');
  assert.equal(jobs[0].source, 'team_escalation');

  // 2) Second call within 6h does NOT redeliver.
  const dup = await delivery.deliverTeamEscalation(team.id, esc.id, { now: t0 + 1 * H });
  assert.equal(dup.reason, 'deduped');
  assert.equal(jobs.length, 1, 'no redelivery inside 6h');

  // 3) After 6h it redelivers (attempt 2).
  const second = await delivery.deliverTeamEscalation(team.id, esc.id, { now: t0 + 7 * H });
  assert.equal(second.reason, 'delivered');
  assert.equal(second.deliveryCount, 2);
  assert.equal(jobs.length, 2, 'redelivered after 6h');

  // 4) Third delivery -> escalated_to_user, still unread and still listed.
  const third = await delivery.deliverTeamEscalation(team.id, esc.id, { now: t0 + 14 * H });
  assert.equal(third.reason, 'delivered');
  assert.equal(third.status, 'escalated_to_user');
  assert.equal(jobs.length, 3);
  const afterThree = managed.getManagedTeam(team.id)!.mainAgentThread!.find(m => m.id === esc.id)!;
  assert.equal(afterThree.status, 'escalated_to_user');
  assert.equal(afterThree.read, false, 'escalated_to_user stays unread');
  assert.deepEqual(managed.listOpenEscalations(team.id).map(v => [v.id, v.status]), [[esc.id, 'escalated_to_user']]);
  assert.equal(summarizeTeamForList(managed.getManagedTeam(team.id)).escalations.escalatedToUser, 1);

  // 5) No 4th turn once escalated to user.
  const fourth = await delivery.deliverTeamEscalation(team.id, esc.id, { now: t0 + 30 * H });
  assert.equal(fourth.reason, 'not_open');
  assert.equal(jobs.length, 3, 'no fourth review turn');

  // 6) Resolve answered: marks read and drops from the list.
  assert.equal(managed.resolveEscalation(team.id, esc.id, 'answered', 'test'), 1);
  assert.deepEqual(managed.listOpenEscalations(team.id), [], 'answered drops from list');
  assert.equal(managed.getManagedTeam(team.id)!.mainAgentThread!.find(m => m.id === esc.id)!.read, true);
  assert.equal(delivery.buildOpenEscalationsSection(managed.getManagedTeam(team.id)), '', 'packet section omitted when none open');

  // 7) FYI status (no wait_for_reply): not listed, not delivered.
  const fyi = managed.appendMainAgentThread(team.id, {
    from: 'coordinator', content: 'FYI: member finished lint', read: true,
    type: 'status', level: 'main', waitForReply: false, status: 'answered',
  })!;
  assert.deepEqual(managed.listOpenEscalations(team.id), [], 'FYI not listed');
  const fyiDelivery = await delivery.deliverTeamEscalation(team.id, fyi.id, { now: t0 });
  assert.equal(fyiDelivery.reason, 'not_open', 'FYI not delivered');
  assert.equal(jobs.length, 3, 'FYI produced no review turn');

  // 8) Completion-packet section: present only when something is open.
  const open2 = managed.appendMainAgentThread(team.id, {
    from: 'coordinator', content: 'Blocked: need a credential', read: false,
    type: 'error', level: 'user', waitForReply: true, status: 'open',
  })!;
  const section = delivery.buildOpenEscalationsSection(managed.getManagedTeam(team.id));
  assert.ok(section.startsWith('[OPEN ESCALATIONS]'), 'section leads when open');
  assert.ok(section.includes(open2.id), 'section lists the open escalation');

  // 9) Sweep at turn start: never-delivered message is backfilled; second sweep within 6h is a no-op; after 6h it redelivers.
  const before = jobs.length;
  const swept1 = await delivery.sweepTeamEscalations(team.id, t0 + 100 * H);
  assert.equal(swept1, 1, 'sweep delivers the open escalation once');
  assert.equal(await delivery.sweepTeamEscalations(team.id, t0 + 100 * H + 1 * H), 0, 'sweep inside 6h: none');
  assert.equal(await delivery.sweepTeamEscalations(team.id, t0 + 100 * H + 7 * H), 1, 'sweep after 6h: redelivers');
  assert.equal(jobs.length, before + 2);

  // 9b) Batch per team: 3 open escalations swept together queue exactly ONE task, all stamped with the same session.
  const batchTeam = managed.createManagedTeam({
    name: 'Batch', description: 'd', subagentIds: [], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  const batchIds = ['one', 'two', 'three'].map(label => managed.appendMainAgentThread(batchTeam.id, {
    from: 'coordinator', content: `Blocked ${label}`, read: false, type: 'error', level: 'main', waitForReply: true, status: 'open',
  })!.id);
  const beforeBatch = jobs.length;
  assert.equal(await delivery.sweepTeamEscalations(batchTeam.id, t0 + 200 * H), 3, 'batch sweep stamps all three');
  assert.equal(jobs.length, beforeBatch + 1, 'batch sweep queues exactly one task');
  const batchJob = jobs[jobs.length - 1];
  for (const id of batchIds) assert.ok(batchJob.prompt.includes(id), 'batch prompt lists every escalation id');
  const batchMsgs = managed.getManagedTeam(batchTeam.id)!.mainAgentThread!.filter(m => batchIds.includes(m.id));
  assert.deepEqual(batchMsgs.map(m => m.deliverySessionId), [batchJob.sessionId, batchJob.sessionId, batchJob.sessionId], 'one session id for the batch');
  assert.ok(batchMsgs.every(m => m.deliveryCount === 1 && m.deliveredAt === t0 + 200 * H), 'each message stamped');
  assert.equal(await delivery.sweepTeamEscalations(batchTeam.id, t0 + 200 * H + 1 * H), 0, 'second batch sweep within 6h queues 0');
  assert.equal(jobs.length, beforeBatch + 1, 'still one task after second sweep');

  // 10) Legacy records (no status fields) still count as open main escalations and markCoordinatorMessagesRead clears them.
  const legacyTeam = managed.createManagedTeam({
    name: 'Legacy', description: 'd', subagentIds: [], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  managed.appendMainAgentThread(legacyTeam.id, { from: 'coordinator', content: 'old planning', read: false, type: 'planning' });
  const legacyOpen = managed.listOpenEscalations(legacyTeam.id);
  assert.equal(legacyOpen.length, 1);
  assert.equal(legacyOpen[0].level, 'main');
  managed.markCoordinatorMessagesRead(legacyTeam.id);
  assert.deepEqual(managed.listOpenEscalations(legacyTeam.id), [], 'legacy cleared by markCoordinatorMessagesRead');

  // 11) Legacy filter: an unread legacy 'status' message is NOT listed and is NOT delivered.
  const legacyStatusTeam = managed.createManagedTeam({
    name: 'LegacyStatus', description: 'd', subagentIds: [], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  const legacyStatus = managed.appendMainAgentThread(legacyStatusTeam.id, { from: 'coordinator', content: 'old status chatter', read: false, type: 'status' })!;
  assert.deepEqual(managed.listOpenEscalations(legacyStatusTeam.id), [], 'legacy unread status is not listed');
  const legacyStatusDelivery = await delivery.deliverTeamEscalation(legacyStatusTeam.id, legacyStatus.id, { now: t0 });
  assert.equal(legacyStatusDelivery.reason, 'not_open', 'legacy unread status is not delivered');
  assert.equal(await delivery.sweepTeamEscalations(legacyStatusTeam.id, t0), 0, 'legacy unread status is not swept');

  // 12) Legacy filter: an unread legacy 'planning' message IS listed (open, level main).
  const legacyPlanningTeam = managed.createManagedTeam({
    name: 'LegacyPlanning', description: 'd', subagentIds: [], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  const legacyPlanning = managed.appendMainAgentThread(legacyPlanningTeam.id, { from: 'coordinator', content: 'old planning', read: false, type: 'planning' })!;
  assert.deepEqual(managed.listOpenEscalations(legacyPlanningTeam.id).map(v => v.id), [legacyPlanning.id], 'legacy unread planning is listed');

  console.log('team escalation routing regression: PASS (open/dedup/6h redelivery/3-strikes/answered/FYI/packet section/sweep/batch per team/legacy status excluded/legacy planning listed)');
}

main().catch((err) => {
  console.error('team escalation routing regression: FAIL', err);
  process.exit(1);
});
