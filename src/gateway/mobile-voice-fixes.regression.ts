// Regression for the 2026-10-03 mobile voice pass:
//  1. voice rows are keyed by exchange even when a message/request id is set
//     (otherwise every spoken exchange merged into one user + one AI row);
//  2. an unscoped Codex OAuth lookup resolves to the stored account
//     (camera vision fallback said "Codex OAuth is not connected");
//  3. Codex dynamic tools keep prometheus_tools under the 96-tool cap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historyMessageMergeKey } from './history-reconciliation';

{
  const a = { role: 'user', content: 'first', messageId: 'shared-id', clientRequestId: 'req-1', workflowGroupId: 'voice_exchange_1_a', workflowPart: 'voice_user' };
  const b = { role: 'user', content: 'second', messageId: 'shared-id', clientRequestId: 'req-1', workflowGroupId: 'voice_exchange_2_b', workflowPart: 'voice_user' };
  assert.notEqual(historyMessageMergeKey(a), historyMessageMergeKey(b), 'two voice exchanges must never share a merge key');
  const grown = { ...a, content: 'first and more words' };
  assert.equal(historyMessageMergeKey(a), historyMessageMergeKey(grown), 'a growing voice row keeps one identity');
  const synthetic = { role: 'user', content: 'x', messageId: 'mobile-request:r9:user', workflowGroupId: 'voice_exchange_3_c', workflowPart: 'voice_user' };
  assert.equal(historyMessageMergeKey(synthetic), 'user|voice:voice_exchange_3_c|voice_user');
  assert.equal(historyMessageMergeKey({ role: 'user', content: 'typed', messageId: 'm1' }), 'user|id:m1', 'non-voice rows unchanged');
}

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-codex-acct-'));
  process.env.PROMETHEUS_VAULT_ALLOW_PLAINTEXT_KEY = process.env.PROMETHEUS_VAULT_ALLOW_PLAINTEXT_KEY || '1';
  const oauth = await import('../auth/openai-oauth');
  assert.equal(oauth.loadTokens(configDir), null, 'empty vault has no tokens');
  const tokens = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3_600_000, account_id: 'acct' } as any;
  oauth.saveTokens(configDir, tokens, 'default');
  assert.equal(oauth.resolveCodexAccountId(configDir), 'default');
  assert.equal(oauth.loadTokens(configDir)?.access_token, 'a', 'unscoped lookup finds the account-scoped token');
  assert.equal(oauth.loadTokens(configDir, 'other'), null, 'an explicit other account is not aliased');
  assert.equal(await oauth.getValidToken(configDir), 'a');

  const router = fs.readFileSync(path.join(__dirname, 'routes', 'realtime.router.ts'), 'utf8');
  assert.match(router, /CODEX_BRIDGE_PRIORITY_TOOLS = \['prometheus_tools'/, 'prometheus_tools is first priority under the Codex cap');
  // 4. Codex camera vision: the ChatGPT backend's `{ detail }` errors surface, and
  //    a rejected API-only model falls through to the account's own model.
  const { codexHttpErrorDetail } = await import('../providers/openai-codex-adapter');
  assert.equal(codexHttpErrorDetail(JSON.stringify({ detail: 'model not supported' })), 'model not supported');
  assert.equal(codexHttpErrorDetail(JSON.stringify({ error: { message: 'bad' } })), 'bad');
  const { codexVisionModelCandidates } = await import('./tools/handlers/xai-handlers');
  const candidates = codexVisionModelCandidates('gpt-6-astra');
  assert.equal(candidates[0], process.env.XAI_VISION_FALLBACK_MODEL || process.env.OPENAI_VISION_FALLBACK_MODEL || 'gpt-6-astra');
  assert.ok(candidates.includes('gpt-6-astra') && candidates.includes('gpt-5.4-mini'), 'configured model and mini are both tried');
  assert.ok(!codexVisionModelCandidates('chatgpt-web').includes('chatgpt-web'), 'chatgpt-web is not a vision model');

  try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* temp */ }
  console.log('mobile voice fixes regression passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
