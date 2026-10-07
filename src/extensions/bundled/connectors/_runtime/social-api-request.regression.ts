import assert from 'node:assert/strict';
import instagram from '../instagram/runtime.js';
import linkedin from '../linkedin/runtime.js';
import tiktok from '../tiktok/runtime.js';
import { registerSocialApiRequest } from './social-api-request.js';
import { resolveToolCapabilityMetadata } from '../../../../gateway/tool-capabilities.js';

async function main() {
  const originalFetch = globalThis.fetch;
  const ids = ['instagram', 'linkedin', 'tiktok'];
  const saved = ids.map(id => process.env[`${id.toUpperCase()}_ACCESS_TOKEN`]);
  let calls = 0;
  try {
    for (const [index, extension] of [instagram, linkedin, tiktok].entries()) {
      const id = ids[index];
      const key = `${id.toUpperCase()}_ACCESS_TOKEN`;
      process.env[key] = 'regression-token';
      const tools: any[] = [];
      extension.register({ registerConnector() {}, registerTool(tool: any) { tools.push(tool); } } as any);
      assert.equal(tools[0].name, `connector_${id}_api_request`);
      const host = ['graph.instagram.com', 'api.linkedin.com', 'open.tiktokapis.com'][index];
      let token: string | undefined = 'regression-token';
      let tool: any;
      registerSocialApiRequest({ registerConnector() {}, registerTool(t: any) { tool = t; } } as any, id, id, `https://${host}`, '/me', undefined, () => token);
      globalThis.fetch = (async (input: any, init: any) => {
        calls++;
        assert.equal(new URL(String(input)).hostname, host);
        assert.equal(init.headers.Authorization, 'Bearer regression-token');
        assert.equal(init.redirect, 'manual');
        return new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch;
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        assert.equal(resolveToolCapabilityMetadata(tool.name, undefined, { method }).externalWrite, !['GET', 'HEAD'].includes(method));
        assert.equal((await tool.execute({ path: '/me', method, body: { test: true } })).error, false);
      }
      const before = calls;
      for (const path of ['https://evil.example/', '//evil.example/', '/../../secret', '/%2e%2e/secret', '/a\\b', '/@evil']) {
        assert.equal((await tool.execute({ path, method: 'GET' })).error, true, path);
      }
      assert.equal(calls, before, 'invalid paths must never reach fetch');
      delete process.env[key];
      token = undefined;
      assert.equal((await tool.execute({ path: '/me', method: 'GET' })).error, true);
      assert.equal(calls, before, 'missing token must never reach fetch');
    }
  } finally {
    globalThis.fetch = originalFetch;
    ids.forEach((id, i) => { const key = `${id.toUpperCase()}_ACCESS_TOKEN`; if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  }
  assert.equal(calls, 18);
  console.log('PASS social API requests: three fixed hosts, six methods, traversal/host rejection, bearer credentials and approval metadata');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
