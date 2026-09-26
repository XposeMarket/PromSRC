// Regression (2026-09-26): the owner watchdog killed a ChatGPT turn that was
// legitimately waiting on two background agents during finalization, because
// the join emitted nothing semantic for 10 minutes. The join must keep sending
// a semantic, replay-free `background_wait` frame until it settles.
import assert from 'node:assert/strict';
import { classifyMainChatStreamEvent } from './main-chat-stream';
import { isMainChatSemanticProgressEvent } from './main-chat-execution-owner';

(async () => {
  const { withBackgroundJoinKeepalive } = await import('../routes/chat.router');
  const sent: Array<{ event: string; data: any }> = [];
  let settle!: (v: string) => void;
  const join = new Promise<string>((resolve) => { settle = resolve; });
  const pending = withBackgroundJoinKeepalive((event, data) => sent.push({ event, data }), ['bg_a', 'bg_b'], join, 20);
  await new Promise((r) => setTimeout(r, 75));
  settle('done');
  assert.equal(await pending, 'done');
  const ticks = sent.filter((f) => f.event === 'background_wait').length;
  assert.ok(ticks >= 3, `expected repeated keepalives, got ${ticks}`);
  assert.deepEqual(sent[0].data.backgroundIds, ['bg_a', 'bg_b']);
  const after = sent.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sent.length, after, 'keepalive stops once the join settles');

  assert.ok(isMainChatSemanticProgressEvent('background_wait'), 'background_wait resets the watchdog');
  const delivery = classifyMainChatStreamEvent('background_wait', {});
  assert.equal(delivery.retain, false, 'not retained in the replay buffer');
  assert.equal(delivery.live, true, 'still delivered live');
  console.log('background-join keepalive regression: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
