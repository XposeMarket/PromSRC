// Regression checks for the persistent desktop PowerShell host.
// Run: npx tsx scripts/test-desktop-powershell-host.mjs  (Windows only; skips elsewhere)
import assert from 'node:assert/strict';

if (process.platform !== 'win32') {
  console.log('desktop PowerShell host tests skipped (not Windows).');
  process.exit(0);
}

const host = await import('../src/gateway/desktop-powershell-host.ts');
const { runPowerShellInHost, PowerShellHostBusyError, scriptChangesDpiAwareness, disposeDesktopPowerShellHosts, getDesktopPowerShellHostStats } = host;

try {
  // Output is the success stream, trimmed, like execFile + .trim().
  assert.equal(await runPowerShellInHost("'hello'"), 'hello');

  // Unicode survives the temp .ps1 (BOM) and the UTF-8 console.
  assert.equal(await runPowerShellInHost("'héllo ✓ 日本'"), 'héllo ✓ 日本');

  // Script scope is per call: $script: state never leaks into the next call.
  await runPowerShellInHost("$script:leak = 'x'; 'set'");
  assert.equal(await runPowerShellInHost("if ($script:leak) { 'leaked' } else { 'clean' }"), 'clean');

  // exit <nonzero> with no output rejects; `exit` never kills the host.
  await assert.rejects(runPowerShellInHost('exit 3'), /code 3/);
  assert.equal(await runPowerShellInHost("'still alive'"), 'still alive');

  // Output wins over a later non-zero exit (matches the spawn path).
  assert.equal(await runPowerShellInHost("'partial'; exit 2"), 'partial');

  // Terminating errors reject with the message.
  await assert.rejects(runPowerShellInHost("throw 'boom'"), /boom/);

  // Error-stream-only output rejects; mixed output resolves with the output.
  await assert.rejects(runPowerShellInHost("Write-Error 'only-error'"), /only-error/);
  assert.equal(await runPowerShellInHost("Write-Error 'ignored'; 'value'"), 'value');

  // Marker framing: stray console writes cannot corrupt the protocol.
  assert.equal(await runPowerShellInHost("[Console]::Out.WriteLine('noise'); 'framed'"), 'framed');

  // Timeout kills the stuck host and the next call gets a fresh one.
  await assert.rejects(runPowerShellInHost('Start-Sleep -Seconds 5', { timeoutMs: 600 }), /timed out/);
  assert.equal(await runPowerShellInHost("'recovered'"), 'recovered');

  // Abort rejects with AbortError and does not poison later calls.
  const ac = new AbortController();
  const aborted = runPowerShellInHost('Start-Sleep -Seconds 5', { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  await assert.rejects(aborted, (err) => err?.name === 'AbortError');
  assert.equal(await runPowerShellInHost("'after abort'"), 'after abort');

  // Pool never queues: when all hosts of a kind are busy the caller is told to fall back.
  const busy = [1, 2, 3].map(() => runPowerShellInHost('Start-Sleep -Milliseconds 700; "slow"', { sta: true }));
  await assert.rejects(runPowerShellInHost("'fourth'", { sta: true }), (err) => err instanceof PowerShellHostBusyError);
  assert.deepEqual(await Promise.all(busy), ['slow', 'slow', 'slow']);

  // Concurrent calls on different hosts all resolve with their own output.
  const many = await Promise.all([1, 2, 3].map((n) => runPowerShellInHost(`"${n}"`)));
  assert.deepEqual(many, ['1', '2', '3']);

  // DPI-changing scripts are detected so they never share an unaware host.
  assert.equal(scriptChangesDpiAwareness('[PrometheusDpiApi]::SetProcessDpiAwarenessContext(-4)'), true);
  assert.equal(scriptChangesDpiAwareness("'plain'"), false);

  // Warm repeat calls are fast (no process start).
  const t = performance.now();
  for (let i = 0; i < 10; i += 1) await runPowerShellInHost("'x'");
  const perCall = (performance.now() - t) / 10;
  assert.ok(perCall < 120, `warm host call took ${perCall.toFixed(1)}ms (expected < 120ms; a fresh powershell.exe is 230-440ms)`);

  assert.ok(getDesktopPowerShellHostStats().length >= 2);
  console.log(`desktop PowerShell host tests passed (warm call ${perCall.toFixed(1)}ms).`);
} finally {
  disposeDesktopPowerShellHosts();
}
