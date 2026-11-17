// Nov 16 2026: one flyer image stayed in a vision task's history and was
// re-sent on all 38 later calls (~90 MB of request bodies, heap 1.5 -> 2.5 GB).
import assert from 'node:assert/strict';
import type { ChatMessage } from './LLMProvider';
import { DEFAULT_HISTORY_IMAGE_KEEP, PRUNED_IMAGE_TEXT, pruneHistoryImages } from './history-image-prune';

const img = (tag: string) => ({ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${tag}${'A'.repeat(2000)}` } });
const vision = (tag: string): ChatMessage => ({ role: 'user', content: [img(tag), { type: 'text', text: `[SYSTEM: Browser screenshot ${tag}]` }] as any });
const tool = (id: string): ChatMessage => ({ role: 'tool', tool_call_id: id, content: 'ok' });
const asst = (id: string): ChatMessage => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'browser_vision_screenshot', arguments: '{}' } }] as any });
const count = (msgs: ChatMessage[]) => JSON.stringify(msgs).split('data:image/png;base64,').length - 1;

assert.equal(DEFAULT_HISTORY_IMAGE_KEEP, 2);

// 1. A long tool loop with 6 screenshots keeps the newest 2, notes the rest.
{
  const history: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'review the flyers' },
  ];
  for (let i = 1; i <= 6; i += 1) history.push(asst(`c${i}`), tool(`c${i}`), vision(`s${i}`));
  const before = JSON.stringify(history);
  const result = pruneHistoryImages(history, 2);
  assert.equal(result.totalImages, 6);
  assert.equal(result.prunedImages, 4);
  assert.equal(count(result.messages), 2);
  const kept = JSON.stringify(result.messages);
  assert.ok(kept.includes('s6') && kept.includes('s5') && !kept.includes(`s4${'A'}`));
  assert.equal(kept.split(PRUNED_IMAGE_TEXT).length - 1, 4);
  // Order, roles, tool pairing and the [SYSTEM:] label text are untouched.
  assert.equal(result.messages.length, history.length);
  assert.deepEqual(result.messages.map((m) => m.role), history.map((m) => m.role));
  assert.ok(kept.includes('[SYSTEM: Browser screenshot s1]'));
  // Input is never mutated.
  assert.equal(JSON.stringify(history), before);
  // Deterministic (prompt-cache prefix stays stable across calls).
  assert.equal(JSON.stringify(pruneHistoryImages(history, 2).messages), kept);
}

// 2. The user's own attachments in the latest real user turn are protected.
{
  const history: ChatMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'compare these' }, img('u1'), img('u2'), img('u3')] as any },
    asst('a'), tool('a'), vision('v1'),
    asst('b'), tool('b'), vision('v2'),
    asst('c'), tool('c'), vision('v3'),
  ];
  const result = pruneHistoryImages(history, 2);
  const out = JSON.stringify(result.messages);
  for (const t of ['u1', 'u2', 'u3', 'v3', 'v2']) assert.ok(out.includes(`${t}AAAA`), `kept ${t}`);
  assert.ok(!out.includes('v1AAAA'), 'oldest screenshot pruned');
  assert.equal(result.prunedImages, 1);
}

// 3. Older user attachments (previous turns) are prunable once newer images exist.
{
  const history: ChatMessage[] = [
    { role: 'user', content: [img('old1'), { type: 'text', text: 'first' }] as any },
    { role: 'assistant', content: 'seen' },
    { role: 'user', content: [img('old2'), { type: 'text', text: 'second' }] as any },
    { role: 'assistant', content: 'seen' },
    { role: 'user', content: 'now just text' },
    asst('x'), tool('x'), vision('n1'), asst('y'), tool('y'), vision('n2'),
  ];
  const out = JSON.stringify(pruneHistoryImages(history, 2).messages);
  assert.ok(out.includes('n1AAAA') && out.includes('n2AAAA'));
  assert.ok(!out.includes('old1AAAA') && !out.includes('old2AAAA'));
}

// 4. Nested tool_result images (Anthropic-shaped history) are counted and pruned.
{
  const nested = (t: string): ChatMessage => ({ role: 'tool', tool_call_id: t, content: [{ type: 'tool_result', tool_use_id: t, content: [img(t), { type: 'text', text: 'shot' }] }] as any });
  const history: ChatMessage[] = [{ role: 'user', content: 'go' }, nested('t1'), nested('t2'), nested('t3')];
  const r = pruneHistoryImages(history, 2);
  assert.equal(r.totalImages, 3);
  assert.equal(r.prunedImages, 1);
  assert.ok(!JSON.stringify(r.messages).includes('t1AAAA'));
}

// 5. Nothing to prune -> same array instance; keep=0 disables.
{
  const history: ChatMessage[] = [{ role: 'user', content: 'hi' }, vision('only')];
  assert.equal(pruneHistoryImages(history, 2).messages, history);
  const many: ChatMessage[] = [vision('a'), vision('b'), vision('c')];
  assert.equal(pruneHistoryImages(many, 0).messages, many);
  assert.deepEqual(pruneHistoryImages([], 2), { messages: [], totalImages: 0, prunedImages: 0 });
}

// 6. Size: 20 x 2.4 MB screenshots shrink to ~2 images worth.
{
  const big = (t: string): ChatMessage => ({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${t}${'B'.repeat(2_400_000)}` } }, { type: 'text', text: `[SYSTEM: shot ${t}]` }] as any });
  const history: ChatMessage[] = [{ role: 'user', content: 'go' }];
  for (let i = 0; i < 20; i += 1) history.push(asst(`k${i}`), tool(`k${i}`), big(`k${i}`));
  const before = JSON.stringify(history).length;
  const after = JSON.stringify(pruneHistoryImages(history, 2).messages).length;
  assert.ok(before > 48_000_000 && after < 5_000_000, `before ${before} after ${after}`);
}

// 7. End to end through the real Anthropic adapter: the body actually sent
// carries only the newest 2 images, and requestBytes matches the sent body.
async function adapterE2E(): Promise<void> {
  const { AnthropicAdapter } = await import('./anthropic-adapter');
  const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' } as any);
  (adapter as any).buildHeaders = () => ({ 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'test' });
  // Real PNG so normalizeAnthropicImage accepts it.
  const sharp = (await import('sharp')).default;
  const png = async (seed: number) => (await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: seed * 30, g: 10, b: 10 } } }).png().toBuffer()).toString('base64');
  const history: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'review the flyers' }];
  for (let i = 1; i <= 5; i += 1) {
    history.push(asst(`e${i}`), tool(`e${i}`));
    history.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${await png(i)}` } }, { type: 'text', text: `[SYSTEM: Browser screenshot e${i}]` }] as any });
  }
  let sent = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    sent = String(init?.body || '');
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    await adapter.chat(history, 'claude-haiku-5-5');
  } finally {
    globalThis.fetch = originalFetch;
  }
  const body = JSON.parse(sent);
  const imageBlocks = JSON.stringify(body.messages).split('"type":"image"').length - 1;
  assert.equal(imageBlocks, 2, `adapter sent ${imageBlocks} images`);
  assert.equal(JSON.stringify(body.messages).split(PRUNED_IMAGE_TEXT).length - 1, 3);
  assert.ok(JSON.stringify(body.messages).includes('[SYSTEM: Browser screenshot e5]'));
}

// 6. Runtime-injected user turns never take the protected (real user) slot.
const attachments3 = (): ChatMessage => ({ role: 'user', content: [img('p1'), img('p2'), img('p3'), { type: 'text', text: 'look at these' }] as any });
{
  // (i) string "[SYSTEM: ...]" runtime message after the user's attachments.
  const history: ChatMessage[] = [attachments3(), asst('a'), tool('a'), { role: 'user', content: '[SYSTEM: tool categories refreshed: browser_automation]' }];
  const r = pruneHistoryImages(history, 2);
  assert.equal(r.prunedImages, 0, 'string [SYSTEM: message stole protection');
  assert.ok(JSON.stringify(r.messages).includes('p1AAAA'));
}
{
  // (ii) bracket-tag array runtime message carrying an image.
  const media: ChatMessage = { role: 'user', content: [{ type: 'text', text: '[MEDIA_DIRECT_OBSERVATION]\nVisual inputs from browser_vision_screenshot.' }, img('m1')] as any };
  const history: ChatMessage[] = [attachments3(), asst('a'), tool('a'), media];
  const r = pruneHistoryImages(history, 2);
  assert.equal(r.prunedImages, 0, '[MEDIA_DIRECT_OBSERVATION] stole protection');
  const out = JSON.stringify(r.messages);
  assert.ok(out.includes('p1AAAA') && out.includes('p2AAAA') && out.includes('p3AAAA'));
}
// (iii) unmarked continuation-guard strings pushed as role user.
for (const guard of [
  'Do not finalize yet. This is an explicit /visual command.',
  'Do not finalize yet: a declared plan is still in progress.',
  'Continue the active user request from the completed results above.',
]) {
  const history: ChatMessage[] = [attachments3(), asst('a'), tool('a'), { role: 'user', content: guard }];
  const r = pruneHistoryImages(history, 2);
  assert.equal(r.prunedImages, 0, `guard "${guard.slice(0, 30)}" stole protection`);
}
// 7. Age bound: unprotected images age out after maxAge assistant messages.
{
  const shot: ChatMessage = { role: 'tool', tool_call_id: 'shot', content: [img('one'), { type: 'text', text: 'screenshot' }] as any };
  const iterations = (n: number): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (let i = 1; i <= n; i += 1) out.push(asst(`it${i}`), tool(`it${i}`));
    return out;
  };
  // (iv) one screenshot, then 38 image-free iterations -> pruned.
  const long = pruneHistoryImages([{ role: 'user', content: 'check the page' }, shot, ...iterations(38)], 2);
  assert.equal(long.totalImages, 1);
  assert.equal(long.prunedImages, 1, 'single screenshot must age out');
  assert.ok(!JSON.stringify(long.messages).includes('oneAAAA'));
  // (v) one screenshot, then 3 assistant messages -> kept.
  const short = pruneHistoryImages([{ role: 'user', content: 'check the page' }, shot, ...iterations(3)], 2);
  assert.equal(short.prunedImages, 0);
  assert.ok(JSON.stringify(short.messages).includes('oneAAAA'));
  // (vi) real user attachment, then 38 iterations -> kept (protected).
  const attached: ChatMessage = { role: 'user', content: [img('att'), { type: 'text', text: 'here is the flyer' }] as any };
  const user = pruneHistoryImages([attached, ...iterations(38)], 2);
  assert.equal(user.prunedImages, 0, 'real user attachment must never age out');
  assert.ok(JSON.stringify(user.messages).includes('attAAAA'));
  // maxAge 0 disables the age bound.
  const noAge = pruneHistoryImages([{ role: 'user', content: 'check the page' }, shot, ...iterations(38)], 2, 0);
  assert.equal(noAge.prunedImages, 0);
}

adapterE2E().then(() => {
  console.log('history-image-prune regression: PASS');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
