// run_command direct-exec fast path: plain git/node/rg commands skip the
// ~250-300 ms powershell.exe startup. Anything shell-shaped must keep using
// PowerShell, and direct runs must behave like the shell run (output, exit code).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDirectExecCommand, ProcessSupervisor } from './supervisor';
import { ProcessRunStore } from './store';

// Parser: accepted shapes.
assert.deepEqual(parseDirectExecCommand('git status --short'), ['git', 'status', '--short']);
assert.deepEqual(parseDirectExecCommand('git.exe log -1 --oneline'), ['git', 'log', '-1', '--oneline']);
assert.deepEqual(parseDirectExecCommand('node scripts/test-x.mjs --flag=1'), ['node', 'scripts/test-x.mjs', '--flag=1']);
assert.deepEqual(parseDirectExecCommand('rg -n "foo bar" src -g *.ts'), ['rg', '-n', 'foo bar', 'src', '-g', '*.ts']);
assert.deepEqual(parseDirectExecCommand('node C:\\Users\\x\\a.cjs before 6'), ['node', 'C:\\Users\\x\\a.cjs', 'before', '6']);

// Parser: everything shell-shaped stays on PowerShell.
for (const command of [
  'npm run build',                         // not allowlisted (.cmd shim)
  'npx tsc --noEmit',
  'git status | Select -First 5',          // pipeline
  'git log -1; git status',                // sequence
  'git status > out.txt',                  // redirection
  'git status 2>&1',
  "git log --format='%h'",                 // single quotes are PowerShell syntax
  'git log --format="$x"',                 // variable inside double quotes
  'node -e "console.log(1)" && echo hi',   // operator
  'node $script',                          // variable
  'node (Get-Item x).FullName',            // subexpression
  'git commit -m "a`nb"',                  // backtick escape
  'node a.js @args',                       // splat
  'node a.js a,b',                         // array
  'git status # comment',                  // comment
  'node ~/x.js',                           // home expansion
  'git status\ngit log',                   // multi-line
  'node a.js --% raw',                     // stop-parsing token
  'Get-Content x',                         // cmdlet
  'cd src; git status',
]) {
  assert.equal(parseDirectExecCommand(command), null, `must stay on the shell: ${command}`);
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('direct-exec regression: parser ok (spawn checks are Windows-only)');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-direct-exec-'));
  const supervisor = new ProcessSupervisor(new ProcessRunStore(path.join(root, 'runs')));
  try {
    const script = path.join(root, 'exit.cjs');
    fs.writeFileSync(script, "process.stdout.write('héllo ✓\\n'); process.stderr.write('warn\\n'); process.exit(Number(process.argv[2] || 0));\n");
    const timed = async (command: string, shell?: 'auto' | 'powershell') => {
      const started = performance.now();
      const run = await supervisor.spawn({ command, cwd: root, mode: 'foreground', shell, timeoutMs: 20_000 });
      const exit = await run.wait();
      // Exit details plus the shell line recorded on the run record.
      const record = { ...exit, shellCommand: run.record.shellCommand };
      return { record, ms: performance.now() - started };
    };
    const direct = await timed(`node ${script} 3`);
    assert.match(String(direct.record.shellCommand), /direct exec, no shell/);
    assert.equal(direct.record.exitCode, 3, 'direct exec must keep the real exit code');
    const viaShell = await timed(`node ${script} 3`, 'powershell');
    assert.doesNotMatch(String(viaShell.record.shellCommand), /direct exec/);
    assert.equal(viaShell.record.exitCode, 3);
    const out = (record: any) => String(record.stdout ?? record.outputPreview ?? '');
    assert.match(out(direct.record), /héllo ✓/, 'direct exec output must be UTF-8 clean');

    const shellOnly = await timed(`node ${script} 0; Write-Output after`);
    assert.doesNotMatch(String(shellOnly.record.shellCommand), /direct exec/);
    assert.match(out(shellOnly.record), /after/);

    const samples = { direct: [] as number[], shell: [] as number[] };
    for (let i = 0; i < 4; i += 1) {
      samples.direct.push((await timed('git --version')).ms);
      samples.shell.push((await timed('git --version', 'powershell')).ms);
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(`direct-exec regression: ok (git --version median direct ${median(samples.direct).toFixed(0)} ms vs powershell ${median(samples.shell).toFixed(0)} ms)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
