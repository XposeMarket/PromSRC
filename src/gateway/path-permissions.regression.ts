import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-path-permissions-'));
const dataRoot = path.join(root, 'data');
const workspace = path.join(root, 'workspace');
const externalPath = path.join(root, 'outside-workspace');

async function run(): Promise<void> {
  const previousDataRoot = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspace = process.env.PROMETHEUS_WORKSPACE_DIR;
  try {
    process.env.PROMETHEUS_DATA_DIR = dataRoot;
    process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

    const { getConfig } = await import('../config/config');
    const { getApprovalQueue } = await import('./verification-flow');
    const { resolveApprovalDecision } = await import('./approval-actions');
    const { addPersistentAllowedPaths } = await import('./path-permissions');

    const queue = getApprovalQueue();
    const approval = queue.create({
      sessionId: 'path-permissions-regression',
      toolName: 'run_command',
      toolArgs: { command: `Get-ChildItem "${externalPath}"` },
      approvalKind: 'command',
      pathAccess: { requestedPath: externalPath, requestedPaths: [externalPath] },
      action: `Run terminal command outside workspace in ${externalPath}`,
      reason: 'Regression approval for an external path.',
      policyTier: 'commit',
      riskScore: 7,
      affectedSystems: ['outside_workspace'],
    });

    const resolved = resolveApprovalDecision({
      approvalId: approval.id,
      decision: 'approved',
      grantScope: 'always',
    });

    assert.equal(resolved.success, true);
    assert.equal(resolved.approval?.status, 'approved');

    const allowedPaths = (getConfig().getConfig() as any).tools.permissions.files.allowed_paths as string[];
    assert.ok(allowedPaths.some((entry) => path.resolve(entry) === path.resolve(externalPath)));
    const persistedConfig = JSON.parse(fs.readFileSync(path.join(dataRoot, '.prometheus', 'config.json'), 'utf8')) as any;
    assert.ok((persistedConfig.tools?.permissions?.files?.allowed_paths || [])
      .some((entry: string) => path.resolve(entry) === path.resolve(externalPath)));
    assert.deepEqual(addPersistentAllowedPaths([externalPath]), []);

    console.log('path permissions regression passed');
  } finally {
    if (previousDataRoot === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataRoot;
    if (previousWorkspace === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspace;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
