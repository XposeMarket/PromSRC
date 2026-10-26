// Opt-in synthetic probe: eight billable requests, no real chat history.
import { randomUUID, createHash } from 'node:crypto';
import { OpenAICodexAdapter } from '../src/providers/openai-codex-adapter';
import { PROMPT_CACHE_MARKER, ChatMessage } from '../src/providers/LLMProvider';
import { getConfig } from '../src/config/config';
async function main() {
  if (!process.argv.includes('--confirm-live')) throw new Error('Requires --confirm-live (eight synthetic requests).');
  const model = 'gpt-5.4-mini';
  const configDir = process.argv.find(a => a.startsWith('--config-dir='))?.slice(13) || getConfig().getConfigDir();
  const adapter = new OpenAICodexAdapter(configDir);
  // >8k tokens; the common stable prefix is identical between both scenarios.
  const stable = 'Reply only OK. Ignore the synthetic reference text.\n' + 'Reference: caching reuses identical prompt prefixes, never private chat state.\n'.repeat(700);
  const originalFetch = globalThis.fetch;
  let mode = 'shared';
  globalThis.fetch = (async (url: any, init: any) => {
    if (mode === 'shared' && init?.body && String(url).includes('/responses')) {
      const body = JSON.parse(init.body);
      // Reproduce the old shared affinity derived from account/model/instructions.
      const key = 'prom-' + createHash('sha256').update(JSON.stringify([model, body.instructions])).digest('hex').slice(0,48);
      body.prompt_cache_key = key;
      return originalFetch(url, {...init, headers:{...init.headers, session_id:key}, body:JSON.stringify(body)});
    }
    return originalFetch(url, init);
  }) as typeof fetch;
  try {
    for (mode of ['shared','fixed']) {
      const sessionId = 'cache-probe-' + randomUUID();
      const history: ChatMessage[] = [];
      for (let turn = 1; turn <= 4; turn++) {
        const user: ChatMessage = {role:'user', content:`Reply OK for synthetic turn ${turn}.`};
        const result = await adapter.chat([{role:'system', content:stable + PROMPT_CACHE_MARKER + `Synthetic current turn ${turn}.`}, ...history, user], model, {sessionId, think:'low', max_tokens:32});
        const input = result.usage?.inputTokens || 0;
        const cached = result.usage?.cacheReadTokens || 0;
        console.log(JSON.stringify({mode, model, turn, input, cached, hitPct:input ? +(100*cached/input).toFixed(2) : 0}));
        history.push(user, {role:'assistant', content:result.message.content});
      }
    }
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(e => {console.error(e.message); process.exitCode=1;});
