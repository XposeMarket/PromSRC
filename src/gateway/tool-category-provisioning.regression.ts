import assert from 'node:assert/strict';
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

console.log(JSON.stringify({
  categories: reports,
  sameTurnSurfaceRefresh: true,
  activationCardAfterProvisioningOnly: true,
}, null, 2));
