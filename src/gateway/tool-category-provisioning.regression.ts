import assert from 'node:assert/strict';
import { filterToolDefinitionsForWorkspaceMode } from '../runtime/workspace-tool-mode';
import { buildTools } from './tool-builder';
import {
  TOOL_CATEGORY_REPRESENTATIVE_TOOLS,
  verifyToolCategorySurface,
} from './tool-category-provisioning';

const deps = {
  getMCPManager: () => ({ getAllTools: () => [] }),
  skipDynamicExtensionTools: true,
};

const categories = [
  'browser_automation',
  'desktop_automation',
  'workspace_write',
  'agents_and_teams',
  'media_assets',
  'media_generation',
] as const;

const coreSurface = buildTools(deps, new Set());
const coreNames = new Set(coreSurface.map((tool: any) => tool?.function?.name));
assert.equal(coreNames.has('request_tool_category'), true, 'core surface must retain request_tool_category');

const reports = categories.map((category) => {
  const before = verifyToolCategorySurface(category, coreSurface, { unboundedTools: coreSurface });
  assert.equal(before.ok, false, category + ': category must not be provisioned on the core-only surface');

  const activatedSurface = buildTools(deps, new Set([category]));
  const provisioned = verifyToolCategorySurface(category, activatedSurface, {
    unboundedTools: activatedSurface,
  });
  assert.equal(
    provisioned.ok,
    true,
    category + ': activated surface did not contain representatives: ' + JSON.stringify(provisioned),
  );

  const expected = TOOL_CATEGORY_REPRESENTATIVE_TOOLS[category]?.[0];
  assert.ok(expected, category + ': representative tool mapping is required');
  const providerMissingOne = activatedSurface.filter((tool: any) => tool?.function?.name !== expected);
  const failed = verifyToolCategorySurface(category, providerMissingOne, {
    unboundedTools: activatedSurface,
  });
  assert.equal(failed.ok, false, category + ': missing provider tool must fail closed');

  // Model-facing same-turn transition: the activation card is emitted only
  // after the next provider surface contains a representative tool.
  let active = new Set<string>();
  let activationCardEmitted = false;
  const requestCategory = (surface: any[]): void => {
    active = new Set([category]);
    const verification = verifyToolCategorySurface(category, surface, {
      unboundedTools: activatedSurface,
    });
    if (!verification.ok) {
      active.delete(category);
      return;
    }
    activationCardEmitted = true;
  };
  requestCategory(providerMissingOne);
  assert.equal(active.has(category), false, category + ': failed request must roll back activation');
  assert.equal(activationCardEmitted, false, category + ': failed request must not emit an activation card');
  requestCategory(activatedSurface);
  assert.equal(active.has(category), true, category + ': successful request must retain activation');
  assert.equal(activationCardEmitted, true, category + ': successful request must emit activation evidence');

  return {
    category,
    coreToolCount: coreSurface.length,
    activatedToolCount: activatedSurface.length,
    representativeTools: provisioned.representativeTools,
    failureReason: failed.reason,
  };
});

// terminal-first is a supported workspace mode, not a failed provisioning
// state. It intentionally hides the native file wrappers while retaining the
// command runner used to start and inspect bounded processes.
const terminalFirstWorkspaceSurface = filterToolDefinitionsForWorkspaceMode(
  buildTools(deps, new Set(['workspace_write'])),
  'terminal-first',
);
const terminalFirstWorkspace = verifyToolCategorySurface('workspace_write', terminalFirstWorkspaceSurface, {
  unboundedTools: terminalFirstWorkspaceSurface,
  workspaceMode: 'terminal-first',
});
assert.equal(terminalFirstWorkspace.ok, true, 'terminal-first workspace mode should provision workspace_run');
assert.deepEqual(terminalFirstWorkspace.representativeTools, ['workspace_run']);
assert.equal(
  verifyToolCategorySurface('workspace_write', terminalFirstWorkspaceSurface, { unboundedTools: terminalFirstWorkspaceSurface }).ok,
  false,
  'native workspace mode must still require the full read/edit/run surface',
);

// A request-scoped allowlist is also an intentional surface profile. The
// terminal benchmark activates workspace_write but only asks the provider for
// request_tool_category + workspace_run; verification must validate that
// allowed category subset instead of requiring filtered-out file wrappers.
const requestFilteredTerminalSurface = buildTools(deps, new Set(['workspace_write']))
  .filter((tool: any) => ['request_tool_category', 'workspace_run'].includes(tool?.function?.name));
const requestFilteredTerminal = verifyToolCategorySurface('workspace_write', requestFilteredTerminalSurface, {
  unboundedTools: requestFilteredTerminalSurface,
  requestFilter: ['request_tool_category', 'workspace_run'],
  workspaceMode: 'prometheus',
});
assert.equal(requestFilteredTerminal.ok, true, 'request filter should allow a workspace_run-only category surface');
assert.deepEqual(requestFilteredTerminal.representativeTools, ['workspace_run']);
assert.equal(
  verifyToolCategorySurface('workspace_write', requestFilteredTerminalSurface, {
    unboundedTools: requestFilteredTerminalSurface,
    workspaceMode: 'prometheus',
  }).ok,
  false,
  'the same partial native surface must fail without an explicit request filter',
);

console.log(JSON.stringify({
  categories: reports,
  sameTurnSurfaceRefresh: true,
  activationCardAfterProvisioningOnly: true,
  terminalFirstWorkspaceMode: {
    representativeTools: terminalFirstWorkspace.representativeTools,
    provisioned: terminalFirstWorkspace.ok,
  },
  requestFilteredTerminal: {
    representativeTools: requestFilteredTerminal.representativeTools,
    provisioned: requestFilteredTerminal.ok,
  },
}, null, 2));
