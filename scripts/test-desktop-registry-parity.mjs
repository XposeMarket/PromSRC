/**
 * Desktop wrapper/handler parity.
 * Run after `npm run build:backend`:
 *   node scripts/test-desktop-registry-parity.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const importLocal = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const EXPECTED_WRAPPERS = new Set([
  'desktop_screen',
  'desktop_apps',
  'desktop_window',
  'desktop_input',
  'desktop_macro',
  'desktop_background',
]);
const REGISTRY_EXCEPTIONS = new Set(['desktop_send_to_telegram']);

let failed = false;
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`); };
const pass = (msg) => console.log(`PASS: ${msg}`);

const desktop = await importLocal('dist/gateway/desktop-tools.js');
const wrappers = await importLocal('dist/gateway/desktop-wrappers.js');
const registry = await importLocal('dist/tools/desktop.js');
const reactorRegistry = await importLocal('dist/tools/registry.js');
const toolBuilderSrc = readFileSync(path.join(repoRoot, 'src/gateway/tool-builder.ts'), 'utf8');
const execSrc = readFileSync(path.join(repoRoot, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');

const modelNames = new Set(desktop.getDesktopModelToolNames());
const modelNamesFromDefs = new Set(desktop.getDesktopModelToolDefinitions().map((d) => d.function?.name));
const internalNames = new Set(desktop.getDesktopInternalHandlerNames());
const registryInternalNames = new Set(registry.allDesktopTools.map((t) => t.name));
const registryWrapperNames = new Set(registry.desktopWrapperTools.map((t) => t.name));
const reactor = reactorRegistry.getToolRegistry();
const desktopProfileNames = new Set(reactor.listByProfile('desktop').map((tool) => tool.name).filter((name) => name.startsWith('desktop_')));
const fullProfileDesktopNames = new Set(reactor.listByProfile('full').map((tool) => tool.name).filter((name) => name.startsWith('desktop_')));

for (const name of EXPECTED_WRAPPERS) {
  if (!modelNames.has(name)) fail(`main model surface is missing wrapper ${name}`);
  if (!modelNamesFromDefs.has(name)) fail(`model definitions are missing wrapper ${name}`);
  if (!registryWrapperNames.has(name)) fail(`Reactor wrapper registry is missing ${name}`);
}
for (const name of modelNames) {
  if (!EXPECTED_WRAPPERS.has(name)) fail(`unexpected model-facing desktop tool ${name}`);
}
if (modelNames.size === EXPECTED_WRAPPERS.size && !failed) pass('main gateway and Reactor expose exactly six desktop wrappers');
for (const profileNames of [desktopProfileNames, fullProfileDesktopNames]) {
  for (const name of EXPECTED_WRAPPERS) if (!profileNames.has(name)) fail(`Reactor profile is missing ${name}`);
  for (const name of profileNames) if (!EXPECTED_WRAPPERS.has(name)) fail(`Reactor profile leaked granular tool ${name}`);
}
if (!failed) pass('Reactor desktop and full profiles hide every granular desktop handler');

const dispatchNames = new Set(
  [...execSrc.matchAll(/case '(desktop_[a-z0-9_]+)':/g)].map((match) => match[1]),
);
for (const name of internalNames) {
  if (!dispatchNames.has(name)) fail(`internal handler ${name} has no dispatch case`);
  if (!REGISTRY_EXCEPTIONS.has(name) && !registryInternalNames.has(name)) {
    fail(`internal handler ${name} is missing from the Reactor compatibility registry`);
  }
  if (!toolBuilderSrc.includes(`'${name}'`)) fail(`internal handler ${name} is not schema-hidden in tool-builder`);
}
for (const name of registryInternalNames) {
  if (!internalNames.has(name)) fail(`Reactor compatibility tool ${name} has no gateway handler definition`);
}

for (const [wrapperName, actions] of Object.entries(wrappers.DESKTOP_WRAPPER_ACTION_MAP)) {
  if (!EXPECTED_WRAPPERS.has(wrapperName)) fail(`action map contains unknown wrapper ${wrapperName}`);
  for (const [action, handler] of Object.entries(actions)) {
    if (!internalNames.has(handler)) fail(`${wrapperName} action ${action} maps to missing handler ${handler}`);
  }
}
if (!failed) pass(`${internalNames.size} compatibility handlers and all wrapper actions are registered and dispatchable`);

if (failed) {
  console.error('\nDesktop registry parity FAILED.');
  process.exit(1);
}
console.log('\nDesktop registry parity OK.');
