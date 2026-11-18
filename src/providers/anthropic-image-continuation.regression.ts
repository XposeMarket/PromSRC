// Screenshots must not be uploaded again on every later tool round.
//
// The thinking continuation rebuilds each request from the inputs stored for
// earlier rounds, so the request-time image pruning (history-image-prune.ts)
// no longer reached old screenshots: round N sent N-1 of them. This drives the
// real adapter through a long browser-style turn with a stubbed fetch.
import assert from 'node:assert/strict';
import { AnthropicAdapter } from './anthropic-adapter';
import { CONTINUATION_STALE_IMAGE_SLACK, staleImageCutoff } from './anthropic-tool-continuation';
import { DEFAULT_HISTORY_IMAGE_KEEP, PRUNED_IMAGE_TEXT } from './history-image-prune';
import type { ChatMessage } from './LLMProvider';

// A real 1x1 PNG: the adapter drops image data it cannot decode.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const image = { type: 'image_url', image_url: { url: PNG } };
const tools = [{ type: 'function', function: { name: 'browser_click', description: 'click', parameters: { type: 'object', properties: {} } } }];
const count = (value: unknown, needle: string) => JSON.stringify(value).split(needle).length - 1;
const withoutMarkers = (value: any) => JSON.parse(JSON.stringify(value, (key, val) => key === 'cache_control' ? undefined : val));

async function main() {
  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test-not-a-secret' } as any);
  const originalFetch = globalThis.fetch;
  let request: any;
  let response: any;
  globalThis.fetch = (async (_url: any, init: any) => {
    request = JSON.parse(String(init?.body));
    return Response.json(response);
  }) as any;

  try {
    const ROUNDS = 24;
    // The person attached one mock-up; every tool round then adds one screenshot.
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Match the site to this mock-up.' }, image] as any },
    ];
    const sent: number[] = [];
    let previous: any[] = [];
    let steps = 0;
    for (let round = 1; round <= ROUNDS; round += 1) {
      response = {
        content: [
          { type: 'thinking', thinking: '', signature: `sig-${round}` },
          { type: 'tool_use', id: `tool_${round}`, name: 'browser_click', input: { round } },
        ],
        stop_reason: 'tool_use',
      };
      const result = await adapter.chat(messages, 'claude-fable-5-2', { think: 'high', max_tokens: 256, tools } as any);
      const wire = withoutMarkers(request.messages);

      assert.equal(count(wire[0], '"type":"image"'), 1, `round ${round}: the person's own attachment must stay`);
      const screenshots = count(wire, '"type":"image"') - 1;
      sent.push(screenshots);
      assert.equal(count(wire, '"type":"thinking"'), round - 1, `round ${round}: every earlier thinking block is replayed`);
      assert.ok(
        screenshots <= DEFAULT_HISTORY_IMAGE_KEEP + CONTINUATION_STALE_IMAGE_SLACK,
        `round ${round}: ${screenshots} screenshots sent, bound is ${DEFAULT_HISTORY_IMAGE_KEEP + CONTINUATION_STALE_IMAGE_SLACK}`,
      );
      if (round > 1 && screenshots > sent[round - 2]) {
        // Between rewrites the request only grows, so cache and thinking stay valid.
        assert.deepEqual(wire.slice(0, previous.length), previous, `round ${round}: prefix must be unchanged`);
      } else if (round > 1) {
        steps += 1;
        assert.ok(count(wire, PRUNED_IMAGE_TEXT) > 0, `round ${round}: rewritten screenshots leave a note`);
      }
      previous = wire;

      // Model-worker IPC hands the adapter a serialized copy every round.
      messages.push(structuredClone(result.message));
      if (round % 2) {
        messages.push({ role: 'tool', tool_call_id: `tool_${round}`, content: [{ type: 'text', text: `clicked ${round}` }, image] as any });
      } else {
        messages.push({ role: 'tool', tool_call_id: `tool_${round}`, content: `clicked ${round}` });
        messages.push({ role: 'user', content: [{ type: 'text', text: '[SYSTEM: screenshot attached]' }, image] as any });
      }
    }
    assert.ok(steps >= 2 && steps <= 4, `expected a few stepped rewrites in ${ROUNDS} rounds, got ${steps} (${sent.join(',')})`);
    assert.ok(sent.at(-1)! < ROUNDS - 1, `last round sent ${sent.at(-1)} screenshots; unbounded would be ${ROUNDS - 1}`);

    // The cutoff is a pure function of the stored rounds.
    const one = (rounds: number) => Array.from({ length: rounds }, () => [1]);
    assert.equal(staleImageCutoff(one(9), 2, 8, 1e9), 0, 'below the slack nothing is rewritten');
    assert.equal(staleImageCutoff(one(10), 2, 8, 1e9), 8, 'at the slack every stale image goes at once');
    assert.equal(staleImageCutoff(one(17), 2, 8, 1e9), 8, 'and then it holds until the next step');
    assert.equal(staleImageCutoff(one(18), 2, 8, 1e9), 16);
    for (let rounds = 1; rounds < 40; rounds += 1) {
      assert.ok(staleImageCutoff(one(rounds), 2) <= staleImageCutoff(one(rounds + 1), 2), 'cutoff never moves back');
    }
    // Large images (a 2-3 MB flyer) trip the byte bound long before the count bound.
    const flyer = (rounds: number) => Array.from({ length: rounds }, () => [3_000_000]);
    assert.equal(staleImageCutoff(flyer(3), 2, 8, 4_000_000), 0);
    assert.equal(staleImageCutoff(flyer(4), 2, 8, 4_000_000), 2);
    // PROMETHEUS_HISTORY_IMAGE_KEEP=0 turns image pruning off everywhere.
    assert.equal(staleImageCutoff(one(50), 0), 0);
    console.log(`anthropic image continuation regression passed (screenshots sent per round: ${sent.join(',')})`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
