import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-tool-security-'));
const dataRoot = path.join(testRoot, 'data');
const globalWorkspace = path.join(testRoot, 'global-workspace');
const scopedWorkspace = path.join(testRoot, 'scoped-workspace');
const outsideWorkspace = path.join(testRoot, 'outside');

function initRepo(root, content) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'target.txt'), content, 'utf8');
  execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
}

function targetPatch(before, after) {
  return [
    'diff --git a/target.txt b/target.txt',
    '--- a/target.txt',
    '+++ b/target.txt',
    '@@ -1 +1 @@',
    `-${before}`,
    `+${after}`,
    '',
  ].join('\n');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

try {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(outsideWorkspace, { recursive: true });
  initRepo(globalWorkspace, 'global-before\n');
  initRepo(scopedWorkspace, 'scoped-before\n');
  fs.writeFileSync(path.join(outsideWorkspace, 'secret.txt'), 'outside-secret\n', 'utf8');

  process.env.PROMETHEUS_DATA_DIR = dataRoot;
  process.env.PROMETHEUS_WORKSPACE_DIR = globalWorkspace;

  const { getPolicyEngine } = await import('../dist/gateway/policy.js');
  const { getToolRegistry } = await import('../dist/tools/registry.js');
  const { getConfig } = await import('../dist/config/config.js');
  const {
    shouldBypassGenericToolApproval,
  } = await import('../dist/gateway/tool-approval-mode.js');
  const { executeApplyPatch, executeRead } = await import('../dist/tools/files.js');
  const { validateShellRequest } = await import('../dist/tools/shell.js');
  const { runWithWorkspace, getActiveWorkspace, isPathInWorkspace } = await import('../dist/tools/workspace-context.js');

  const policy = getPolicyEngine();
  assert.equal(policy.evaluateAction('test', 'connector_github_list_issues', {}).tier, 'read');
  assert.equal(policy.evaluateAction('test', 'apply_patch', {}).tier, 'propose');
  assert.equal(policy.evaluateAction('test', 'x_api_delete_list', {}).tier, 'commit',
    'a mutation containing "list" must not match a read rule');
  assert.equal(policy.evaluateAction('test', 'x_api_request', { method: 'GET' }).tier, 'read');
  assert.equal(policy.evaluateAction('test', 'x_api_request', { method: 'DELETE' }).tier, 'commit');
  assert.equal(policy.evaluateAction('test', 'x_api_request', {}).tier, 'commit',
    'generic HTTP tools without an explicit safe method must fail closed');
  assert.equal(policy.evaluateAction('test', 'totally_unknown_mutation', {}).tier, 'commit',
    'unknown tools must fail closed');
  const unclassifiedRegisteredTools = getToolRegistry().list()
    .filter((tool) => tool.capabilities?.known !== true)
    .map((tool) => tool.name);
  assert.deepEqual(unclassifiedRegisteredTools, [],
    `registered core/bundled tools need explicit capabilities: ${unclassifiedRegisteredTools.join(', ')}`);

  assert.equal(shouldBypassGenericToolApproval('default', 'unknown_mutation', {}), false);
  assert.equal(shouldBypassGenericToolApproval('lite', 'unknown_mutation', {}), true);
  assert.equal(shouldBypassGenericToolApproval('lite', 'run_command', { elevated: true }), false,
    'Lite mode must never bypass administrator commands');
  assert.equal(shouldBypassGenericToolApproval('default', 'request_final_action_approval', {}), true,
    'explicit approval request tools must reach their own card-producing handlers');
  assert.equal(shouldBypassGenericToolApproval('lite', 'request_dev_source_edit', {}), true);

  const registry = getToolRegistry();
  let liteToolRuns = 0;
  registry.register({
    name: 'test_lite_external_write',
    description: 'Regression-only external write tool',
    schema: {},
    capabilities: {
      readOnly: false,
      localWrite: false,
      externalWrite: true,
      destructive: false,
      credentialUse: false,
      known: true,
    },
    execute: async () => {
      liteToolRuns += 1;
      return { success: true, stdout: 'executed' };
    },
  });
  const config = getConfig().getConfig();
  config.tools.permissions.shell.approval_mode = 'default';
  const defaultToolResult = await registry.execute('test_lite_external_write', {});
  assert.equal(defaultToolResult.success, false);
  assert.equal(defaultToolResult.data?._needsApproval, true);
  assert.equal(liteToolRuns, 0, 'Default mode must retain generic tool approval gates');

  config.tools.permissions.shell.approval_mode = 'lite';
  const liteToolResult = await registry.execute('test_lite_external_write', {});
  assert.equal(liteToolResult.success, true);
  assert.equal(liteToolRuns, 1, 'Lite mode must execute non-elevated tools without generic approval');
  const elevatedLiteResult = await registry.execute('test_lite_external_write', { elevated: true });
  assert.equal(elevatedLiteResult.success, false);
  assert.equal(elevatedLiteResult.data?._needsApproval, true);
  assert.equal(liteToolRuns, 1, 'Lite mode must not execute elevated tools before approval');
  config.tools.permissions.shell.approval_mode = 'default';

  const applyResult = await runWithWorkspace(scopedWorkspace, async () => {
    assert.equal(getActiveWorkspace(globalWorkspace), path.resolve(scopedWorkspace));
    return executeApplyPatch({ patch: targetPatch('scoped-before', 'scoped-after') });
  });
  assert.equal(applyResult.success, true, applyResult.error);
  assert.equal(readText(path.join(scopedWorkspace, 'target.txt')), 'scoped-after\n');
  assert.equal(readText(path.join(globalWorkspace, 'target.txt')), 'global-before\n',
    'scoped apply_patch must never modify the global workspace');

  const nestedWorkspace = path.join(globalWorkspace, 'nested-scope');
  fs.mkdirSync(nestedWorkspace, { recursive: true });
  fs.writeFileSync(path.join(nestedWorkspace, 'target.txt'), 'nested-before\n', 'utf8');
  const ancestorRepoResult = await runWithWorkspace(nestedWorkspace, () => executeApplyPatch({
    patch: targetPatch('nested-before', 'nested-after'),
  }));
  assert.equal(ancestorRepoResult.success, false);
  assert.match(String(ancestorRepoResult.error), /Git worktree root is outside the active workspace/);
  assert.equal(readText(path.join(nestedWorkspace, 'target.txt')), 'nested-before\n');

  const linkedDir = path.join(scopedWorkspace, 'escape-link');
  fs.symlinkSync(outsideWorkspace, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  const escapedTarget = path.join(linkedDir, 'secret.txt');
  assert.equal(isPathInWorkspace(scopedWorkspace, escapedTarget), false,
    'canonical containment must reject symlink/junction traversal');
  const escapedRead = await runWithWorkspace(scopedWorkspace, () => executeRead({
    path: path.join('escape-link', 'secret.txt'),
  }));
  assert.equal(escapedRead.success, false, 'file tools must reject symlink/junction traversal');
  assert.match(String(escapedRead.error), /outside|isolation|allowed/i);
  const escapedShell = await runWithWorkspace(scopedWorkspace, async () => validateShellRequest({
    command: 'node --version',
    cwd: linkedDir,
  }));
  assert.equal(escapedShell.ok, false, 'shell cwd must reject symlink/junction traversal');

  console.log('tool security boundaries: ok');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
