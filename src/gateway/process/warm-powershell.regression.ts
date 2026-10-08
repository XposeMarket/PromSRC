// Regression: shell-path commands run through pre-warmed powershell.exe spares
// with identical semantics to the cold path (output, UTF-8, exit codes, cwd,
// per-command isolation, timeouts) and are faster.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProcessSupervisor } from './supervisor';
import { ProcessRunStore } from './store';
import { disposeWarmPowerShell, getWarmPowerShellStats, prewarmPowerShell } from './warm-powershell';

if (process.platform !== 'win32') {
  console.log('warm powershell regression: skipped (not Windows)');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-warm-ps-'));
const cwdA = path.join(root, 'a b');
fs.mkdirSync(cwdA, { recursive: true });
const sup = new ProcessSupervisor(new ProcessRunStore(path.join(root, 'runs')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(command: string, extra: Record<string, unknown> = {}) {
  const t = performance.now();
  const managed = await sup.spawn({ command, cwd: cwdA, ...extra } as any);
  const exit = await managed.wait();
  return { exit, ms: performance.now() - t, record: (managed as any).record ?? null };
}

(async () => {
  // Cold baseline with warm disabled.
  process.env.PROMETHEUS_DISABLE_WARM_SHELL = '1';
  const cold: number[] = [];
  for (let i = 0; i < 3; i += 1) cold.push((await run('$x = 1; "cold $x" | Select-Object -First 1')).ms);
  delete process.env.PROMETHEUS_DISABLE_WARM_SHELL;

  prewarmPowerShell('powershell.exe', process.env, cwdA);
  await sleep(1500);
  assert(getWarmPowerShellStats().spares >= 1, 'prewarm should create spares');

  // Output, pipelines and variables.
  let r = await run('$n = 2 + 3; "sum=$n" | Select-Object -First 1');
  assert.equal(r.exit.exitCode, 0);
  assert.equal(r.exit.stdout, 'sum=5');

  // cwd with a space and a quote-free path, both PS location and .NET cwd.
  r = await run('(Get-Location).Path; [System.Environment]::CurrentDirectory');
  assert.deepEqual(r.exit.stdout.split(/\r?\n/).map((s) => s.trim()), [cwdA, cwdA]);

  // UTF-8 round trip (script text and output).
  r = await run('"caf\u00e9 \u2014 \u2713"');
  assert.equal(r.exit.stdout, 'caf\u00e9 \u2014 \u2713');

  // Exit codes: explicit exit, native nonzero, cmdlet error, stderr-only native success.
  assert.equal((await run('exit 7')).exit.exitCode, 7);
  assert.equal((await run('cmd /c exit 3')).exit.exitCode, 3);
  assert.equal((await run('Get-Item C:\\definitely\\missing\\pm 2>$null')).exit.exitCode, 1);
  r = await run('cmd /c "echo warn 1>&2" 2>&1; "done"');
  assert.equal(r.exit.exitCode, 0, 'stderr-only native output must stay exit 0');
  assert.match(r.exit.stdout, /done/);

  // Isolation: variables and location do not leak between commands.
  await run('$global:pmLeak = 1; Set-Location C:\\');
  r = await run('"[$global:pmLeak]"; (Get-Location).Path');
  assert.equal(r.exit.stdout.split(/\r?\n/)[0].trim(), '[]');
  assert.equal(r.exit.stdout.split(/\r?\n/)[1].trim(), cwdA);

  // Timeout still kills the process.
  r = await run('Start-Sleep -Seconds 20; "never"', { timeoutMs: 1500 });
  assert.equal(r.exit.timedOut, true);
  assert(r.ms < 8000, `timeout should kill promptly, took ${r.ms.toFixed(0)}ms`);

  // stdin-driven runs keep the cold path and still work.
  r = await run('$input | ForEach-Object { "got $_" }', { input: 'hello\n' });
  assert.match(r.exit.stdout, /got hello/);

  // Speed: steady-state warm runs vs cold.
  const warm: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await sleep(700); // let the refill finish, as between real tool calls
    warm.push((await run('$x = 1; "warm $x" | Select-Object -First 1')).ms);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const stats = getWarmPowerShellStats();
  assert(stats.claimed >= 5, `expected warm claims, got ${JSON.stringify(stats)}`);
  assert(med(warm) < med(cold), `warm ${med(warm).toFixed(0)}ms should beat cold ${med(cold).toFixed(0)}ms`);

  disposeWarmPowerShell();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`warm powershell regression: ok (cold median ${med(cold).toFixed(0)}ms, warm median ${med(warm).toFixed(0)}ms, ${JSON.stringify(stats)})`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  disposeWarmPowerShell();
  process.exit(1);
});
