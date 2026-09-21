// Behavioral regression for the mobile planned-restart streaming hold.
//
// Source-shape assertions in test-mobile-chat-recovery.mjs previously locked in
// an inverted predicate: `gatewayRestartContinuity` released the streaming hold
// instead of extending it. The regex matched the buggy code exactly, so the
// suite stayed green while the phone tore the assistant row down mid-restart
// and the later resume had nothing to reattach to.
//
// These cases execute the real policy instead of matching its text.

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve(
  process.cwd(),
  'web-ui/src/mobile/mobile-restart-continuity.js',
);
const { shouldHoldStreamingTurn, resolveRestartRecoveryMerge } = await import(
  pathToFileURL(modulePath).href
);

// The exact field shape observed on the phone during the 2026-09-21 failure:
// recovery reconnects, sees the planned-restart checkpoint already durable in
// history, and must NOT drop the live row while the replacement stream boots.
assert.equal(
  shouldHoldStreamingTurn({
    replayStillActive: false,
    localTurnStreaming: true,
    completedDurableTurn: true,
    gatewayRestartContinuity: true,
  }),
  true,
  'planned restart must hold the streaming row even when the durable read looks complete',
);

assert.equal(
  shouldHoldStreamingTurn({
    replayStillActive: false,
    localTurnStreaming: true,
    completedDurableTurn: false,
    gatewayRestartContinuity: true,
  }),
  true,
  'planned restart with an unfinished durable turn must hold',
);

// Guardrails: the fix must not make the hold unconditional.
assert.equal(
  shouldHoldStreamingTurn({
    replayStillActive: false,
    localTurnStreaming: true,
    completedDurableTurn: true,
    gatewayRestartContinuity: false,
  }),
  false,
  'an ordinary completed turn with no restart in play must still release',
);

assert.equal(
  shouldHoldStreamingTurn({
    replayStillActive: false,
    localTurnStreaming: false,
    completedDurableTurn: false,
    gatewayRestartContinuity: true,
  }),
  false,
  'a restart must not invent a streaming row that was never live locally',
);

assert.equal(
  shouldHoldStreamingTurn({
    replayStillActive: true,
    localTurnStreaming: false,
    completedDurableTurn: true,
    gatewayRestartContinuity: false,
  }),
  true,
  'an active replay always holds',
);

assert.equal(
  shouldHoldStreamingTurn({}),
  false,
  'the default/empty case must not hold',
);

// The two functions in this module read the same flag and must not disagree.
// Contradiction between them is what allowed the inversion to survive review.
for (const completedDurableTurn of [true, false]) {
  const merge = resolveRestartRecoveryMerge({
    localTurnStreaming: true,
    completedDurableTurn,
    gatewayRestartContinuity: true,
  });
  const held = shouldHoldStreamingTurn({
    localTurnStreaming: true,
    completedDurableTurn,
    gatewayRestartContinuity: true,
  });
  assert.equal(
    Boolean(merge?.preserveLocalHistory),
    true,
    'planned restart must preserve local history for the merge path',
  );
  assert.equal(
    held,
    true,
    'hold policy and merge policy must agree that a planned restart preserves the turn',
  );
}

console.log('OK test-mobile-restart-hold-policy: planned-restart streaming hold policy verified');
