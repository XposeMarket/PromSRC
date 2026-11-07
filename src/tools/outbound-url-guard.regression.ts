/**
 * Regression for the two confirmed findings of the 2026-11-06 security audit
 * (Cloudflare security-audit skill, audits/2026-11-06-security-audit/run-1):
 *
 * 1. promsrc/web-fetch-loopback-ssrf-gateway-confused-deputy: auto-approved
 *    web_fetch could reach http://127.0.0.1:<gateway>/api/open-path (directly or
 *    via a public 302) and the GET handler interpolated the path into a shell.
 * 2. promsrc/mcp-oauth-authorize-url-cmd-injection-win32: a remote MCP server's
 *    authorization_endpoint reached `cmd /c start "" <url>` unquoted.
 *
 * Both polarities: public destinations still work; private ones are refused.
 * No real network and no real process launches.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-outbound-guard-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;
process.env.MCP_OAUTH_NO_BROWSER = '1';
delete process.env.PROMETHEUS_ALLOW_PRIVATE_FETCH;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = require('./outbound-url-guard') as typeof import('./outbound-url-guard');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mcpOAuth = require('../gateway/mcp-oauth') as typeof import('../gateway/mcp-oauth');

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const publicLookup = async () => ['93.184.216.34'];
const rejectsBlocked = async (p: Promise<unknown>, re: RegExp = /Blocked fetch|Only http/) => {
  await assert.rejects(p, (err: any) => err instanceof guard.OutboundUrlBlockedError && re.test(err.message));
};

async function main(): Promise<void> {
  await check('blocks loopback, private, link-local, CGNAT and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.100.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1',
      'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', 'not-an-ip']) {
      assert.equal(guard.isBlockedAddress(ip), true, `${ip} must be blocked`);
    }
  });

  await check('allows ordinary public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(guard.isBlockedAddress(ip), false, `${ip} must be allowed`);
    }
  });

  await check('assertPublicUrl refuses loopback hosts, local names, non-http schemes and private DNS answers', async () => {
    await rejectsBlocked(guard.assertPublicUrl('http://127.0.0.1:18789/api/sessions'));
    await rejectsBlocked(guard.assertPublicUrl('http://[::1]:18789/'));
    await rejectsBlocked(guard.assertPublicUrl('http://localhost:18789/'));
    await rejectsBlocked(guard.assertPublicUrl('http://printer.local/'));
    await rejectsBlocked(guard.assertPublicUrl('http://2130706433/')); // WHATWG URL parses to 127.0.0.1
    await rejectsBlocked(guard.assertPublicUrl('file:///C:/Windows/win.ini'));
    await rejectsBlocked(guard.assertPublicUrl('http://rebind.example/', { lookup: async () => ['93.184.216.34', '127.0.0.1'] }));
    const ok = await guard.assertPublicUrl('https://example.com/page', { lookup: publicLookup });
    assert.equal(ok.hostname, 'example.com');
  });

  await check('fetchPublicUrl refuses a public URL that 302-redirects to the gateway, before requesting it', async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: any, init: any) => {
      requested.push(String(input));
      assert.equal(init.redirect, 'manual', 'fetch must never follow redirects itself');
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:18789/api/open-path?path=x' } });
    }) as typeof fetch;
    await rejectsBlocked(guard.fetchPublicUrl('https://attacker.example/r', {}, { fetchImpl, lookup: publicLookup }));
    assert.deepEqual(requested, ['https://attacker.example/r'], 'the loopback hop must not be requested');
  });

  await check('fetchPublicUrl still follows public redirects, rewrites 303 to GET, and caps hops', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    const fetchImpl = (async (input: any, init: any) => {
      const url = String(input);
      seen.push({ url, method: init.method });
      if (url.endsWith('/a')) return new Response(null, { status: 303, headers: { location: '/b' } });
      return new Response('done', { status: 200, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
    const res = await guard.fetchPublicUrl('https://example.com/a', { method: 'POST', body: 'x' }, { fetchImpl, lookup: publicLookup });
    assert.equal(await res.text(), 'done');
    assert.deepEqual(seen, [{ url: 'https://example.com/a', method: 'POST' }, { url: 'https://example.com/b', method: 'GET' }]);
    const loop = (async () => new Response(null, { status: 302, headers: { location: '/again' } })) as typeof fetch;
    await assert.rejects(guard.fetchPublicUrl('https://example.com/x', {}, { fetchImpl: loop, lookup: publicLookup, maxRedirects: 3 }), /Too many redirects/);
  });

  await check('PROMETHEUS_ALLOW_PRIVATE_FETCH=1 is an explicit owner opt-out', async () => {
    process.env.PROMETHEUS_ALLOW_PRIVATE_FETCH = '1';
    try {
      const u = await guard.assertPublicUrl('http://127.0.0.1:3000/');
      assert.equal(u.port, '3000');
    } finally {
      delete process.env.PROMETHEUS_ALLOW_PRIVATE_FETCH;
    }
  });

  await check('real web_fetch and download_url refuse the gateway loopback API without sending a request', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const web = require('./web') as typeof import('./web');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dl = require('./download-tools') as typeof import('./download-tools');
    const originalFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => { called += 1; return new Response('owner data'); }) as typeof fetch;
    try {
      const r = await web.executeWebFetch({ url: 'http://127.0.0.1:18789/api/open-path?path=x' });
      assert.equal(r.success, false);
      assert.match(String(r.error), /Blocked fetch/);
      const d = await dl.executeDownloadUrl({ url: 'http://localhost:18789/api/settings' });
      assert.equal(d.success, false);
      assert.match(String(d.error), /Blocked fetch/);
      assert.equal(called, 0, 'no request may reach a loopback destination');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await check('GET /api/open-path shell route is gone; POST sibling uses execFile', () => {
    const canvas = fs.readFileSync(path.join(__dirname, '../gateway/routes/canvas.router.ts'), 'utf8');
    assert.ok(!/router\.get\(\s*['"]\/api\/open-path/.test(canvas), 'canvas GET /api/open-path must not exist');
    assert.ok(!/start "" "\$\{fp\}"/.test(canvas), 'no shell-interpolated start command may remain');
    const settings = fs.readFileSync(path.join(__dirname, '../gateway/routes/settings.router.ts'), 'utf8');
    assert.ok(/router\.post\('\/api\/open-path'[\s\S]{0,1600}execFile\('explorer\.exe', \[resolvedFp\]\)/.test(settings));
  });

  await check('MCP OAuth endpoints from remote metadata must be https (http only on loopback)', () => {
    assert.equal(mcpOAuth.validateOAuthEndpoint('https://auth.example.test/authorize', 'authorization_endpoint'), 'https://auth.example.test/authorize');
    assert.equal(mcpOAuth.validateOAuthEndpoint('http://127.0.0.1:9000/authorize', 'authorization_endpoint'), 'http://127.0.0.1:9000/authorize');
    for (const bad of ['http://evil.example/authorize', 'javascript:alert(1)', 'file:///C:/x', 'ms-settings:', 'https://u:p@auth.example.test/a', 'not a url']) {
      assert.throws(() => mcpOAuth.validateOAuthEndpoint(bad, 'authorization_endpoint'), /authorization_endpoint/, bad);
    }
  });

  await check('browser launch never goes through cmd.exe and rejects shell-hostile URLs', () => {
    const payload = 'https://example.invalid/authorize?x=1&mkdir=MCPURL_MARK&state=abc';
    const win = mcpOAuth.browserLaunchCommand(payload, 'win32');
    assert.equal(win.command, 'rundll32.exe');
    assert.deepEqual(win.args, ['url.dll,FileProtocolHandler', payload]);
    assert.ok(!/cmd/i.test(win.command));
    assert.deepEqual(mcpOAuth.browserLaunchCommand(payload, 'darwin'), { command: 'open', args: [payload] });
    assert.deepEqual(mcpOAuth.browserLaunchCommand(payload, 'linux'), { command: 'xdg-open', args: [payload] });
    assert.throws(() => mcpOAuth.browserLaunchCommand('file:///C:/Windows/System32/calc.exe', 'win32'), /non-http/);
    // Quotes/spaces are percent-encoded by URL serialization, so they never reach argv raw.
    const quoted = mcpOAuth.browserLaunchCommand('https://example.invalid/a"b c', 'win32');
    assert.equal(quoted.args[1], 'https://example.invalid/a%22b%20c');
    const src = fs.readFileSync(path.join(__dirname, '../gateway/mcp-oauth.ts'), 'utf8');
    assert.ok(!/spawn\('cmd'/.test(src), 'mcp-oauth must not spawn cmd');
  });

  await check('MCP discovery rejects a non-https authorization_endpoint from remote metadata', async () => {
    const originalFetch = globalThis.fetch;
    const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) return json({ authorization_servers: ['https://auth.evil.test'] });
      if (url.includes('oauth-authorization-server')) return json({ authorization_endpoint: 'http://auth.evil.test/authorize?x=1&calc', token_endpoint: 'https://auth.evil.test/token' });
      return new Response('no', { status: 404 });
    }) as typeof fetch;
    try {
      await assert.rejects(mcpOAuth.discoverMcpAuthServer('https://mcp.evil.test/mcp'), /authorization_endpoint must be an https URL/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log(`\n${passed} checks passed`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
