import assert from 'node:assert/strict';
import { buildTools } from './tool-builder';
import {
  preserveActivatedToolCategoriesForTurnOverride,
  TOOL_CATEGORY_REPRESENTATIVE_TOOLS,
  verifyToolCategorySurface,
} from './tool-category-provisioning';

const deps = {
  getMCPManager: () => ({ getAllTools: () => [] }),
  skipDynamicExtensionTools: true,
};

const activeCategories = new Set([
  'browser_automation',
  'desktop_automation',
  'workspace_write',
  'skills',
]);

const switchedCategories = preserveActivatedToolCategoriesForTurnOverride(activeCategories, false);
assert.deepEqual(
  [...switchedCategories].sort(),
  [...activeCategories].sort(),
  'a model switch must preserve categories activated by the current turn/session',
);

for (const category of activeCategories) {
  const surface = buildTools(deps, switchedCategories);
  const verification = verifyToolCategorySurface(category, surface, { unboundedTools: surface });
  assert.equal(
    verification.ok,
    true,
    `${category} must remain callable after switch-model surface rebuild: ${JSON.stringify(verification)}`,
  );
}

const browserVisionCategories = preserveActivatedToolCategoriesForTurnOverride(new Set(['skills']), true);
assert.equal(browserVisionCategories.has('skills'), true, 'existing categories must survive browser-vision override');
assert.equal(browserVisionCategories.has('browser_automation'), true, 'browser vision must add browser automation');
assert.equal(browserVisionCategories.has('browser'), true, 'browser alias must remain accepted by the builder');

assert.deepEqual(
  TOOL_CATEGORY_REPRESENTATIVE_TOOLS.skills,
  ['skill_ops'],
  'skills provisioning must verify the callable wrapper rather than an inner action name',
);

console.log('tool category switch-model regression passed');
