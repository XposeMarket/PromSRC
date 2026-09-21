import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A self-triggered mid-turn restart must read as a SUSPENSION of the same turn,
 * not as a finished turn followed by a new one. These checks pin the two signals
 * clients depend on for that illusion:
 *   1. a `restart_continuity` suspension notice emitted before shutdown, and
 *   2. a `restart_checkpoint` history row that is tagged for folding rather than
 *      rendered as its own visible assistant bubble.
 * An unplanned crash must keep the louder, explicitly-interrupted treatment.
 */
async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-continuity-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  const runtimes = await import('./live-runtime-registry');
  const recovery = await import('./runtime-recovery');
  const session = await import('./session');

  // ── Planned mid-turn restart ────────────────────────────────────────────────
  const plannedSessionId = 'restart_continuity_planned';
  const emitted: Record<string, any>[] = [];
  recovery.registerRestartContinuityEmitter((payload) => emitted.push(payload));

  const plannedRuntimeId = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'planned mid-turn restart',
    sessionId: plannedSessionId,
    recoveryPolicy: 'mark_interrupted',
    recoveryData: { message: 'Apply the dev edit and then verify it.' },
  });
  runtimes.updateLiveRuntimeCheckpoint(plannedRuntimeId, {
    event: 'tool_call',
    toolName: 'gateway_restart',
    message: 'restarting to load the new build',
  });
  recovery.prepareActiveRuntimesForGatewayShutdown('gateway_restart');

  const suspension = emitted.find((payload) => payload.sessionId === plannedSessionId);
  assert.ok(suspension, 'a planned mid-turn restart must announce a suspension before shutdown');
  assert.equal(suspension.phase, 'suspended');
  assert.equal(suspension.priorRuntimeId, plannedRuntimeId);
  assert.equal(
    suspension.plannedRestartTool,
    'gateway_restart',
    'the suspension must name the tool that triggered it so clients can distinguish it from a crash',
  );

  const plannedHistory = session.getHistory(plannedSessionId, 12);
  const plannedCheckpoint = plannedHistory.find((message) =>
    message.role === 'assistant'
    && String(message.content || '').startsWith('[Hot restart checkpoint: planned by this chat]'));
  assert.ok(plannedCheckpoint, 'the durable checkpoint row must still be written for recovery evidence');
  assert.equal(
    plannedCheckpoint.messageKind,
    'restart_checkpoint',
    'a planned checkpoint must be tagged so clients fold it into the suspended turn',
  );
  assert.equal(plannedCheckpoint.restartContinuity?.phase, 'suspended');
  assert.equal(plannedCheckpoint.restartContinuity?.priorRuntimeId, plannedRuntimeId);

  runtimes.finishLiveRuntime(plannedRuntimeId);

  // ── Unplanned crash ─────────────────────────────────────────────────────────
  // A crash is genuinely an interruption. It must NOT be silently folded away,
  // otherwise a real failure would look like an ordinary pause.
  const crashSessionId = 'restart_continuity_crash';
  emitted.length = 0;
  const crashRuntimeId = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'unplanned interruption',
    sessionId: crashSessionId,
    recoveryPolicy: 'mark_interrupted',
    recoveryData: { message: 'Read the file.' },
  });
  runtimes.updateLiveRuntimeCheckpoint(crashRuntimeId, { event: 'tool_call', toolName: 'workspace_read' });
  recovery.prepareActiveRuntimesForGatewayShutdown('signal_sigterm');

  assert.equal(
    emitted.find((payload) => payload.sessionId === crashSessionId),
    undefined,
    'an unplanned crash must not claim the turn is merely suspended',
  );
  const crashHistory = session.getHistory(crashSessionId, 12);
  const crashCheckpoint = crashHistory.find((message) =>
    message.role === 'assistant'
    && String(message.content || '').startsWith('[Interrupted by gateway restart]'));
  assert.ok(crashCheckpoint, 'a crash must still record its interruption checkpoint');
  assert.notEqual(
    crashCheckpoint.messageKind,
    'restart_checkpoint',
    'a crash checkpoint must stay visible instead of being folded into the turn',
  );
  assert.equal(crashCheckpoint.restartContinuity, undefined);

  runtimes.finishLiveRuntime(crashRuntimeId);

  // ── Planned restarts must be classified for a fast resume ──────────────────
  // server-v2 keys the startup recovery delay off this predicate. A planned
  // mid-turn restart previously inherited the 60s hot-restart cool-down, which
  // left the user staring at a frozen streaming turn. Pin the classification so
  // that regression cannot return.
  const delaySessionId = 'restart_continuity_delay';
  const plannedDelayRuntimeId = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'planned restart resume delay',
    sessionId: delaySessionId,
    recoveryPolicy: 'mark_interrupted',
    recoveryData: { message: 'Restart and continue.' },
  });
  runtimes.updateLiveRuntimeCheckpoint(plannedDelayRuntimeId, {
    event: 'tool_call',
    toolName: 'gateway_restart',
  });
  const plannedDelaySnapshot = runtimes.listLiveRuntimes()
    .find((runtime: any) => runtime.id === plannedDelayRuntimeId);
  assert.ok(plannedDelaySnapshot, 'the planned runtime must be discoverable for classification');
  assert.equal(
    recovery.isPlannedMainChatRestartRuntime(plannedDelaySnapshot),
    true,
    'a gateway_restart main-chat runtime must resume on the fast planned path',
  );

  const crashDelaySessionId = 'restart_continuity_delay_crash';
  const crashDelayRuntimeId = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'crash resume delay',
    sessionId: crashDelaySessionId,
    recoveryPolicy: 'mark_interrupted',
    recoveryData: { message: 'Read the file.' },
  });
  runtimes.updateLiveRuntimeCheckpoint(crashDelayRuntimeId, {
    event: 'tool_call',
    toolName: 'workspace_read',
  });
  const crashDelaySnapshot = runtimes.listLiveRuntimes()
    .find((runtime: any) => runtime.id === crashDelayRuntimeId);
  assert.ok(crashDelaySnapshot, 'the crash runtime must be discoverable for classification');
  assert.equal(
    recovery.isPlannedMainChatRestartRuntime(crashDelaySnapshot),
    false,
    'a crash must keep the conservative recovery cool-down',
  );

  runtimes.finishLiveRuntime(plannedDelayRuntimeId);
  runtimes.finishLiveRuntime(crashDelayRuntimeId);
  recovery.registerRestartContinuityEmitter(undefined);

  console.log('restart-continuity regression: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
