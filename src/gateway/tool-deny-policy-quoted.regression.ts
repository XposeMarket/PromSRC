import assert from 'node:assert/strict';
import { evaluateHardToolDeny, stripQuotedLiterals } from './tool-deny-policy';

// Regression (2026-09-22): a read-only log search was blocked as
// machine_interruption because its quoted search pattern contained the words
// "restart" and "shutdown".

const category = (cmd: string): string => {
  const d: any = evaluateHardToolDeny({
    toolName: 'run_command',
    args: { command: cmd },
    executionPolicy: { mode: 'goal_autonomous' } as any,
  });
  return d && d.denied ? String(d.category || '') : '';
};

// Quoted mentions are allowed.
for (const cmd of [
  `Get-Content gateway.log | Select-String -Pattern "restart|shutdown|watchdog"`,
  `Select-String -Path x.log -Pattern 'shutdown'`,
  `echo "gateway shutdown observed at 14:54"`,
  `git commit -m "Handle interrupted restart and shutdown recovery"`,
  `rg "Restart-Computer" src`,
]) {
  assert.notEqual(category(cmd), 'machine_interruption', `quoted mention must not be blocked: ${cmd}`);
}

// Real power-state commands are still blocked, including wrapped ones.
for (const cmd of [
  `shutdown /r /t 0`,
  `shutdown.exe -s -t 0`,
  `Restart-Computer -Force`,
  `Stop-Computer`,
  `cmd /c "shutdown /s /t 0"`,
  `powershell -Command "Restart-Computer -Force"`,
  `logoff`,
]) {
  assert.equal(category(cmd), 'machine_interruption', `power command must stay blocked: ${cmd}`);
}

assert.equal(stripQuotedLiterals(`a "b c" 'd' e`), `a "" '' e`);

console.log('tool-deny-policy quoted-literal regression: ok');
