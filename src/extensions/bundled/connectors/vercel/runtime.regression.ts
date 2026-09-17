import assert from 'node:assert/strict';
import vercelExtension from './runtime.js';

const registeredTools = new Map<string, any>();
vercelExtension.register({
  registerConnector: () => undefined,
  registerTool: (tool: any) => registeredTools.set(tool.name, tool),
} as any);

const context = {
  extensionId: 'vercel',
  trustLevel: 'bundled',
  getCredential: (field: string) => field === 'apiKey' ? 'regression-test-token' : undefined,
} as any;

let lastUrl: URL | undefined;
let lastInit: RequestInit | undefined;
let fetchCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  fetchCount += 1;
  lastUrl = new URL(String(input));
  lastInit = init;
  const body = lastUrl.pathname === '/v13/deployments'
    ? { uid: 'test-deployment', readyState: 'QUEUED' }
    : lastUrl.pathname.endsWith('/events')
      ? [{ payload: { date: 'not-a-timestamp', text: 'build started' } }]
      : { teams: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function run() {
  try {
    const createDeployment = registeredTools.get('connector_vercel_create_deployment');
    assert(createDeployment, 'create deployment tool must register');

    for (const [provider, identifier, value] of [
      ['gitlab', 'projectId', 'gitlab-project-17'],
      ['bitbucket', 'repoUuid', '{bb-repository-uuid}'],
    ]) {
      const result = await createDeployment.execute({
        name: 'regression-deployment',
        gitSource: { type: provider, [identifier]: value, ref: 'main' },
      }, context);
      assert.equal(result.error, false, `${provider} source deployment should be accepted`);
      const body = JSON.parse(String(lastInit?.body));
      assert.equal(body.gitSource[identifier], value, `${provider} source identifier must survive normalization`);
    }

    const events = registeredTools.get('connector_vercel_deployment_events');
    assert(events, 'deployment events tool must register');
    const malformedTimestamp = await events.execute({ deployment: 'deployment-1', limit: -4 }, context);
    assert.equal(malformedTimestamp.error, false, 'a malformed event timestamp must not fail the events request');
    assert.match(malformedTimestamp.result, /build started/, 'event text should remain available without a valid timestamp');
    assert.equal(lastUrl?.searchParams.get('limit'), '1', 'negative event limits must clamp to one');

    const listTeams = registeredTools.get('connector_vercel_list_teams');
    await listTeams.execute({ limit: -20 }, context);
    assert.equal(lastUrl?.searchParams.get('limit'), '1', 'negative list limits must clamp to one');

    const apiRequest = registeredTools.get('connector_vercel_api_request');
    const beforeTraversal = fetchCount;
    const traversal = await apiRequest.execute({ path: '/v9/%2e%2e/projects' }, context);
    assert.equal(traversal.error, true, 'encoded parent-directory traversal must be rejected');
    assert.equal(fetchCount, beforeTraversal, 'rejected traversal must not reach fetch');

    const encodedSeparator = await apiRequest.execute({ path: '/v9/%2e%2e%2fprojects' }, context);
    assert.equal(encodedSeparator.error, true, 'encoded path separators must be rejected');
    assert.equal(fetchCount, beforeTraversal, 'encoded-separator traversal must not reach fetch');

    const validRequest = await apiRequest.execute({ path: '/v9/projects' }, context);
    assert.equal(validRequest.error, false, 'valid versioned API paths should remain usable');
    assert.equal(lastUrl?.pathname, '/v9/projects');
    console.log('vercel connector regression: ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
