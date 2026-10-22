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

    // ── Index recovery after an outside JSON edit (warm cache, then edit disk directly) ──
    const warm = storeApi.createProject('Warm A');
    const cold = storeApi.createProject('Warm B');
    seed('chat_ext');
    storeApi.attachSessionToProject(warm.id, 'chat_ext');
    assert.equal(storeApi.findProjectBySessionId('chat_ext')?.id, warm.id, 'warm cache sees the owner');
    const projectFile = (id: string): string => {
      const hit = (fs.readdirSync(root, { recursive: true }) as string[]).map(String).find((p) => p.endsWith(`${id}.json`));
      assert.ok(hit, `project file exists for ${id}`);
      return path.join(root, hit!);
    };
    const editOnDisk = (id: string, mutate: (sessions: any[]) => any[]): void => {
      const file = projectFile(id);
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      parsed.sessions = mutate(parsed.sessions || []);
      fs.writeFileSync(file, JSON.stringify(parsed, null, 2), 'utf-8');
    };
    editOnDisk(warm.id, (sessions) => sessions.filter((s) => s.id !== 'chat_ext'));
    editOnDisk(cold.id, (sessions) => [...sessions, { id: 'chat_ext', title: 'External' }]);
    assert.equal(storeApi.findProjectBySessionId('chat_ext')?.id, cold.id, 'outside edit: returns the true owner, not the stale one');
    editOnDisk(cold.id, (sessions) => sessions.filter((s) => s.id !== 'chat_ext'));
    assert.equal(storeApi.findProjectBySessionId('chat_ext'), null, 'outside removal: never returns the stale owner');

    // ── Router: strict booleans, 400/404 paths, delete counts (real express app) ──
    const express = (await import('express')).default;
    const { router: projectsRouter } = await import('../routes/projects.router');
    const app = express();
    app.use(express.json());
    app.use(projectsRouter);
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const call = async (method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> => {
        const res = await fetch(base + url, {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json().catch(() => null) };
      };

      const routed = storeApi.createProject('Routed');
      seed('chat_route');
      storeApi.attachSessionToProject(routed.id, 'chat_route');

      const badChat = await call('DELETE', `/api/projects/${routed.id}/sessions/chat_route?deleteChat=garbage`);
      assert.equal(badChat.status, 400, 'deleteChat=garbage is 400');
      assert.equal(storeApi.findProjectBySessionId('chat_route')?.id, routed.id, 'bad deleteChat changes nothing (still owned)');
      assert.equal(sessionApi.sessionExists('chat_route'), true, 'bad deleteChat changes nothing (chat kept)');

      const badProject = await call('DELETE', `/api/projects/${routed.id}?deleteSessions=garbage`);
      assert.equal(badProject.status, 400, 'deleteSessions=garbage is 400');
      assert.ok(storeApi.getProject(routed.id), 'bad deleteSessions changes nothing (project kept)');

      const noSession = await call('POST', `/api/projects/${routed.id}/sessions/attach`, {});
      assert.equal(noSession.status, 400, 'attach without sessionId is 400');
      const noProject = await call('POST', '/api/projects/missing_project_id/sessions/attach', { sessionId: 'chat_route' });
      assert.equal(noProject.status, 404, 'attach to unknown project is 404');
      const noChat = await call('POST', `/api/projects/${routed.id}/sessions/attach`, { sessionId: 'no_such_chat' });
      assert.equal(noChat.status, 404, 'attach unknown session is 404');
      assert.equal(sessionApi.sessionExists('no_such_chat'), false, 'failed attach creates nothing');

      seed('chat_count_a');
      seed('chat_count_b');
      const keepCounted = storeApi.createProject('Keep Counted');
      storeApi.attachSessionToProject(keepCounted.id, 'chat_count_a');
      storeApi.attachSessionToProject(keepCounted.id, 'chat_count_b');
      const keepRes = await call('DELETE', `/api/projects/${keepCounted.id}?deleteSessions=false`);
      assert.equal(keepRes.status, 200);
      assert.deepEqual([keepRes.json.deletedSessions, keepRes.json.keptSessions], [0, 2], 'keep mode counts 0 deleted, 2 kept');
      assert.equal(sessionApi.sessionExists('chat_count_a'), true, 'keep mode keeps chats');

      const dropCounted = storeApi.createProject('Drop Counted');
      seed('chat_drop_a');
      seed('chat_drop_b');
      storeApi.attachSessionToProject(dropCounted.id, 'chat_drop_a');
      storeApi.attachSessionToProject(dropCounted.id, 'chat_drop_b');
      const dropRes = await call('DELETE', `/api/projects/${dropCounted.id}?deleteSessions=true`);
      assert.equal(dropRes.status, 200);
      assert.deepEqual([dropRes.json.deletedSessions, dropRes.json.keptSessions], [2, 0], 'delete mode counts 2 deleted, 0 kept');
      assert.equal(sessionApi.sessionExists('chat_drop_a'), false, 'deleteSessions=true deletes the chats');

      const detachRes = await call('DELETE', `/api/projects/${routed.id}/sessions/chat_route?deleteChat=false`);
      assert.equal(detachRes.status, 200, 'deleteChat=false detaches');
      assert.equal(sessionApi.sessionExists('chat_route'), true, 'detach keeps the chat');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    console.log('project-membership regression passed');
  } finally {
    // The audit logger may still be flushing into the temp dir; retry instead of failing on ENOTEMPTY.
    // Best-effort: a Windows temp dir left behind must not turn a passing test into a failure.
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error: any) { console.warn(`[project-membership] temp cleanup skipped: ${error?.code || error}`); }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
