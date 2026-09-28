import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import githubExtension, { validateGitHubApiPath } from './runtime.js';
import { resolveToolCapabilityMetadata } from '../../../../gateway/tool-capabilities.js';

// Every registered GitHub tool must be in both manifest allowlists, otherwise
// the connection layer reports "not enabled for this connection".
const registeredTools = new Map<string, any>();
let connectorToolNames: string[] = [];
githubExtension.register({
  registerConnector: (c: any) => { connectorToolNames = c.toolNames; },
  registerTool: (tool: any) => registeredTools.set(tool.name, tool),
} as any);

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src', 'extensions', 'bundled', 'connectors', 'github', 'prometheus.extension.json'), 'utf8'));
const owned = new Set<string>(manifest.ownership.tools);
const strategyTools = new Set<string>(manifest.connection.strategies[0].config.registeredTools);

for (const name of registeredTools.keys()) {
  assert.ok(connectorToolNames.includes(name), `${name} missing from runtime toolNames`);
  assert.ok(owned.has(name), `${name} missing from manifest ownership.tools`);
  assert.ok(strategyTools.has(name), `${name} missing from manifest strategy registeredTools`);
}
for (const name of ['connector_github_close_pr', 'connector_github_update_pr', 'connector_github_update_issue', 'connector_github_comment', 'connector_github_api_request']) {
  assert.ok(registeredTools.has(name), `${name} must register`);
}

// Write tools declare external-write side effects so approval gates apply.
for (const name of ['connector_github_close_pr', 'connector_github_update_pr', 'connector_github_update_issue', 'connector_github_comment', 'connector_github_merge_pr']) {
  assert.equal(registeredTools.get(name).sideEffects?.externalWrite, true, `${name} must be an external write`);
}

// Raw API escape hatch: read-only only for GET/HEAD.
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, { method: 'GET' }).externalWrite, false);
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, { method: 'PATCH' }).externalWrite, true);
assert.equal(resolveToolCapabilityMetadata('connector_github_api_request', undefined, {}).externalWrite, true, 'missing method fails toward write');

// Path validation keeps requests on api.github.com.
assert.equal(validateGitHubApiPath('/repos/a/b/pulls/12'), null);
assert.equal(validateGitHubApiPath('/repos/a/b/issues?state=all&per_page=5'), null);
for (const bad of ['', 'repos/a/b', '//evil.com/x', 'https://evil.com/x', '/repos/../user', '/repos/a b', '/x\\y', '/a/./b']) {
  assert.ok(validateGitHubApiPath(bad), `path should be rejected: ${JSON.stringify(bad)}`);
}

console.log(`github connector regression: ${registeredTools.size} tools, manifests in sync, write gates + path validation OK`);
