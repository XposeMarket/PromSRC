import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Reversible chat membership: attach/move/detach/delete semantics, the session->project index,
// and the prometheus_thread_ops project actions. Chats must never be deleted by a membership action.

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-project-membership-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const sessionApi = await import('../session');
    const storeApi = await import('./project-store');
    const threadOps = await import('../threads/thread-ops');

    const seed = (id: string): void => {
      sessionApi.addMessage(id, { role: 'user', content: `hello ${id}`, timestamp: Date.now() });
      sessionApi.flushSession(id);
    };

    // ── Store: attach / move / idempotent ─────────────────────────────────────
    seed('chat_one');
    seed('chat_two');
    const alpha = storeApi.createProject('Alpha');
    const beta = storeApi.createProject('Beta');

    assert.equal(storeApi.findProjectBySessionId('chat_one'), null, 'unowned chat has no project');
    assert.ok(storeApi.attachSessionToProject(alpha.id, 'chat_one'), 'attach existing unowned chat');
    assert.equal(storeApi.findProjectBySessionId('chat_one')?.id, alpha.id);
    storeApi.attachSessionToProject(alpha.id, 'chat_one');
    assert.equal(storeApi.getProject(alpha.id)!.sessions.filter((s) => s.id === 'chat_one').length, 1, 'attach is idempotent');

    storeApi.attachSessionToProject(beta.id, 'chat_one');
    assert.equal(storeApi.getProject(alpha.id)!.sessions.some((s) => s.id === 'chat_one'), false, 'source project loses the chat');
    assert.equal(storeApi.getProject(beta.id)!.sessions.filter((s) => s.id === 'chat_one').length, 1, 'target holds the chat once');
    assert.equal(storeApi.findProjectBySessionId('chat_one')?.id, beta.id, 'index follows the move, no stale owner');

    assert.equal(storeApi.attachSessionToProject('missing_project', 'chat_two'), null, 'unknown project returns null');
    assert.equal(storeApi.attachSessionToProject(beta.id, 'no_such_chat'), null, 'unknown session returns null');
    assert.equal(sessionApi.sessionExists('no_such_chat'), false, 'attach never creates a session');

    // ── Store: detach keeps the chat; explicit delete removes it ─────────────
    assert.equal(storeApi.detachSessionFromProject(beta.id, 'chat_one'), true);
    assert.equal(storeApi.findProjectBySessionId('chat_one'), null, 'detached chat has no stale owner');
    assert.equal(sessionApi.sessionExists('chat_one'), true, 'detach keeps the chat');
    assert.ok(sessionApi.getSession('chat_one').history.length > 0, 'detach keeps history');

    storeApi.attachSessionToProject(alpha.id, 'chat_two');
    assert.equal(storeApi.deleteSessionFromProject(alpha.id, 'chat_two'), true);
    assert.equal(sessionApi.sessionExists('chat_two'), false, 'explicit delete path removes the chat');

    // ── Store: project delete keeps chats by default ─────────────────────────
    seed('chat_keep');
    seed('chat_drop');
    const gamma = storeApi.createProject('Gamma');
    storeApi.attachSessionToProject(gamma.id, 'chat_keep');
    storeApi.attachSessionToProject(gamma.id, 'chat_drop');
    assert.equal(storeApi.deleteProject(gamma.id), true);
    assert.equal(sessionApi.sessionExists('chat_keep'), true, 'project delete keeps chats by default');
    assert.equal(sessionApi.sessionExists('chat_drop'), true, 'project delete keeps chats by default');
    assert.equal(storeApi.findProjectBySessionId('chat_keep'), null, 'deleted project owns nothing');

    const delta = storeApi.createProject('Delta');
    storeApi.attachSessionToProject(delta.id, 'chat_drop');
    assert.equal(storeApi.deleteProject(delta.id, { keepSessions: false }), true);
    assert.equal(sessionApi.sessionExists('chat_drop'), false, 'keepSessions:false deletes the chats');

    // ── prometheus_thread_ops project actions ────────────────────────────────
    seed('chat_ops');
    const run = (args: any, deps: any = {}) => threadOps.executePrometheusThreadOps('owner_main', args, deps);

    const shared1 = storeApi.createProject('Shared Name');
    const shared2 = storeApi.createProject('shared name');
    await assert.rejects(run({ action: 'move_to_project', session_id: 'chat_ops', project_name: 'SHARED NAME' }), (err: any) => {
      assert.match(err.message, /ambiguous/);
      assert.match(err.message, new RegExp(shared1.id));
      assert.match(err.message, new RegExp(shared2.id));
      return true;
    }, 'ambiguous name errors and lists candidates');
    await assert.rejects(run({ action: 'move_to_project', session_id: 'chat_ops', project_name: 'No Such Project' }), /No project named/, 'missing name errors');
    await assert.rejects(run({ action: 'move_to_project', session_id: 'chat_ops' }), /exactly one/, 'no locator errors');
    await assert.rejects(run({ action: 'move_to_project', session_id: 'chat_ops', project_id: beta.id, project_name: 'Beta' }), /exactly one/, 'two locators error');
    assert.equal(storeApi.findProjectBySessionId('chat_ops'), null, 'failed moves change nothing');

    const unique = storeApi.createProject('Unique Epsilon');
    const movedByName = await run({ action: 'move_to_project', session_id: 'chat_ops', project_name: 'unique epsilon' });
    assert.equal(movedByName.project.id, unique.id, 'move by case-insensitive exact name works');
    assert.equal(storeApi.findProjectBySessionId('chat_ops')?.id, unique.id);
    const movedAgain = await run({ action: 'move_to_project', session_id: 'chat_ops', project_id: unique.id });
    assert.equal(movedAgain.project.id, unique.id, 'same-project move is idempotent');

    const listed = await run({ action: 'list_projects' });
    const epsilonRow = listed.projects.find((p: any) => p.id === unique.id);
    assert.equal(epsilonRow.sessionCount, 1);
    assert.deepEqual(epsilonRow.sessions.map((s: any) => s.id), ['chat_ops']);

    const removed = await run({ action: 'remove_from_project', session_id: 'chat_ops' });
    assert.deepEqual(removed, { removed: true, sessionId: 'chat_ops', projectId: unique.id });
    assert.equal(sessionApi.sessionExists('chat_ops'), true, 'remove_from_project never deletes the chat');
    assert.equal(storeApi.findProjectBySessionId('chat_ops'), null);
    const removedAgain = await run({ action: 'remove_from_project', session_id: 'chat_ops' });
    assert.deepEqual(removedAgain, { removed: false, reason: 'not_in_project', sessionId: 'chat_ops' });

    const created = await run({ action: 'create_project', title: 'Agent Made' });
    assert.ok(created.project.id && created.project.name === 'Agent Made', 'create_project makes a project');
    await assert.rejects(run({ action: 'create_project', title: 'Outside', workspace: os.tmpdir() }), /outside the configured workspace/, 'create_project rejects paths outside the workspace');

    await assert.rejects(
      run({ action: 'move_to_project', session_id: 'chat_ops', project_id: unique.id }, { ownerSessionIdOverride: 'owner_main', supervisionIdOverride: 'sup_1' }),
      /may only inspect/,
      'hidden supervisor cannot use project actions',
    );

    console.log('project-membership regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
