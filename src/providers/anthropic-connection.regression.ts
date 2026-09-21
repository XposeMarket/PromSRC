import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveTokens } from '../auth/anthropic-oauth';
import { getVault } from '../security/vault';
import { AnthropicAdapter } from './anthropic-adapter';

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'prom-anthropic-probe-'));
  const previousFetch = globalThis.fetch;
  try {
    saveTokens(dir, { access_token: 'sk-ant-oat-test', stored_at: Date.now(), auth_type: 'setup_token' }, 'default');
    const adapter = new AnthropicAdapter({ configDir: dir, accountId: 'default' });
    let request: any;
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' });
    };
    assert.deepEqual(await adapter.diagnoseConnection('claude-fable-5-1'), { success: true, model: 'claude-fable-5-1', variant: 'plain' });
    assert.equal(request.model, 'claude-fable-5-1');
    assert.equal(request.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
    assert.equal(request.messages[0].content[0].text, 'Reply OK.');

    assert.deepEqual(await adapter.diagnoseConnection('claude-fable-5-1', 'matched-skill'), {
      success: true, model: 'claude-fable-5-1', variant: 'matched-skill',
    });
    assert.equal(request.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
    assert.match(request.system.at(-1).text, /Matched skill reference: imagegen/);

    globalThis.fetch = async () => Response.json({
      type: 'error',
      error: { type: 'invalid_request_error', message: "You're out of extra usage." },
      request_id: 'req_probe',
    }, { status: 400 });
    assert.deepEqual(await adapter.diagnoseConnection('claude-fable-5-1'), {
      success: false,
      model: 'claude-fable-5-1',
      variant: 'plain',
      error: "You're out of extra usage.",
      requestId: 'req_probe',
    });
    const diagnostic = readFileSync(join(dir, 'logs', 'anthropic-request-errors.ndjson'), 'utf8');
    assert.match(diagnostic, /"firstSystemIsPreamble":true/);
    assert.match(diagnostic, /"requestId":"req_probe"/);
    assert.doesNotMatch(diagnostic, /sk-ant-oat-test|Reply OK\./);

    // If the vault changes between reads, auth headers and the preamble must
    // still come from one credential snapshot.
    const vault = getVault(dir);
    const originalGet = vault.get.bind(vault);
    let credentialReads = 0;
    (vault as any).get = (key: string, ...args: any[]) => {
      if (key === 'anthropic.oauth_tokens.default' && ++credentialReads > 1) return null;
      return (originalGet as any)(key, ...args);
    };
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' });
    };
    await adapter.chat([{ role: 'user', content: 'Reply OK.' }], 'claude-fable-5-1', { think: false, max_tokens: 32 });
    assert.equal(credentialReads, 1);
    assert.equal(request.system[0].text, "You are Claude Code, Anthropic's official CLI for Claude.");
    (vault as any).get = originalGet;
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('Anthropic connection probe regression passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
