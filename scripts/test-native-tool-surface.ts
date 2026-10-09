import assert from 'node:assert/strict';
import { ALL_TOOL_CATEGORIES, buildTools } from '../src/gateway/tool-builder.js';
import { capabilityPolicyTier, resolveToolCapabilityMetadata } from '../src/gateway/tool-capabilities.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../src/extensions/extension-bootstrap.js';

// Validates the live model-facing tool surface built by tool-builder.buildTools
// (the one main chat, subagents, teams and automations all use). The retired
// src/tools/registry.ts profiles no longer exist.
ensurePrometheusExtensionRuntimeLoaded();
const deps = { getMCPManager: () => ({ getAllTools: () => [] }) } as any;
const surfaces: Record<string, any[]> = {
  core: buildTools(deps, new Set()),
  all: buildTools(deps, new Set(ALL_TOOL_CATEGORIES as readonly string[])),
};
for (const category of ALL_TOOL_CATEGORIES) {
  surfaces[`category:${category}`] = buildTools(deps, new Set([category]));
}

assert.ok(surfaces.core.length > 0, 'the core tool surface must not be empty');
assert.ok(surfaces.all.length > surfaces.core.length, 'categories must add tools beyond core');

for (const [label, definitions] of Object.entries(surfaces)) {
  const names = definitions.map((definition: any) => String(definition?.function?.name || ''));
  assert.equal(new Set(names).size, names.length, `duplicate provider names in ${label}`);
  for (const definition of definitions) {
    const name = String(definition?.function?.name || '');
    assert.equal(definition?.type, 'function', `provider definition type missing in ${label}`);
    assert.match(name, /^[^\s]+$/, `provider name missing in ${label}`);
    assert.equal(typeof definition?.function?.description, 'string', `description missing: ${name}`);
    assert.equal(typeof definition?.function?.parameters, 'object', `parameters missing: ${name}`);
    const tier = capabilityPolicyTier(resolveToolCapabilityMetadata(name));
    assert.ok(['read', 'propose', 'commit'].includes(tier), `bad policy tier for ${name}: ${tier}`);
  }
}

const coreNames = new Set(surfaces.core.map((definition: any) => definition.function.name));
for (const [label, definitions] of Object.entries(surfaces)) {
  for (const name of coreNames) {
    assert.ok(definitions.some((definition: any) => definition.function.name === name), `${label} dropped core tool ${name}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  coreToolCount: surfaces.core.length,
  allToolCount: surfaces.all.length,
  categories: ALL_TOOL_CATEGORIES.length,
}));
