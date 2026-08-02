import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-thread-route-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');

async function main(): Promise<void> {
  try {
    const threadOps = await import('./thread-ops');
    const sessionApi = await import('../session');
    const configApi = await import('../../config/config');
    const root = path.resolve(__dirname, '../../..');
    const source = fs.readFileSync(path.join(root, 'src/gateway/threads/thread-ops.ts'), 'utf8');
    const toolDefs = fs.readFileSync(path.join(root, 'src/gateway/tools/defs/agent-team-schedule.ts'), 'utf8');

    const inherited = {
      providerId: 'openai',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      accountId: 'terra-account',
      config: {
        llm: {
          providers: {
            openai: { model: 'gpt-5.6-terra', defaultAccountId: 'terra-account' },
            xai: { model: 'grok-4.5', defaultAccountId: 'grok-account' },
          },
        },
      },
    } as any;

    // The normal case persists no override, so every new thread follows the
    // current Main Chat route at its own next-turn admission boundary.
    assert.equal(threadOps.resolveManagedThreadModelRoute({ title: 'Default' }, {}, inherited), undefined);

    assert.deepEqual(
      threadOps.resolveManagedThreadModelRoute({ provider_id: 'openai', model: 'gpt-5.6-terra', reasoning_effort: 'high' }, {}, inherited),
      { providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high', accountId: 'terra-account' },
    );

    // A provider switch never leaks Main Chat's account into the new route.
    assert.deepEqual(
      threadOps.resolveManagedThreadModelRoute({ provider_id: 'xai', model: 'grok-4.5', reasoning_effort: 'low' }, {}, inherited),
      { providerId: 'xai', model: 'grok-4.5', reasoningEffort: 'low' },
    );

    // A provider-only request uses that provider's saved model, while an
    // account-only or reasoning-only request makes the inherited route sticky.
    assert.deepEqual(
      threadOps.resolveManagedThreadModelRoute({ provider_id: 'xai' }, {}, inherited),
      { providerId: 'xai', model: 'grok-4.5' },
    );
    assert.deepEqual(
      threadOps.resolveManagedThreadModelRoute({ reasoning_effort: 'medium' }, {}, inherited),
      { providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'medium', accountId: 'terra-account' },
    );
    assert.deepEqual(
      threadOps.resolveManagedThreadModelRoute({ account_id: 'alternate-terra' }, {}, inherited),
      { providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high', accountId: 'alternate-terra' },
    );

    // The create action persists the requested route before it queues a turn;
    // a route-less create leaves the session inherited.
    const configManager = configApi.getConfig();
    const current = configManager.getConfig() as any;
    configManager.updateConfig({
      ...current,
      llm: {
        ...(current.llm || {}),
        provider: 'ollama',
        providers: { ...(current.llm?.providers || {}), ollama: { ...(current.llm?.providers?.ollama || {}), model: 'llama3.2' } },
      },
    });
    sessionApi.touchSession('thread_route_owner', { channel: 'web', title: 'Owner' });
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({ launch_mode: 'ping' }), 'ping');
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({ launch_mode: 'forget' }), 'forget');
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({ launch_mode: 'supervise' }), 'supervise');
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({ follow: false }), 'ping', 'legacy follow=false maps to ping');
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({}), 'supervise', 'legacy omitted follow preserves supervised default');
    assert.equal(threadOps.normalizeManagedThreadLaunchMode({ follow: true, launch_mode: 'forget' }), 'forget', 'explicit launch_mode wins');
    const launchModes = [
      ['ping', 'create_and_ping', false],
      ['forget', 'create_and_forget', false],
      ['supervise', 'create_and_supervise', true],
    ] as const;
    for (const [mode, route, follow] of launchModes) {
      const created = await threadOps.executePrometheusThreadOps('thread_route_owner', {
        action: 'create',
        title: `Launch ${mode}`,
        launch_mode: mode,
      }, {});
      assert.equal(created.session.mode, mode);
      assert.equal(created.session.route, route);
      assert.equal(created.session.follow, follow);
      assert.equal(created.session.launch.notificationMode, mode);
    }
    const aliasCreated = await threadOps.executePrometheusThreadOps('thread_route_owner', {
      action: 'create_and_forget', title: 'Alias forget',
    }, {});
    assert.equal(aliasCreated.session.mode, 'forget');

    const explicitCreated = await threadOps.executePrometheusThreadOps('thread_route_owner', {
      action: 'create', title: 'Explicit thread', follow: false, provider_id: 'ollama', model: 'llama3.2',
    }, {});
    assert.equal((configManager.getConfig() as any).llm.provider, 'ollama', 'creating a routed thread must not change durable Main Chat');
    assert.deepEqual(sessionApi.getChatModelRoute(explicitCreated.session.id), {
      version: 1, providerId: 'ollama', model: 'llama3.2', updatedAt: sessionApi.getChatModelRoute(explicitCreated.session.id)!.updatedAt,
    });
    const inheritedCreated = await threadOps.executePrometheusThreadOps('thread_route_owner', {
      action: 'create', title: 'Inherited thread', follow: false,
    }, {});
    assert.equal(sessionApi.getChatModelRoute(inheritedCreated.session.id), undefined);
    const explicitStatus = await threadOps.executePrometheusThreadOps('thread_route_owner', { action: 'status', session_id: explicitCreated.session.id }, {});
    const inheritedStatus = await threadOps.executePrometheusThreadOps('thread_route_owner', { action: 'status', session_id: inheritedCreated.session.id }, {});
    assert.equal(explicitStatus.session.chatModelRoute?.mode, 'explicit');
    assert.equal(inheritedStatus.session.chatModelRoute?.mode, 'inherited');

    assert.match(source, /validateChatModelRoute\(requestedRoute\)/);
    assert.match(source, /setChatModelRoute\(targetSessionId/);
    assert.match(source, /runDetached\(deps, ownerSessionId, targetSessionId/);
    assert.match(source, /chatModelRoute:/);
    assert.match(toolDefs, /provider_id/);
    assert.match(toolDefs, /reasoning_effort/);
    console.log('prometheus thread-ops model-route regression passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

void main();
