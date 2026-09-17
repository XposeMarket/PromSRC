import assert from 'node:assert/strict';
import vercelExtension from '../extensions/bundled/connectors/vercel/runtime.js';
import { normalizeExternalAppWrapperTool, normalizeVercelWrapperArgs } from './agents-runtime/subagent-executor.js';

const expectedActions = [
  'status',
  'list_teams',
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'delete_project',
  'list_deployments',
  'get_deployment',
  'create_deployment',
  'redeploy',
  'deployment_events',
  'cancel_deployment',
  'delete_deployment',
  'list_aliases',
  'assign_alias',
  'env',
  'domains',
  'get_project_domain',
  'manage_project_domain',
  'api_request',
];
async function main(): Promise<void> {
  const nativeNames = new Set(expectedActions.map((action) => `connector_vercel_${action}`));
  for (const action of expectedActions) {
    const normalized = normalizeExternalAppWrapperTool('vercel_ops', { action });
    assert.equal(normalized?.error, undefined, `${action} should be accepted by vercel_ops`);
    assert.equal(normalized?.name, `connector_vercel_${action}`);
  }

  assert.deepEqual(
    normalizeVercelWrapperArgs('create_deployment', {
      project_id: 'prj_flight',
      project_name: 'flight-universe-pwa',
      git_provider: 'github',
      git_org: 'XposeMarket',
      git_repo: 'Skystrike',
      git_ref: 'flight-universe-pwa',
      git_sha: '3808ef5',
      force_new: true,
    }),
    {
      projectId: 'prj_flight',
      name: 'flight-universe-pwa',
      gitProvider: 'github',
      gitOrg: 'XposeMarket',
      gitRepo: 'Skystrike',
      gitRef: 'flight-universe-pwa',
      gitSha: '3808ef5',
      forceNew: true,
    },
  );

  assert.deepEqual(
    normalizeVercelWrapperArgs('env', {
      project_id: 'prj_flight',
      action_type: 'list',
      team_id: 'team_demo',
    }),
    { projectId: 'prj_flight', action: 'list', teamId: 'team_demo' },
  );

  assert.deepEqual(
    normalizeVercelWrapperArgs('manage_project_domain', {
      project_id: 'prj_flight',
      action_type: 'update',
      domain: 'flight.example.com',
      redirect_status_code: 308,
    }),
    { projectId: 'prj_flight', action: 'update', domain: 'flight.example.com', redirectStatusCode: 308 },
  );

  assert.deepEqual(
    normalizeVercelWrapperArgs('get_project', { project_name: 'flight-universe-pwa', team_id: 'team_demo' }),
    { projectId: 'flight-universe-pwa', teamId: 'team_demo' },
  );

  assert.deepEqual(
    normalizeVercelWrapperArgs('get_deployment', { deployment_id: 'dpl_flight', team_id: 'team_demo' }),
    { teamId: 'team_demo', deployment: 'dpl_flight' },
  );

  const apiRequest = normalizeExternalAppWrapperTool('vercel_ops', {
    action: 'api_request',
    method: 'GET',
    path: '/v9/projects/prj_flight',
    team_id: 'team_demo',
  });
  assert.equal(apiRequest?.name, 'connector_vercel_api_request');
  assert.deepEqual(apiRequest?.args, {
    method: 'GET',
    path: '/v9/projects/prj_flight',
    teamId: 'team_demo',
  });

  assert.equal(nativeNames.size, 21);
  assert.equal(normalizeExternalAppWrapperTool('vercel_ops', { action: 'not_real' })?.error, 'Unsupported vercel_ops action "not_real".');

  const runtimeTools = new Map<string, any>();
  vercelExtension.register({
    registerTool: (tool: any) => runtimeTools.set(tool.name, tool),
    registerConnector: () => undefined,
  } as any);
  assert.deepEqual([...runtimeTools.keys()], expectedActions.map((action) => `connector_vercel_${action}`));
  assert.equal(runtimeTools.get('connector_vercel_env')?.sideEffects?.externalWrite, true);
  assert.equal(runtimeTools.get('connector_vercel_delete_project')?.sideEffects?.destructive, true);

  const vercelContext: any = {
    extensionId: 'vercel',
    trustLevel: 'bundled',
    getCredential: (field: string, connectorId?: string) => field === 'apiKey' && connectorId === 'vercel' ? 'test-vercel-token' : undefined,
  };
  const eventsTool = runtimeTools.get('connector_vercel_deployment_events');
  const apiTool = runtimeTools.get('connector_vercel_api_request');
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const unboundedEvents = await eventsTool.execute({ deployment: 'dpl_test', limit: -1 }, vercelContext);
    assert.equal(unboundedEvents.error, true);
    assert.match(unboundedEvents.result, /positive number/);
    assert.equal(fetchCalls, 0);

    const invalidApiPath = await apiTool.execute({ path: '/projects' }, vercelContext);
    assert.equal(invalidApiPath.error, true);
    assert.match(invalidApiPath.result, /versioned Vercel REST endpoint/);
    assert.equal(fetchCalls, 0);

    const oversizedQuery = await apiTool.execute({ path: '/v9/projects', query: { search: 'x'.repeat(1_025) } }, vercelContext);
    assert.equal(oversizedQuery.error, true);
    assert.match(oversizedQuery.result, /1024 characters or fewer/);
    assert.equal(fetchCalls, 0);

    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('x'.repeat(1_000_001), { status: 200 });
    }) as typeof fetch;
    const oversizedResponse = await apiTool.execute({ path: '/v9/projects' }, vercelContext);
    assert.equal(oversizedResponse.error, true);
    assert.match(oversizedResponse.result, /413/);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().then(() => console.log('vercel-wrapper.regression: ok'));