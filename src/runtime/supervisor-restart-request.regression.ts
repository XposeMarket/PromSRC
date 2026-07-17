import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SUPERVISOR_RESTART_REQUEST_MAX_AGE_MS,
  requiresSupervisorRestartForFiles,
  resolveGatewayRestartScope,
  supervisorRestartRequestPath,
  takeSupervisorRestartRequest,
  writeSupervisorRestartRequest,
} from './supervisor-restart-request';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-supervisor-restart-'));
try {
  assert.equal(requiresSupervisorRestartForFiles(['src/gateway/lifecycle.ts']), false);
  assert.equal(requiresSupervisorRestartForFiles(['src/cli/index.ts']), true);
  assert.equal(requiresSupervisorRestartForFiles(['C:\\Users\\rafel\\PromSRC\\src\\cli\\gateway-supervisor-policy.ts']), true);
  assert.equal(requiresSupervisorRestartForFiles(['src/runtime/supervisor-restart-request.ts']), true);
  assert.equal(requiresSupervisorRestartForFiles(['bin/prometheus.js']), true);
  assert.equal(resolveGatewayRestartScope({ affectedFiles: ['src/gateway/lifecycle.ts'] }), 'gateway');
  assert.equal(resolveGatewayRestartScope({ affectedFiles: ['src/cli/index.ts'] }), 'supervisor');
  assert.equal(resolveGatewayRestartScope({ requestedScope: 'supervisor' }), 'supervisor');
  assert.equal(resolveGatewayRestartScope({ fullSupervisor: true }), 'supervisor');

  const now = 1_900_000_000_000;
  const request = writeSupervisorRestartRequest(root, {
    gatewayPid: 4321,
    reason: 'CLI supervisor changed\nforged line',
    affectedFiles: ['src/cli/index.ts', 'src/cli/index.ts'],
    now,
  });
  assert.equal(request.gatewayPid, 4321);
  assert.equal(request.reason, 'CLI supervisor changed forged line');
  assert.deepEqual(request.affectedFiles, ['src/cli/index.ts']);
  assert.equal(fs.existsSync(supervisorRestartRequestPath(root)), true);

  const mismatch = takeSupervisorRestartRequest(root, 9999, now + 1_000);
  assert.equal(mismatch.status, 'pid_mismatch');
  assert.equal(mismatch.request, null);
  assert.equal(fs.existsSync(supervisorRestartRequestPath(root)), false, 'wrong-PID requests are one-shot and discarded');

  writeSupervisorRestartRequest(root, { gatewayPid: 4321, now, affectedFiles: ['src/cli/index.ts'] });
  const accepted = takeSupervisorRestartRequest(root, 4321, now + 2_000);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.request?.gatewayPid, 4321);
  assert.equal(fs.existsSync(supervisorRestartRequestPath(root)), false);

  writeSupervisorRestartRequest(root, { gatewayPid: 4321, now, affectedFiles: ['src/cli/index.ts'] });
  const stale = takeSupervisorRestartRequest(root, 4321, now + SUPERVISOR_RESTART_REQUEST_MAX_AGE_MS + 1);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.request, null);

  fs.writeFileSync(supervisorRestartRequestPath(root), '{invalid', 'utf8');
  const invalid = takeSupervisorRestartRequest(root, 4321, now);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.request, null);
  assert.equal(fs.readdirSync(root).some((name) => name.includes('.claim-') || name.includes('.tmp-')), false);

  console.log('supervisor restart request regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
