import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearTokens, isConnected, refreshTokens, saveTokens } from '../src/auth/openai-oauth';

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disconnect-test-'));
  const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: 1 };
  const originalFetch = globalThis.fetch;
  try {
    fs.mkdirSync(path.join(dir, 'credentials'));
    fs.writeFileSync(path.join(dir, 'credentials/oauth-openai.json'), JSON.stringify(tokens));
    saveTokens(dir, tokens, 'other');
    assert.equal(isConnected(dir, 'default'), true); // migrate both historical keys
    clearTokens(dir, 'other');
    assert.equal(isConnected(dir, 'other'), false);
    assert.equal(isConnected(dir, 'default'), true);
    saveTokens(dir, tokens, 'other');
    let release!: () => void;
    globalThis.fetch = async () => { await new Promise<void>(resolve => { release = resolve; }); return Response.json(tokens); };
    const pending = refreshTokens(dir, 'default');
    clearTokens(dir, 'default');
    release();
    await assert.rejects(pending, /disconnected/);
    assert.equal(isConnected(dir, 'default'), false);
    assert.equal(isConnected(dir, 'other'), true);
    fs.writeFileSync(path.join(dir, 'credentials/oauth-openai.json'), JSON.stringify(tokens));
    clearTokens(dir, 'default');
    assert.equal(isConnected(dir, 'default'), false);
    saveTokens(dir, tokens, 'default');
    assert.equal(isConnected(dir, 'default'), true);
    // A refresh that fails after a disconnect must not adopt a later sign-in.
    globalThis.fetch = async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response(null, { status: 401 }); };
    const oldLogin = refreshTokens(dir, 'default');
    clearTokens(dir, 'default');
    saveTokens(dir, { ...tokens, refresh_token: 'replacement-fixture', expires_at: Date.now() + 3600000 }, 'default');
    release();
    await assert.rejects(oldLogin, /disconnected/);
    assert.equal(isConnected(dir, 'default'), true);
    console.log('PASS: isolated named/default disconnect, legacy migration, pending refresh and reconnect');
  } finally { globalThis.fetch = originalFetch; fs.rmSync(dir, {recursive:true, force:true}); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
