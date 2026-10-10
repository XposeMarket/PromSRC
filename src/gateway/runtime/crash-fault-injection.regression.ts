/**
 * Crash fault injection: kill the gateway process mid-work with no graceful
 * shutdown, then recover from a fresh process and check that every runtime is
 * classified correctly. In particular, work that already committed a side
 * effect must never be blindly replayed.
 *
 * A child process registers live runtimes in different phases (read-only tool,
 * mutating tool that committed, idempotent retry, completed, user-cancelled,
 * waiting on an approval), flushes the durable ledger, prints READY and is
 * then hard-killed (TerminateProcess / SIGKILL). The parent, a different pid
 * on the same data dir, plays the next gateway boot.
 *
 * Run: npm run test:crash-recovery
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHILD_FLAG = '--crash-child';

interface Case {
  key: string;
  label: string;
  recoveryPolicy: 'resume' | 'rerun' | 'mark_interrupted' | 'do_not_resume';
  envelope: { effectClass: 'read_only' | 'idempotent' | 'mutating' | 'unknown'; idempotencyKey?: string };
  checkpoint: Record<string, any>;
  abort?: boolean;
  finish?: boolean;
}

const CASES: Case[] = [
  {
    key: 'read_only_tool',
    label: 'crashed during a read-only tool',
    recoveryPolicy: 'rerun',
    envelope: { effectClass: 'read_only' },
    checkpoint: { event: 'tool_call', phase: 'waiting_tool', toolName: 'web_fetch', effectClass: 'read_only' },
  },
  {
    key: 'mutating_committed_no_key',
    label: 'crashed after a send committed, no idempotency key',
    recoveryPolicy: 'rerun',
    envelope: { effectClass: 'mutating' },
    checkpoint: { event: 'tool_result', phase: 'committing', toolName: 'connector_gmail', effectClass: 'mutating', sideEffectCommitted: true },
  },
  {
    key: 'mutating_resume_no_key',
    label: 'resumable turn whose committed mutation has no idempotency key',
    recoveryPolicy: 'resume',
    envelope: { effectClass: 'mutating' },
    checkpoint: { event: 'tool_result', phase: 'committing', toolName: 'x_posts', effectClass: 'mutating', sideEffectCommitted: true },
  },
  {
    key: 'idempotent_with_key',
    label: 'crashed during an idempotent call with a key',
    recoveryPolicy: 'rerun',
    envelope: { effectClass: 'idempotent', idempotencyKey: 'upload:abc123' },
    checkpoint: { event: 'tool_call', phase: 'waiting_tool', toolName: 'media_upload', effectClass: 'idempotent' },
  },
  {
    key: 'waiting_user_approval',
    label: 'crashed while waiting on an approval',
    recoveryPolicy: 'mark_interrupted',
    envelope: { effectClass: 'unknown' },
    checkpoint: { event: 'approval_wait', phase: 'waiting_user', toolName: 'run_command' },
  },
  {
    key: 'completed',
    label: 'finished just before the crash',
    recoveryPolicy: 'rerun',
    envelope: { effectClass: 'read_only' },
    checkpoint: { event: 'done', phase: 'completed' },
  },
  {
    key: 'user_cancelled',
    label: 'user pressed Stop just before the crash',
    recoveryPolicy: 'rerun',
    envelope: { effectClass: 'read_only' },
    checkpoint: { event: 'tool_call', phase: 'running', toolName: 'web_search' },
    abort: true,
  },
];

async function child(): Promise<void> {
  const registry = require('../live-runtime-registry') as typeof import('../live-runtime-registry');
  const contract = require('./execution-contract') as typeof import('./execution-contract');
  const ids: Record<string, string> = {};
  for (const c of CASES) {
    const envelope = contract.createExecutionEnvelope({
      kind: 'main_chat' as any,
      label: c.label,
      recoveryPolicy: c.recoveryPolicy,
      effectClass: c.envelope.effectClass,
      idempotencyKey: c.envelope.idempotencyKey,
      owner: { sessionId: `crash_${c.key}` },
    });
    const id = registry.registerLiveRuntime({
      kind: 'main_chat',
      label: c.label,
      sessionId: `crash_${c.key}`,
      recoveryPolicy: c.recoveryPolicy,
      recoveryData: { executionEnvelope: envelope, crashCase: c.key },
      abortSignal: { aborted: false },
      onAbort: () => undefined,
    });
    registry.updateLiveRuntimeCheckpoint(id, c.checkpoint);
    if (c.abort) registry.abortLiveRuntime(id, 'operator_abort', { source: 'mobile_stop_button' });
    ids[c.key] = id;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  await registry.flushLiveRuntimePersistence();
  process.stdout.write(`READY ${JSON.stringify(ids)}\n`);
  // Stay alive doing "work" until the parent kills us without warning.
  setInterval(() => undefined, 1_000);
}

async function runChildAndKill(root: string): Promise<Record<string, string>> {
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const proc = spawn(process.execPath, [tsxCli, __filename, CHILD_FLAG], {
    env: { ...process.env, PROMETHEUS_DATA_DIR: root, PROMETHEUS_WORKSPACE_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stderr.on('data', (d) => { err += String(d); });
  const ids = await new Promise<Record<string, string>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child never reported READY. stderr:\n${err.slice(-2000)}`)), 60_000);
    proc.stdout.on('data', (d) => {
      out += String(d);
      const m = /READY (\{.*\})/.exec(out);
      if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`child exited early (${code}). stderr:\n${err.slice(-2000)}`)); });
  });
  proc.removeAllListeners('exit');
  const exited = new Promise<void>((resolve) => proc.on('exit', () => resolve()));
  proc.kill('SIGKILL'); // hard kill: no shutdown hooks, no drain, no final flush
  await exited;
  return ids;
}

async function parent(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-crash-'));
  try {
    const ids = await runChildAndKill(root);
    process.env.PROMETHEUS_DATA_DIR = root;
    process.env.PROMETHEUS_WORKSPACE_DIR = root;
    const registry = require('../live-runtime-registry') as typeof import('../live-runtime-registry');
    const contract = require('./execution-contract') as typeof import('./execution-contract');

    const ledgerPath = path.join(root, '.prometheus', 'runtimes', 'active-runtimes.json');
    assert.ok(fs.existsSync(ledgerPath), 'durable ledger survived the crash');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    for (const c of CASES) {
      assert.ok(ledger.runtimes[ids[c.key]], `${c.key}: runtime missing from the ledger after the crash`);
    }

    const recoverable = new Set(registry.listInterruptedRuntimes().map((r) => r.id));
    const byKey = (key: string) => registry.listDurableRuntimes().find((r) => r.id === ids[key])!;
    const decide = (key: string) => {
      const rt = byKey(key);
      return contract.decideExecutionReplay({ envelope: contract.envelopeFromLiveRuntime(rt), checkpoint: rt.checkpoint as any, runtime: rt as any });
    };

    const rows: string[] = [];
    const expect = (key: string, recov: boolean, action: string, why: string) => {
      assert.equal(recoverable.has(ids[key]), recov, `${key}: recoverable=${!recov} but expected ${recov} (${why})`);
      const decision = decide(key);
      assert.equal(decision.action, action, `${key}: decision ${decision.action} (${decision.reason}), expected ${action}: ${why}`);
      rows.push(`  ok  ${key.padEnd(28)} recoverable=${recov ? 'yes' : 'no '} -> ${decision.action} (${decision.reason})`);
    };

    expect('read_only_tool', true, 'rerun', 'observational work is safe to run again');
    expect('mutating_committed_no_key', true, 'manual', 'a committed send without an idempotency key must not be replayed');
    expect('mutating_resume_no_key', true, 'manual', 'even resumable turns must not re-run a committed mutation without a key');
    expect('idempotent_with_key', true, 'rerun', 'an idempotency key makes the retry safe');
    expect('waiting_user_approval', true, 'manual', 'an interrupted approval wait goes back to the owner, not auto-run');
    expect('completed', false, 'terminal', 'finished work is not recovered');
    expect('user_cancelled', false, 'terminal', 'a user Stop is not undone by a crash');

    // Recovery marks what it handled so a second boot does not recover it again.
    for (const key of ['read_only_tool', 'mutating_committed_no_key']) {
      registry.markDurableRuntimeRecovered(ids[key], 'interrupted', { recovery: 'crash_fault_injection' });
    }
    await registry.flushLiveRuntimePersistence();
    const second = new Set(registry.listInterruptedRuntimes().map((r) => r.id));
    assert.ok(!second.has(ids.read_only_tool), 'a recovered runtime came back on the next boot');
    assert.ok(!second.has(ids.mutating_committed_no_key), 'a recovered runtime came back on the next boot');
    rows.push('  ok  recovered runtimes are not recovered twice');

    process.stdout.write(`crash fault injection (child hard-killed after flush)\n${rows.join('\n')}\n`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}

if (process.argv.includes(CHILD_FLAG)) {
  child().catch((e) => { process.stderr.write(String(e?.stack || e)); process.exit(1); });
} else {
  parent().then(() => process.exit(0), (e) => { process.stdout.write(`FAIL ${e?.stack || e}\n`); process.exit(1); });
}
