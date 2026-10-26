import assert from 'node:assert/strict';
import { buildTools } from './tool-builder';
import { autoActivateToolCategories } from './tool-category-auto-activation';

for (const message of ['hello', 'edit the file and run a test in the browser', 'slack gmail connector schedule automation']) {
  const marks: string[] = [];
  assert.deepEqual(autoActivateToolCategories('isolated-test', message, 8, label => marks.push(label)), []);
  assert.deepEqual(marks, ['pre_context.toolcats.hint_only']);
}

const deps = { getMCPManager: () => ({ getAllTools: () => [] }), skipDynamicExtensionTools: true };
const surface = (categories: string[]) => buildTools(deps, new Set(categories));
const names = (tools: any[]) => tools.map(tool => tool.function.name);
const core = surface([]);
const workspace = surface(['workspace_write']);
assert.deepEqual(workspace.slice(0, core.length), core, 'activating workspace must preserve every core schema at the front');
const workspaceBrowser = surface(['workspace_write', 'browser_automation']);
assert.deepEqual(workspaceBrowser.slice(0, workspace.length), workspace, 'new browser category must append, not insert before workspace');
const browser = surface(['browser_automation']);
const browserWorkspace = surface(['browser_automation', 'workspace_write']);
assert.deepEqual(browserWorkspace.slice(0, browser.length), browser, 'ordered cache entries must not conflate category activation order');
assert.deepEqual(new Set(names(workspaceBrowser)), new Set(names(browserWorkspace)), 'activation order changes position, not capabilities');
assert.deepEqual(surface(['file_ops']), workspace, 'category aliases retain canonical ordering');
assert.equal(new Set(names(workspaceBrowser)).size, workspaceBrowser.length, 'no duplicate tools');
assert.ok(names(core).includes('request_tool_category'));
assert.ok(!names(core).includes('workspace_edit'));
assert.ok(names(workspace).includes('workspace_edit'));
assert.deepEqual(surface([]), core, 'expiry/removal returns exactly core, with no session leakage');
console.log(JSON.stringify({ coreTools: core.length, workspaceTools: workspace.length, workspaceBrowserTools: workspaceBrowser.length, coreSchemaChars: JSON.stringify(core).length, expandedSchemaChars: JSON.stringify(workspaceBrowser).length }));
console.log('stable tool surface regression: PASS');
