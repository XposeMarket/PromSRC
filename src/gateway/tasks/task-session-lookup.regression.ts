import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-task-session-index-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  try {
    const tasks = await import('./task-store');
    const recovery = await import('./task-recovery');
    const router = await import('./task-router');
    const teams = await import('../teams/managed-teams');
    const save = (task: any, patch: Record<string, unknown>) => {
      Object.assign(task, patch);
      tasks.saveTask(task);
      return task;
    };
    const before = tasks.getTaskSessionLookupRevision();
    const older = tasks.createTask({
      title: 'Older indexed task', prompt: 'older', sessionId: 'shared-session', channel: 'web', plan: [],
    });
    const newest = tasks.createTask({
      title: 'Newest indexed task', prompt: 'newest', sessionId: 'shared-session', channel: 'web', plan: [],
    });
    assert.ok(tasks.getTaskSessionLookupRevision() > before, 'task writes must invalidate session lookups');
    const found = tasks.findTaskBySessionId('shared-session');
    assert.equal(found?.id, newest.id, 'session lookup should preserve the previous newest-task behavior');
    assert.notEqual(found?.id, older.id);
    assert.equal(tasks.findTaskBySessionId('ordinary-session'), null);

    const blockedOlder = save(tasks.createTask({
      title: 'Older blocked owner task', prompt: 'older blocked', sessionId: 'owner-session', channel: 'web', plan: [],
    }), { status: 'failed', lastProgressAt: 100 });
    const blockedNewest = save(tasks.createTask({
      title: 'Newest blocked owner task', prompt: 'newest blocked', sessionId: 'owner-session', channel: 'web', plan: [],
    }), { status: 'stalled', lastProgressAt: 300 });
    const userPaused = save(tasks.createTask({
      title: 'User-paused task', prompt: 'paused', sessionId: 'owner-session', channel: 'web', plan: [],
    }), { status: 'paused', pauseReason: 'user_pause', lastProgressAt: 400 });
    const clarification = save(tasks.createTask({
      title: 'Clarification task', prompt: 'clarify', sessionId: 'clarification-session', channel: 'web', plan: [],
    }), { status: 'awaiting_user_input', pendingClarificationQuestion: 'Which option?', lastProgressAt: 500 });

    assert.equal(router.findBlockedTaskForSession('owner-session')?.id, blockedNewest.id, 'newest eligible owner task wins');
    assert.equal(router.findClarificationWaitingTask('clarification-session')?.id, clarification.id);
    assert.equal(router.latestTaskForSession('owner-session', ['failed', 'stalled', 'paused'])?.id, userPaused.id, 'latest-task lookup keeps its unfiltered newest semantics');
    assert.notEqual(router.findBlockedTaskForSession('owner-session')?.pauseReason, 'user_pause', 'user-paused tasks stay excluded');
    void blockedOlder;

    const originating = save(tasks.createTask({
      title: 'Origin route', prompt: 'origin', sessionId: 'worker-session', channel: 'web', plan: [],
    }), { status: 'failed', originatingSessionId: 'originating-session', lastProgressAt: 600 });
    const subagent = save(tasks.createTask({
      title: 'Subagent route', prompt: 'subagent', sessionId: 'subagent-owner', channel: 'web', plan: [],
    }), { status: 'needs_assistance', subagentProfile: 'agent/name', lastProgressAt: 610 });

    const team = teams.createManagedTeam({
      name: 'Lookup team', description: 'fixture', subagentIds: ['member-a'], teamContext: 'fixture', managerSystemPrompt: 'fixture',
    });
    const memberThread = teams.getOrCreateTeamDirectThread(team.id, 'member', 'member-a', 'Member A');
    const managerThread = teams.getOrCreateTeamDirectThread(team.id, 'manager', 'manager', 'Manager');
    assert.ok(memberThread?.sessionId);
    assert.ok(managerThread?.sessionId);
    const memberTask = save(tasks.createTask({
      title: 'Member direct route', prompt: 'member', sessionId: 'member-owner', channel: 'web', plan: [],
    }), { status: 'failed', teamSubagent: { teamId: team.id, agentId: 'member-a' }, lastProgressAt: 620 });
    const managerTask = save(tasks.createTask({
      title: 'Manager direct route', prompt: 'manager', sessionId: 'manager-owner', channel: 'web', plan: [],
    }), {
      status: 'failed',
      proposalExecution: { teamExecution: { teamId: team.id, managerSessionId: 'manager-session', executorAgentId: 'member-a', returnTarget: 'team_chat' } },
      lastProgressAt: 630,
    });

    const replyCandidates = (sessionId: string) => tasks.findTaskCandidatesForReplySession(sessionId, { status: ['failed', 'needs_assistance'] });
    assert.ok(replyCandidates('originating-session').some((task) => task.id === originating.id));
    assert.ok(replyCandidates('subagent_chat_agent_name').some((task) => task.id === subagent.id));
    assert.ok(replyCandidates(memberThread!.sessionId).some((task) => task.id === memberTask.id), 'member direct-thread route remains a candidate');
    assert.ok(replyCandidates(managerThread!.sessionId).some((task) => task.id === managerTask.id), 'manager direct-thread route remains a candidate');
    assert.ok(recovery.matchesTaskReplySession(memberTask, memberThread!.sessionId));
    assert.ok(recovery.matchesTaskReplySession(managerTask, managerThread!.sessionId));

    for (let index = 0; index < 220; index += 1) {
      save(tasks.createTask({
        title: `Unrelated ${index}`, prompt: 'history', sessionId: `unrelated-${index}`, channel: 'web', plan: [],
      }), { status: 'failed', lastProgressAt: index });
    }
    assert.equal(router.findBlockedTaskForSession('no-match-session'), null);
    const noMatchStats = tasks.getLastTaskIndexLookupStats();
    assert.equal(noMatchStats.kind, 'owner_session');
    assert.ok(noMatchStats.indexEntries >= 220, `expected hundreds of compact index entries, got ${noMatchStats.indexEntries}`);
    assert.equal(noMatchStats.candidateCount, 0);
    assert.equal(noMatchStats.loadedCount, 0, 'no-match owner lookup must not deserialize unrelated task files');
    console.log('task session lookup regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main();
