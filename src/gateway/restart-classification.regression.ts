/**
 * Regression: restart CLASSIFICATION and crash VISIBILITY.
 *
 * Two independent defects, both from the planned-restart continuity work.
 *
 * 1. CLASSIFICATION (runtime-recovery.ts / server-v2.ts)
 *    Deferred-queue admission and the fast-resume timer used different
 *    definitions of "planned":
 *      - admission used `explicitlyOwnedMainChatRestartToolName()`, i.e. the turn
 *        itself called gateway_restart / prom_apply_dev_changes;
 *      - `isPlannedMainChatRestartRuntime()` used the broader
 *        `plannedRestartToolName()`, which also accepts a bare `interruptReason`.
 *    Startup recovery defaults `interruptReason` to 'gateway_restart' for ANY
 *    interrupted runtime, including supervisor crash recovery. So a crash-recovered
 *    turn was classified "planned" and handed the short 1.5s cooldown that exists
 *    specifically to avoid recreating a CPU-bound backlog.
 *
 * 2. VISIBILITY (web-ui/src/pages/ChatPage.js)
 *    foldDesktopGatewayRestartCheckpoints() removed a checkpoint from the rendered
 *    history even when it found no assistant row to attach it to. An unexpected
 *    crash with no answer yet therefore rendered as a user message followed by
 *    silence - the only visible evidence of the interruption was erased.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPlannedMainChatRestartRuntime } from './runtime-recovery';
import type { LiveRuntimeSnapshot } from './live-runtime-registry';

function runtime(overrides: Record<string, any>): LiveRuntimeSnapshot {
  return {
    id: 'runtime-1',
    kind: 'main_chat',
    status: 'interrupted',
    sessionId: 'session-1',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as LiveRuntimeSnapshot;
}

function assertClassificationMatchesQueueAdmission(): void {
  // A turn that explicitly called the restart tool IS planned.
  assert.equal(
    isPlannedMainChatRestartRuntime(runtime({ checkpoint: { event: 'tool_call', toolName: 'gateway_restart' } })),
    true,
    'a turn that explicitly called gateway_restart must classify as planned',
  );
  assert.equal(
    isPlannedMainChatRestartRuntime(runtime({ recoveryData: { plannedRestartTool: 'prom_apply_dev_changes' } })),
    true,
    'an explicitly persisted planned restart tool must classify as planned',
  );

  // Supervisor crash recovery must NOT be classified as planned merely because
  // startup recovery stamped the generic 'gateway_restart' interrupt reason.
  assert.equal(
    isPlannedMainChatRestartRuntime(runtime({
      interruptReason: 'gateway_restart',
      checkpoint: { event: 'done' },
    })),
    false,
    'REGRESSION: a crash-recovered turn is classified as a planned restart because it carries the '
    + "generic interruptReason 'gateway_restart'. It would then receive the short planned-restart "
    + 'cooldown that exists to avoid recreating a CPU-bound backlog.',
  );
  assert.equal(
    isPlannedMainChatRestartRuntime(runtime({
      recoveryData: { interruptReason: 'gateway_restart' },
    })),
    false,
    'REGRESSION: a generic recoveryData.interruptReason must not manufacture a planned restart',
  );

  // A genuine crash with no restart marker at all is obviously not planned.
  assert.equal(
    isPlannedMainChatRestartRuntime(runtime({ interruptReason: 'gateway_crash' })),
    false,
    'a crashed turn must not classify as planned',
  );
}

/** The queue must not let one planned turn drag crash recoveries into the fast lane. */
function assertPerRuntimeCadence(): void {
  const source = fs.readFileSync(path.join(__dirname, 'server-v2.ts'), 'utf-8');
  assert.ok(
    !/\.some\(isPlannedMainChatRestartRuntime\)/.test(source),
    'REGRESSION: the recovery queue still selects its delay with a queue-wide '
    + '.some(isPlannedMainChatRestartRuntime), so a single planned continuation pulls every '
    + 'crash-recovered turn into the 1.5s fast lane with it.',
  );
  assert.ok(
    /delayForRuntime|pollForRuntime/.test(source),
    'the recovery queue must choose its cadence per runtime',
  );
}

/**
 * Faithful port of foldDesktopGatewayRestartCheckpoints()'s attach/drop decision.
 * The real function lives in the browser bundle; this mirrors its control flow so
 * the drop behaviour is asserted directly, and the source check below guarantees
 * the shipped implementation keeps the fallback.
 */
function foldCheckpoints(list: any[]): any[] {
  const isCheckpoint = (msg: any) => {
    if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') return false;
    if (String(msg.messageKind || '').trim().toLowerCase() === 'restart_checkpoint') return true;
    return /^\[(?:Hot restart checkpoint: planned by this chat|Interrupted by gateway restart)\]/i
      .test(String(msg.content || '').trim());
  };
  const out: any[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const checkpoint = list[index];
    if (!isCheckpoint(checkpoint)) {
      out.push(checkpoint);
      continue;
    }
    let target: any = null;
    for (let next = index + 1; next < list.length; next += 1) {
      const candidate = list[next];
      if (String(candidate?.role || '').toLowerCase() === 'user') break;
      if (isCheckpoint(candidate)) continue;
      if (String(candidate?.role || '').toLowerCase() !== 'assistant') break;
      target = candidate;
      break;
    }
    if (!target) {
      for (let previous = out.length - 1; previous >= 0; previous -= 1) {
        const candidate = out[previous];
        if (String(candidate?.role || '').toLowerCase() === 'user') break;
        if (String(candidate?.role || '').toLowerCase() !== 'assistant') break;
        target = candidate;
        break;
      }
    }
    if (target) {
      target._folded = true;
      continue;
    }
    out.push(checkpoint);
  }
  return out;
}

function assertCrashCheckpointStaysVisible(): void {
  const crashCheckpoint = {
    role: 'assistant',
    content: '[Interrupted by gateway restart]\nReason: gateway_crash',
  };

  // The exact production shape: the user asked, the gateway died, no answer exists.
  const folded = foldCheckpoints([{ role: 'user', content: 'do the thing' }, crashCheckpoint]);
  assert.equal(
    folded.length,
    2,
    'REGRESSION: an unattached crash checkpoint was dropped from the rendered history. '
    + 'The thread renders as a user message followed by silence, erasing the only visible '
    + 'evidence that the gateway was interrupted.',
  );
  assert.equal(folded[1], crashCheckpoint, 'the crash checkpoint must remain visible');

  // A lone checkpoint with no surrounding turn must also survive.
  assert.deepEqual(
    foldCheckpoints([crashCheckpoint]),
    [crashCheckpoint],
    'REGRESSION: an orphaned crash checkpoint was dropped',
  );

  // A checkpoint that DOES have an answer still folds into it, as intended.
  const answered = foldCheckpoints([
    { role: 'user', content: 'do the thing' },
    { role: 'assistant', messageKind: 'restart_checkpoint', content: '[Hot restart checkpoint: planned by this chat]' },
    { role: 'assistant', content: 'Done, here is the result.' },
  ]);
  assert.equal(answered.length, 2, 'a planned checkpoint with a resumed answer must still fold');
  assert.equal(answered[1]._folded, true, 'the checkpoint must fold into the resumed answer');
}

function assertShippedFoldKeepsFallback(): void {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'web-ui', 'src', 'pages', 'ChatPage.js'),
    'utf-8',
  );
  const start = source.indexOf('function foldDesktopGatewayRestartCheckpoints');
  assert.ok(start > 0, 'foldDesktopGatewayRestartCheckpoints must exist');
  const body = source.slice(start, start + 2500);
  assert.ok(
    /out\.push\(checkpoint\)[\s\S]{0,80}\n\s*\}\s*\n\s*return out;/.test(body)
    || (body.match(/out\.push\(checkpoint\)/g) || []).length >= 2,
    'REGRESSION: foldDesktopGatewayRestartCheckpoints no longer keeps an unattached checkpoint. '
    + 'Without the fallback push, crash evidence is silently removed from the rendered history.',
  );
}

function main(): void {
  assertClassificationMatchesQueueAdmission();
  assertPerRuntimeCadence();
  assertCrashCheckpointStaysVisible();
  assertShippedFoldKeepsFallback();
  console.log('restart-classification regression: OK');
}

main();
