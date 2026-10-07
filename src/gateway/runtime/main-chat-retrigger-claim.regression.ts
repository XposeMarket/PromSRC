import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimMainChatRetrigger, MAIN_CHAT_RETRIGGER_CLAIM_TTL_MS } from './main-chat-retrigger-claim';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-retrigger-claim-'));
try {
  // Three gateway processes recovering the same interrupted runtime: only one wins.
  const results = [0, 1, 2].map(() => claimMainChatRetrigger(dir, 'affd789f-b774-4295-bc24-424e1e3234cf'));
  assert.equal(results.filter(Boolean).length, 1, 'exactly one process may retrigger a given interrupted runtime');

  // A different runtime is independent.
  assert.ok(claimMainChatRetrigger(dir, 'ba77ab83-e131-4e16-92d5-c715627e8fa1'), 'other runtimes are not blocked');

  // Releasing (e.g. the session lease was busy) allows a later retry.
  const winner = results.find(Boolean)!;
  winner();
  assert.ok(claimMainChatRetrigger(dir, 'affd789f-b774-4295-bc24-424e1e3234cf'), 'released claim can be retaken');

  // Expired claims from a crashed winner do not block recovery forever.
  const later = Date.now() + MAIN_CHAT_RETRIGGER_CLAIM_TTL_MS + 1_000;
  assert.ok(claimMainChatRetrigger(dir, 'affd789f-b774-4295-bc24-424e1e3234cf', { now: later }), 'stale claim is reclaimable');

  // Missing id fails open rather than dropping recovery.
  assert.equal(typeof claimMainChatRetrigger(dir, ''), 'function');

  // chat.router wires the claim in before the in-process admission lease.
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.router.ts'), 'utf8');
  const fnStart = router.indexOf('export function retriggerInterruptedMainChat(');
  const claimAt = router.indexOf('claimMainChatRetrigger(', fnStart);
  const leaseAt = router.indexOf('mainChatTurnCoordinator.tryAcquire(sessionId)', fnStart);
  assert.ok(fnStart > 0 && claimAt > fnStart && leaseAt > claimAt, 'retrigger must take the cross-process claim before the session lease');

  console.log('main-chat-retrigger-claim regression: OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
