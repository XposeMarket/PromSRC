import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-elevated-approval-'));
process.env.PROMETHEUS_DATA_DIR = dataDir;

try {
  const require = createRequire(import.meta.url);
  const { getApprovalQueue, serializeApprovalForClient } = require('../dist/gateway/verification-flow.js');
  const { resolveApprovalDecision } = require('../dist/gateway/approval-actions.js');
  const { addCommandPermissionGrant, findCommandPermissionGrant } = require('../dist/gateway/command-permissions.js');

  const permissionCandidate = {
    sessionId: 'goal_auto_approval_test',
    toolName: 'run_command',
    action: 'whoami /groups',
    targetKind: 'command_cwd',
    target: root,
    command: 'whoami /groups',
    cwd: root,
    workspaceRoot: root,
    riskScore: 10,
    requiresAdmin: true,
    requiresExplicitApproval: true,
    oneShot: true,
  };
  assert.equal(findCommandPermissionGrant(permissionCandidate), null, 'one-shot commands must never match saved grants');
  assert.throws(() => addCommandPermissionGrant(permissionCandidate, 'always', 'test'), /one-shot/i,
    'one-shot commands must never create saved grants');

  const approval = getApprovalQueue().create({
    sessionId: 'goal_auto_approval_test',
    toolName: 'run_command',
    toolArgs: { command: 'whoami /groups', elevated: true },
    approvalKind: 'elevated_command',
    action: 'Run as administrator: whoami /groups',
    reason: 'test',
    policyTier: 'commit',
    riskScore: 10,
    affectedSystems: ['windows_administrator', 'uac'],
  });
  assert.equal(serializeApprovalForClient(approval).oneShot, true, 'elevated approval card must be marked one-shot');

  const saveAttempt = resolveApprovalDecision({
    approvalId: approval.id,
    decision: 'approved',
    grantScope: 'always',
    resolvedBy: 'test',
  });
  assert.equal(saveAttempt.success, false, 'Always Allow must be rejected for elevated approvals');
  assert.equal(getApprovalQueue().get(approval.id)?.status, 'pending', 'rejected save attempt must leave approval pending');

  const oneShotApproval = resolveApprovalDecision({ approvalId: approval.id, decision: 'approved', resolvedBy: 'test' });
  assert.equal(oneShotApproval.success, true, 'Approve Once must remain available');
  assert.equal(oneShotApproval.permissionGrant, null, 'approval must not create a reusable permission');

  const executorSource = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
  assert.match(executorSource, /const isLiteCommandApprovalBypass = !isElevatedCommand/);
  assert.match(executorSource, /const isAutonomousCommandApprovalBypass = !isElevatedCommand/);
  assert.match(executorSource, /approvalKind: isElevatedCommand \? 'elevated_command'/);
  assert.match(executorSource, /if \(!approvedCommandApprovalId\)/);

  const brokerSource = fs.readFileSync(path.join(root, 'src/gateway/process/elevated-command.ts'), 'utf8');
  assert.match(brokerSource, /Register-ScheduledTask/,
    'administrator broker must use a one-time highest-privilege scheduled task');
  assert.match(brokerSource, /New-ScheduledTaskPrincipal[\s\S]*-RunLevel Highest/);
  assert.match(brokerSource, /net\.createConnection\(identity\.pipeName\)/,
    'approved commands must use local broker IPC instead of per-command UAC');
  assert.match(brokerSource, /protocol: 2/,
    'broker protocol changes must reinstall the corrected protected helper');
  assert.match(brokerSource, /settleFromResponse\(\)/,
    'a complete broker response must win over the trailing Windows named-pipe EPIPE');
  assert.match(brokerSource, /socket\.destroy\(\);[\s\S]*if \(parsed\.ok === true\) resolve\(\)/,
    'the gateway must close locally once the complete broker response arrives');
  assert.doesNotMatch(brokerSource, /--elevated-run', requestPath/,
    'runtime must not launch per-command runas helpers');

  const nativeSource = fs.readFileSync(path.join(root, 'native/desktop-helper-windows/main.cpp'), 'utf8');
  assert.match(nativeSource, /GetNamedPipeClientProcessId/);
  assert.match(nativeSource, /process_owns_listening_port\(client_pid, gateway_port\)/,
    'dev gateway broker requests must be bound to the actual gateway port owner');
  assert.match(nativeSource, /AF_INET6, TCP_TABLE_OWNER_PID_LISTENER/,
    'gateway ownership checks must work when the dev gateway listens on IPv6');
  assert.match(nativeSource, /GetConsoleWindow\(\)/,
    'the persistent administrator broker must not leave a visible console window');
  assert.ok(
    nativeSource.indexOf('const std::string request = read_pipe_message(pipe)')
      < nativeSource.indexOf('process_owns_listening_port(client_pid, gateway_port)'),
    'the broker must read the request before authentication so failures are returned instead of surfacing as EPIPE',
  );

  for (const file of [
    'web-ui/src/pages/ChatPage.js',
    'web-ui/src/pages/SubagentsPage.js',
    'web-ui/src/pages/TeamsPage.js',
    'web-ui/src/mobile/mobile-pages.js',
    'src/gateway/comms/telegram-channel.ts',
    'src/gateway/terminal-ui.ts',
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /elevated_command/,
      `${file} must recognize elevated approvals on the existing approval card path`);
  }

  console.log('Elevated command approval invariants passed.');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
