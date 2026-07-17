import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lifecycle = require('../dist/gateway/lifecycle.js');

const originalSupervised = process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
const originalCloseOld = process.env.PROMETHEUS_CLOSE_OLD_TERMINAL_ON_RESTART;
const originalRestartCloseOld = process.env.PROMETHEUS_RESTART_CLOSE_OLD_TERMINAL;

try {
  delete process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
  delete process.env.PROMETHEUS_CLOSE_OLD_TERMINAL_ON_RESTART;
  delete process.env.PROMETHEUS_RESTART_CLOSE_OLD_TERMINAL;

  assert.equal(
    lifecycle.shouldClosePreviousTerminalAfterRestart({
      reason: 'build_deploy',
      timestamp: Date.now(),
      restartLauncher: 'external_supervisor',
    }),
    false,
    'an externally supervised restart must preserve the shell/supervisor process tree',
  );

  process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD = '1';
  assert.equal(
    lifecycle.shouldClosePreviousTerminalAfterRestart({
      reason: 'build_deploy',
      timestamp: Date.now(),
    }),
    false,
    'the supervised child environment must independently disable terminal cleanup',
  );

  delete process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
  assert.equal(
    lifecycle.shouldClosePreviousTerminalAfterRestart({
      reason: 'manual',
      timestamp: Date.now(),
      restartLauncher: 'prom_gateway_start',
    }),
    true,
    'an ordinary terminal-launched gateway may still close its previous terminal',
  );

  assert.equal(
    lifecycle.shouldClosePreviousTerminalAfterRestart({
      reason: 'manual',
      timestamp: Date.now(),
      restartLauncher: 'electron',
      electronManaged: true,
    }),
    false,
    'Electron remains responsible for its own process tree',
  );

  console.log('supervised restart cleanup regression: ok');
} finally {
  if (originalSupervised === undefined) delete process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD;
  else process.env.PROMETHEUS_SUPERVISED_GATEWAY_CHILD = originalSupervised;
  if (originalCloseOld === undefined) delete process.env.PROMETHEUS_CLOSE_OLD_TERMINAL_ON_RESTART;
  else process.env.PROMETHEUS_CLOSE_OLD_TERMINAL_ON_RESTART = originalCloseOld;
  if (originalRestartCloseOld === undefined) delete process.env.PROMETHEUS_RESTART_CLOSE_OLD_TERMINAL;
  else process.env.PROMETHEUS_RESTART_CLOSE_OLD_TERMINAL = originalRestartCloseOld;
}
