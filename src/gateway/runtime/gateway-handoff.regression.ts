/**
 * Warm handoff regression: protocol framing, manifest discovery, a real
 * host↔client session over the local socket (mirror, control round-trip,
 * broadcast relay, drain completion), host loss detection, and the registry's
 * remote-runtime behaviour against a temporary state directory.
 *
 *   npx tsx src/gateway/runtime/gateway-handoff.regression.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gateway-handoff-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;
  const stateDir = path.join(root, '.prometheus');
  fs.mkdirSync(stateDir, { recursive: true });

  const protocol = await import('./gateway-handoff-protocol');
  const { GatewayHandoffHost } = await import('./gateway-handoff-host');
  const { GatewayHandoffClient, adoptGatewayHandoffHosts } = await import('./gateway-handoff-client');

  // ── Framing ────────────────────────────────────────────────────────────────
  {
    const seen: any[] = [];
    const errors: string[] = [];
    const parser = protocol.createGatewayHandoffFrameParser((m) => seen.push(m), (e) => errors.push(e.message), 200);
    const frame = protocol.encodeGatewayHandoffFrame({ protocolVersion: 1, type: 'heartbeat', at: 5, runningCount: 2 })!;
    // Split one frame across two chunks and follow it with garbage + an oversized frame.
    parser.push(frame.slice(0, 10));
    parser.push(frame.slice(10) + 'not json\n');
    parser.push('x'.repeat(300));
    parser.push('\n' + frame);
    assert.equal(seen.length, 2, 'both valid frames decode across chunk boundaries');
    assert.equal(seen[0].type, 'heartbeat');
    assert.ok(errors.some((e) => /Unrecognized|JSON/.test(e)), 'invalid JSON is reported');
    assert.ok(errors.some((e) => /exceeded/.test(e)), 'oversized frames are reported and dropped');
    assert.equal(protocol.encodeGatewayHandoffFrame({ protocolVersion: 1, type: 'broadcast', data: { big: 'y'.repeat(300) } }, 200), null);
    assert.ok(protocol.isGatewayHandoffLauncherNotice({ type: 'gateway_handoff', hostPid: 12, socketPath: 'x' }));
    assert.equal(protocol.isGatewayHandoffLauncherNotice({ type: 'gateway_handoff', hostPid: 0, socketPath: 'x' }), false);
    const winPath = protocol.resolveGatewayHandoffSocketPath('C:\\state', 42, 'win32');
    assert.ok(winPath.startsWith('\\\\.\\pipe\\prometheus-handoff-') && winPath.endsWith('-42'));
    const posixPath = protocol.resolveGatewayHandoffSocketPath('/state', 42, 'linux');
    assert.ok(posixPath.endsWith('-42.sock'));
  }

  // ── Manifests ──────────────────────────────────────────────────────────────
  {
    protocol.writeGatewayHandoffManifest(stateDir, {
      version: 1, hostPid: 999_999, processStartedAt: 1, socketPath: 'nope', startedAt: 1, reason: 'stale', runtimeIds: ['a'],
    });
    const listed = protocol.readGatewayHandoffManifests(stateDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].hostPid, 999_999);
    const adoption = await adoptGatewayHandoffHosts({
      stateDir,
      adapter: unusedAdapter(),
      isPidAlive: () => false,
    });
    assert.equal(adoption.staleManifests, 1, 'a dead host manifest is cleared');
    assert.equal(protocol.readGatewayHandoffManifests(stateDir).length, 0);
  }

  // ── Live host ↔ client session ─────────────────────────────────────────────
  {
    const hostPid = 4242;
    let running: any[] = [
      { id: 'rt-task', kind: 'background_task', label: 'long task', startedAt: 1, status: 'running', taskId: 'task-1', sessionId: 'task_task-1', abortable: true },
      { id: 'rt-chat', kind: 'main_chat', label: 'chat', startedAt: 2, status: 'running', sessionId: 'default', abortable: true },
    ];
    const controls: Array<{ op: string; args: any }> = [];
    const host = new GatewayHandoffHost({
      stateDir,
      hostPid,
      reason: 'test restart',
      socketPath: protocol.resolveGatewayHandoffSocketPath(stateDir, hostPid),
      listRunningRuntimes: () => running,
      onControl: (op, args) => {
        controls.push({ op, args });
        if (op === 'runtime_abort') {
          running = running.filter((r) => r.id !== args.runtimeId);
          return { ok: true };
        }
        return { ok: false, error: 'nope' };
      },
      heartbeatIntervalMs: 1_000,
      log: () => undefined,
    });
    await host.start();
    assert.equal(protocol.readGatewayHandoffManifests(stateDir).length, 1, 'host writes its manifest');

    // Broadcasts before the client connects are queued and flushed on connect.
    host.broadcast({ type: 'early', n: 1 });

    const events: string[] = [];
    const mirrored = new Map<string, any>();
    const adapter = {
      syncHostRuntimes(pid: number, runtimes: any[]) {
        events.push(`sync:${pid}:${runtimes.map((r) => r.id).join(',')}`);
        for (const r of runtimes) mirrored.set(r.id, r);
      },
      upsertHostRuntime(_pid: number, runtime: any, eventType: string) {
        events.push(`upsert:${runtime.id}:${eventType}`);
        mirrored.set(runtime.id, runtime);
      },
      deleteHostRuntime(_pid: number, runtimeId: string, eventType: string) {
        events.push(`delete:${runtimeId}:${eventType}`);
        mirrored.delete(runtimeId);
      },
      broadcast(data: any) { events.push(`broadcast:${data.type}`); },
      sessionFlushed(sessionId: string) { events.push(`flushed:${sessionId}`); },
      hostDrained(pid: number, ids: string[]) { events.push(`drained:${pid}:${ids.join(',')}`); },
      hostLost(pid: number, reason: string) { events.push(`lost:${pid}:${reason}`); },
      log: () => undefined,
    };
    const adoption = await adoptGatewayHandoffHosts({ stateDir, adapter, isPidAlive: () => true, connectTimeoutMs: 5_000 });
    assert.equal(adoption.hosts.length, 1, 'client adopts the live host');
    const client = adoption.hosts[0];
    assert.equal(client.hostPid, hostPid);
    assert.ok(events.includes(`sync:${hostPid}:rt-task,rt-chat`), `hello syncs the running set (${events.join(' | ')})`);
    await waitFor(() => events.includes('broadcast:early'), 2_000, 'queued broadcast flushed after connect');

    host.upsertRuntime(running[0], 'working');
    host.sessionFlushed('task_task-1');
    host.broadcast({ type: 'tool_call' });
    await waitFor(() => events.includes('upsert:rt-task:working') && events.includes('flushed:task_task-1') && events.includes('broadcast:tool_call'), 2_000, 'live events relayed');

    const abort = await client.control('runtime_abort', { runtimeId: 'rt-chat', reason: 'operator_abort' });
    assert.equal(abort.ok, true, 'control round-trip succeeds');
    assert.equal(controls[0]?.op, 'runtime_abort');
    const bad = await client.control('task_pause', { taskId: 'x' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'nope');

    host.deleteRuntime('rt-chat', 'aborted', running.find((r) => r.id === 'rt-chat'));
    await waitFor(() => events.includes('delete:rt-chat:aborted'), 2_000, 'delete relayed');

    await host.complete(['rt-late']);
    await waitFor(() => events.some((e) => e.startsWith(`drained:${hostPid}:rt-late`)), 2_000, 'drain_complete delivered');
    assert.equal(protocol.readGatewayHandoffManifests(stateDir).length, 0, 'manifest removed after drain');
    assert.equal(client.currentState, 'drained');
    const afterClose = await client.control('runtime_abort', { runtimeId: 'rt-task' });
    assert.equal(afterClose.ok, false, 'control after drain fails cleanly');
  }

  // ── Host loss (socket drops and pid is dead) ───────────────────────────────
  {
    const hostPid = 5151;
    const host = new GatewayHandoffHost({
      stateDir,
      hostPid,
      reason: 'crash test',
      socketPath: protocol.resolveGatewayHandoffSocketPath(stateDir, hostPid),
      listRunningRuntimes: () => [{ id: 'rt-x', kind: 'subagent', label: 'x', startedAt: 1, status: 'running' }],
      onControl: () => ({ ok: true }),
      log: () => undefined,
    });
    await host.start();
    const lost: string[] = [];
    let alive = true;
    const client = new GatewayHandoffClient({
      manifest: protocol.readGatewayHandoffManifests(stateDir)[0],
      adapter: { ...unusedAdapter(), syncHostRuntimes: () => undefined, hostLost: (_pid, reason) => lost.push(reason), log: () => undefined },
      isPidAlive: () => alive,
      stateDir,
      connectTimeoutMs: 3_000,
      connectRetryMs: 100,
      reconnectWindowMs: 2_000,
    });
    assert.equal(await client.connect(), true);
    alive = false;
    host.stop(); // simulate the host dying without drain_complete
    await waitFor(() => lost.length > 0, 5_000, 'client reports host loss');
    assert.equal(client.currentState, 'lost');
    assert.equal(protocol.readGatewayHandoffManifests(stateDir).length, 0, 'lost host manifest cleared');
    client.close();
  }

  // ── Registry: remote mirrors, forwarding, sink freeze ──────────────────────
  {
    const registry = await import('../live-runtime-registry');
    const hostPid = 7777;
    const forwarded: Array<{ hostPid: number; op: string; args: any }> = [];
    registry.setRemoteRuntimeControlForwarder(async (pid, op, args) => {
      forwarded.push({ hostPid: pid, op, args });
      return { ok: true };
    });
    const local = registry.registerLiveRuntime({ kind: 'main_chat', label: 'local', sessionId: 'local-session', abortSignal: { aborted: false } });
    const sync = registry.syncRemoteLiveRuntimes(hostPid, [
      { id: 'remote-1', kind: 'background_task', label: 'remote task', startedAt: 10, status: 'running', taskId: 'task-remote', sessionId: 'task_task-remote', abortable: true },
      { id: local, kind: 'main_chat', label: 'shadow attempt', startedAt: 11, status: 'running' },
    ]);
    assert.deepEqual(sync.mirrored, ['remote-1'], 'only genuine remote runtimes are mirrored');
    const mirror = registry.getLiveRuntime('remote-1');
    assert.equal(mirror?.remoteHostPid, hostPid);
    assert.equal(mirror?.pid, hostPid);
    assert.equal(registry.getLiveRuntime(local)?.remoteHostPid, undefined, 'a local runtime is never shadowed by a mirror');
    assert.equal(registry.countLocalRunningRuntimes(), 1);
    assert.equal(registry.findRemoteLiveRuntimeForTask('task-remote')?.id, 'remote-1');

    const abort = registry.abortLiveRuntime('remote-1', 'operator_abort', { source: 'test' });
    assert.equal(abort.ok, true);
    await waitFor(() => forwarded.some((f) => f.op === 'runtime_abort' && f.hostPid === hostPid), 1_000, 'abort forwarded to host');
    const steer = registry.addPendingRuntimeSteer('remote-1', { sessionId: 'task_task-remote', message: 'hurry' });
    assert.equal(steer.ok, true);
    await waitFor(() => forwarded.some((f) => f.op === 'runtime_steer'), 1_000, 'steer forwarded to host');
    assert.equal(registry.interruptLiveRuntimeForRecovery('remote-1').ok, false, 'remote mirrors cannot be interrupted locally');
    registry.finishLiveRuntime('remote-1');
    assert.ok(registry.getLiveRuntime('remote-1'), 'finishLiveRuntime ignores mirrors');

    // A restart of the replacement must not interrupt mirrors.
    const interrupted = registry.markActiveRuntimesInterrupted('gateway_shutdown');
    assert.ok(interrupted.every((r) => r.id !== 'remote-1'), 'mirrors are not interrupted by the replacement');
    await registry.flushLiveRuntimePersistence();
    const ledgerPath = path.join(stateDir, 'runtimes', 'active-runtimes.json');
    let ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes['remote-1']?.pid, hostPid, 'mirror persisted under the host pid');

    registry.removeRemoteLiveRuntime(hostPid, 'remote-1', 'completed');
    await registry.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes['remote-1'], undefined, 'finished mirror removed from ledger');

    // Host lost: running ledger entries become interrupted for crash recovery.
    registry.upsertRemoteLiveRuntime(hostPid, { id: 'remote-2', kind: 'subagent', label: 'r2', startedAt: 1, status: 'running' });
    const lostRuntimes = registry.markRemoteHostRuntimesInterrupted(hostPid, 'handoff_host_lost:test');
    assert.equal(lostRuntimes.length, 1);
    assert.equal(registry.getLiveRuntime('remote-2'), null);
    await registry.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes['remote-2']?.status, 'interrupted');
    assert.ok(ledger.runtimes['remote-2']?.recoveryData?.restartEpoch > 0);

    // Persistence sink: the draining side stops writing the ledger file.
    const sinkEvents: string[] = [];
    registry.setLiveRuntimePersistenceSink({
      upsert: (runtime, eventType) => sinkEvents.push(`upsert:${runtime.id}:${eventType}`),
      delete: (id, eventType) => sinkEvents.push(`delete:${id}:${eventType}`),
    });
    const before = fs.statSync(ledgerPath).mtimeMs;
    const drained = registry.registerLiveRuntime({ kind: 'subagent', label: 'draining', abortSignal: { aborted: false } });
    registry.updateLiveRuntimeCheckpoint(drained, { event: 'working' });
    registry.finishLiveRuntime(drained);
    await registry.flushLiveRuntimePersistence();
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    assert.ok(sinkEvents.includes(`upsert:${drained}:registered`), 'registrations go to the sink');
    assert.ok(sinkEvents.includes(`delete:${drained}:completed`), 'completions go to the sink');
    assert.equal(fs.statSync(ledgerPath).mtimeMs, before, 'ledger file untouched while the sink is installed');
    assert.equal(registry.areLedgerWritesFrozen(), true);
    registry.setRemoteRuntimeControlForwarder(null);
  }

  // ── Lifecycle plan / initiating-runtime rules ──────────────────────────────
  {
    const lifecycle = await import('../lifecycle');
    const base = { reason: 'manual' as const, timestamp: Date.now() };
    const rt = (extra: Record<string, unknown>) => ({ id: 'r', kind: 'main_chat', label: 'x', startedAt: 1, abortable: true, status: 'running', ...extra }) as any;
    assert.equal(lifecycle.isRestartInitiatingRuntime(rt({ checkpoint: { toolName: 'gateway_restart' } }), base), true, 'the turn inside gateway_restart is the initiator');
    assert.equal(lifecycle.isRestartInitiatingRuntime(rt({ checkpoint: { toolName: 'prom_apply_dev_changes' } }), base), true);
    assert.equal(lifecycle.isRestartInitiatingRuntime(rt({ taskId: 't1' }), { ...base, taskId: 't1' }), true, 'the restart-owning task is the initiator');
    assert.equal(lifecycle.isRestartInitiatingRuntime(rt({ sessionId: 'dev' }), { ...base, devApplyBatch: { id: 'b', memberIds: [], memberSessionIds: ['dev'], files: [], members: [] } }), true);
    assert.equal(lifecycle.isRestartInitiatingRuntime(rt({ sessionId: 'default', checkpoint: { toolName: 'browser_click' } }), { ...base, previousSessionId: 'default' }), false, 'previousSessionId is a hint, not ownership');
    const plan = lifecycle.planGatewayHandoff({ ...base, handoffPolicy: 'never' });
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'policy_never');
    assert.equal(lifecycle.planGatewayHandoff({ ...base, electronManaged: true }).reason, 'electron_managed');
    assert.equal(lifecycle.planGatewayHandoff({ ...base, restartScope: 'supervisor' }).reason, 'supervisor_replacement');
    assert.equal(lifecycle.planGatewayHandoff({ ...base, restartLauncher: 'external_supervisor' }).reason, 'supervisor_without_ipc', 'no IPC channel means no handoff under a supervisor');
  }

  console.log('gateway handoff regression: ok');
  fs.rmSync(root, { recursive: true, force: true });
}

function unusedAdapter() {
  return {
    syncHostRuntimes: () => { throw new Error('unexpected sync'); },
    upsertHostRuntime: () => undefined,
    deleteHostRuntime: () => undefined,
    broadcast: () => undefined,
    sessionFlushed: () => undefined,
    hostDrained: () => undefined,
    hostLost: () => undefined,
    log: () => undefined,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(predicate(), `timed out waiting for: ${label}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
