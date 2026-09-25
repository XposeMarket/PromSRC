/**
 * Live smoke test for openai_codex/chatgpt (makes real ChatGPT requests with
 * the stored Codex login; creates Temporary Chats only).
 *
 *   npx tsx scripts/smoke-chatgpt-web-live.ts [effort] [prompt]
 *
 * Prints streamed text, reasoning summaries, and ChatGPT tool rows exactly as
 * the chat router receives them via onToken/onReasoningSummary/onModelEvent.
 */

import { OpenAICodexAdapter } from '../src/providers/openai-codex-adapter';
import { getConfig } from '../src/config/config';

async function main() {
  const effort = process.argv[2] || 'medium';
  const prompt = process.argv[3] || 'Search the web: what is the latest stable Godot version? One sentence.';
  // Build through the factory so the same pooled Codex account the gateway
  // uses is selected (the bare default token slot can be stale).
  const { buildProviderById } = await import('../src/providers/factory');
  const adapter = buildProviderById('openai_codex') as OpenAICodexAdapter;
  void getConfig;
  let tokens = 0;
  const started = Date.now();
  let firstTokenAt = 0;
  const result = await adapter.chat(
    [
      { role: 'system', content: 'You are Prom, a concise assistant running inside Prometheus.' },
      { role: 'user', content: prompt },
    ],
    'chatgpt',
    {
      think: effort as any,
      onToken: (chunk) => { tokens += 1; if (!firstTokenAt) firstTokenAt = Date.now(); process.stdout.write(chunk); },
      onReasoningSummary: (chunk) => process.stdout.write(`\n  [reasoning] ${chunk.trim()}\n`),
      onModelEvent: (event) => {
        if (event.type === 'provider_event') {
          const data: any = event.data || {};
          if (event.nativeType === 'chatgpt.tool_start') process.stdout.write(`\n  [tool ->] ${data.name} ${String(data.args || '').slice(0, 160)}\n`);
          if (event.nativeType === 'chatgpt.tool_result') process.stdout.write(`\n  [tool <-] ${data.name} ${String(data.result || '').split('\n')[0].slice(0, 160)}\n`);
        }
      },
    },
  );
  console.log('\n\n--- result ---');
  console.log(JSON.stringify({
    effort,
    actualModel: (result as any).actualModel,
    streamedChunks: tokens,
    firstTokenMs: firstTokenAt ? firstTokenAt - started : null,
    totalMs: Date.now() - started,
    final: String(result.message.content).slice(0, 400),
  }, null, 2));
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error?.code || '', error?.message || error);
  process.exit(1);
});
