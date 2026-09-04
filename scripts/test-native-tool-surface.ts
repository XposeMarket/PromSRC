import assert from 'node:assert/strict';
import { getToolRegistry, type ToolProfile } from '../src/tools/registry.js';
import { capabilityPolicyTier, resolveToolCapabilityMetadata } from '../src/gateway/tool-capabilities.js';
import { ensurePrometheusExtensionRuntimeLoaded } from '../src/extensions/legacy-connector-adapter.js';
import { getExtensionRuntimeRegistry } from '../src/extensions/runtime-registry.js';

const profiles: ToolProfile[] = ['minimal', 'coding', 'web', 'full', 'desktop'];

ensurePrometheusExtensionRuntimeLoaded();
const registry = getToolRegistry();
const tools = registry.list();
const names = tools.map((tool) => tool.name);

assert.ok(tools.length > 0, 'the native tool registry must not be empty');
assert.equal(new Set(names).size, names.length, 'registered tool names must be unique');

for (const tool of tools) {
  assert.match(tool.name, /^[^\s]+$/, `tool name must be non-empty: ${tool.name}`);
  assert.equal(typeof tool.description, 'string', `description must be a string: ${tool.name}`);
  assert.equal(typeof tool.execute, 'function', `execute must be callable: ${tool.name}`);
  assert.equal(typeof tool.schema, 'object', `schema must be an object: ${tool.name}`);
  const capabilities = resolveToolCapabilityMetadata(tool.name, tool.capabilities);
  assert.ok(['read', 'propose', 'commit'].includes(capabilityPolicyTier(capabilities)));
}

const extensionNames = getExtensionRuntimeRegistry().listTools().map((tool) => tool.name);
for (const extensionName of extensionNames) {
  assert.ok(names.includes(extensionName), `extension tool is missing from ToolRegistry: ${extensionName}`);
}

for (const profile of profiles) {
  const definitions = registry.getToolDefinitionsForChat(profile);
  const definitionNames = definitions.map((definition: any) => String(definition?.function?.name || ''));
  assert.equal(new Set(definitionNames).size, definitionNames.length, `duplicate provider names in ${profile}`);
  for (const definition of definitions) {
    assert.equal(definition?.type, 'function', `provider definition type missing in ${profile}`);
    assert.match(String(definition?.function?.name || ''), /^[^\s]+$/, `provider name missing in ${profile}`);
    assert.equal(typeof definition?.function?.description, 'string', `provider description missing in ${profile}`);
    assert.equal(typeof definition?.function?.parameters, 'object', `provider parameters missing in ${profile}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  registeredToolCount: tools.length,
  extensionToolCount: extensionNames.length,
  profiles: Object.fromEntries(profiles.map((profile) => [profile, registry.getToolDefinitionsForChat(profile).length])),
}));
