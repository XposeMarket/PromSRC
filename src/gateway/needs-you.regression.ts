import assert from 'assert';
import { buildNeedsYouItems } from './needs-you';

const base = Date.now();
const records = {
  questions: [
    { id: 'q1', sessionId: 'chat-q', status: 'pending', createdAt: new Date(base).toISOString(), originLabel: 'Research agent', questions: [{ id: 'what', label: 'What?', mode: 'text' }] },
    { id: 'login1', sessionId: 'chat-login', status: 'pending', createdAt: new Date(base - 10).toISOString(), loginHandoff: { site: 'Example', browserSessionId: 'chat-login' } },
    { id: 'done-q', sessionId: 'chat-done', status: 'answered' },
  ],
  approvals: [
    { id: 'approval1', sessionId: 'chat-approval', status: 'pending', createdAt: new Date(base - 20).toISOString(), approvalKind: 'final_action', toolName: 'request_final_action_approval' },
    { id: 'approval2', sessionId: 'chat-tool', status: 'pending', createdAt: new Date(base - 30).toISOString(), approvalKind: 'command', toolName: 'run_command' },
  ],
  proposals: [{ id: 'proposal1', sourceSessionId: 'chat-proposal', status: 'pending', createdAt: base - 40, type: 'src_edit', requiresSrcEdit: true }],
  supervisions: [{ id: 'supervision1', ownerSessionId: 'chat-supervision', targetTitle: 'Peer session', status: 'blocked', lastDecision: 'needs_user', lastDecisionAt: base - 50 }],
  teams: [{ id: 'team1', name: 'Build team', originatingSessionId: 'chat-team', roomState: { blockers: [{ id: 'blocker1', status: 'needs_user', createdAt: base - 60, agentId: 'member1', message: 'Need a decision' }], managerInbox: [] } }],
  tasks: [{ id: 'task1', title: 'Paused agent', originatingSessionId: 'chat-paused', status: 'needs_assistance', pauseReason: 'awaiting_user_input', startedAt: base - 70 }],
};

const expected = [
  'question:q1', 'question:login1', 'approval:approval1', 'approval:approval2',
  'proposal:proposal1', 'supervision:supervision1', 'team:team1:blocker:blocker1', 'task:task1',
];
// Protected cards: pending + unexpired only, metadata only, owner-waiting connection states only.
{
  const now = Date.now();
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();
  const protectedItems = buildNeedsYouItems({
    secureRequests: [
      { id: 'r1', sessionId: 'chat-a', status: 'pending', label: 'GitHub', origin: 'https://github.com', expiresAt: future },
      { id: 'r2', sessionId: 'chat-a', status: 'pending', label: 'Old', origin: 'https://x.com', expiresAt: past },
      { id: 'r3', sessionId: 'chat-a', status: 'saved', label: 'Done', origin: 'https://y.com', expiresAt: future },
    ],
    secureLogins: [
      { id: 'cred_1', label: 'Bank', origin: 'https://bank.test', pendingLogin: true, loginSessionId: 'chat-b', loginExpiresAt: future, loginPreparedAt: now },
      { id: 'cred_2', label: 'Idle', origin: 'https://idle.test', pendingLogin: false },
    ],
    connectionAttempts: [
      { id: 'att1', serviceId: 'notion', serviceName: 'Notion', state: 'awaiting_oauth', updatedAt: future },
      { id: 'att2', serviceId: 'slack', state: 'connected', updatedAt: future },
      { id: 'att3', serviceId: 'gmail', state: 'testing', updatedAt: future },
    ],
  }, now);
  assert.deepEqual(protectedItems.map((i) => i.kind).sort(), ['connection_setup', 'secure_access', 'secure_login']);
  const serialized = JSON.stringify(protectedItems);
  assert.ok(!/secret|password"\s*:/i.test(serialized), 'no secret-bearing fields');
  assert.equal(protectedItems.find((i) => i.kind === 'secure_login')?.sessionId, 'chat-b');
}

const first = buildNeedsYouItems(records);
assert.deepStrictEqual(new Set(first.map((item) => item.id)), new Set(expected));
assert.deepStrictEqual(new Set(first.map((item) => item.kind)), new Set([
  'question', 'browser_login', 'final_action_approval', 'tool_approval',
  'dev_source_edit_proposal', 'needs_user_supervision', 'team_escalation', 'paused_agent_run',
]));
assert.strictEqual(first.find((item) => item.id === 'question:q1')?.payload.id, 'q1');
assert.strictEqual(first.find((item) => item.id === 'approval:approval1')?.payload.id, 'approval1');

// A live backing-store status transition to answered/approved/resolved removes the same record.
const resolved = buildNeedsYouItems({
  ...records,
  questions: records.questions.map((record) => record.id === 'q1' ? { ...record, status: 'answered' } : record),
  approvals: records.approvals.map((record) => record.id === 'approval1' ? { ...record, status: 'approved' } : record),
  proposals: records.proposals.map((record) => ({ ...record, status: 'approved' })),
  supervisions: records.supervisions.map((record) => ({ ...record, status: 'complete' })),
  teams: [{ ...records.teams[0], roomState: { blockers: [{ ...records.teams[0].roomState.blockers[0], resolvedAt: new Date().toISOString() }], managerInbox: [] } }],
  tasks: [{ ...records.tasks[0], status: 'running', pauseReason: '' }],
});
assert.deepStrictEqual(new Set(resolved.map((item) => item.id)), new Set(['question:login1', 'approval:approval2']));
console.log('needs-you regression: all eight pending kinds normalize; completed records disappear');
