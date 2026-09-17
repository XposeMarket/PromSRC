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

    const doubleEncodedTraversal = await apiRequest.execute({ path: '/v9/%252e%252e/projects' }, context);
    assert.equal(doubleEncodedTraversal.error, true, 'double-encoded parent-directory traversal must be rejected');
    assert.equal(fetchCount, beforeTraversal, 'double-encoded traversal must not reach fetch');

    const deeplyEncodedTraversal = await apiRequest.execute({ path: '/v9/%252525252e%252525252e/projects' }, context);
    assert.equal(deeplyEncodedTraversal.error, true, 'parent-directory traversal beyond the decode depth must be rejected');
    assert.equal(fetchCount, beforeTraversal, 'deeply encoded traversal must not reach fetch');

    const rawQuery = await apiRequest.execute({ path: '/v9/projects?limit=1000000' }, context);
    assert.equal(rawQuery.error, true, 'raw query text must not bypass query validation');
    assert.equal(fetchCount, beforeTraversal, 'raw query text must not reach fetch');

    const invalidStructuredQuery = await apiRequest.execute({ path: '/v9/projects', query: { limit: 'x'.repeat(1025) } }, context);
    assert.equal(invalidStructuredQuery.error, true, 'structured query values must retain their length bound');
    assert.equal(fetchCount, beforeTraversal, 'invalid structured query must not reach fetch');

    const validRequest = await apiRequest.execute({ path: '/v9/projects', query: { limit: 10 } }, context);
    assert.equal(validRequest.error, false, 'valid versioned API paths should remain usable');
    assert.equal(lastUrl?.pathname, '/v9/projects');
    assert.equal(lastUrl?.searchParams.get('limit'), '10', 'validated structured query must be preserved');

    const encodedProjectId = await apiRequest.execute({ path: '/v9/projects/project%20name' }, context);
    assert.equal(encodedProjectId.error, false, 'ordinary encoded project identifiers should remain usable');
    assert.equal(lastUrl?.pathname, '/v9/projects/project%20name');
    console.log('vercel connector regression: ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
