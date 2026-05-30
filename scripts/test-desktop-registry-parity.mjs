/**
 * test-desktop-registry-parity.mjs
 *
 * Ensures the three desktop-tool surfaces stay in sync:
 *   1. getDesktopToolDefinitions()  — gateway/model-facing schemas
 *   2. allDesktopTools              — ToolRegistry wrappers (Reactor/background)
 *   3. the chat/subagent dispatch switch in subagent-executor.ts
 *
 * If a tool is advertised to the model but not dispatched, or wrapped in one
 * surface but missing from another, this test fails loudly.
 *
 * Run after `npm run build:backend`:
 *   node scripts/test-desktop-registry-parity.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const importLocal = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

// Tools intentionally NOT mirrored into the ToolRegistry (need live gateway deps).
const REGISTRY_EXCEPTIONS = new Set(['desktop_send_to_telegram']);

let failed = false;
const fail = (msg) => { failed = true; console.error('FAIL: ' + msg); };
const pass = (msg) => console.log('PASS: ' + msg);

const { getDesktopToolNames, getDesktopToolDefinitions } = await importLocal('dist/gateway/desktop-tools.js');
const { allDesktopTools } = await importLocal('dist/tools/desktop.js');

const defNames = new Set(getDesktopToolNames());
const defNamesFromDefs = new Set(getDesktopToolDefinitions().map((d) => d.function?.name));
const registryNames = new Set(allDesktopTools.map((t) => t.name));

// getDesktopToolNames() must equal the names inside getDesktopToolDefinitions().
for (const n of defNamesFromDefs) {
  if (!defNames.has(n)) fail(`getDesktopToolNames() is missing "${n}" present in definitions`);
}
if (!failed) pass(`getDesktopToolNames() matches getDesktopToolDefinitions() (${defNames.size} tools)`);

// Parse the dispatch switch for `case 'desktop_*':` labels.
const execSrc = readFileSync(path.join(repoRoot, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
const dispatchNames = new Set(
  [...execSrc.matchAll(/case '(desktop_[a-z0-9_]+)':/g)].map((m) => m[1]),
);

// Every advertised tool must be dispatched (except desktop_task which is a removed stub still handled).
for (const n of defNames) {
  if (!dispatchNames.has(n)) fail(`tool "${n}" is advertised by getDesktopToolDefinitions() but has no dispatch case in subagent-executor.ts`);
}
if (!failed) pass(`all ${defNames.size} advertised tools have a dispatch case`);

// Every advertised tool must have a ToolRegistry wrapper (except known exceptions).
for (const n of defNames) {
  if (REGISTRY_EXCEPTIONS.has(n)) continue;
  if (!registryNames.has(n)) fail(`tool "${n}" is advertised but missing from allDesktopTools (src/tools/desktop.ts)`);
}
// And no registry wrapper should reference a tool that doesn't exist in defs.
for (const n of registryNames) {
  if (!defNames.has(n)) fail(`allDesktopTools exposes "${n}" which is not in getDesktopToolDefinitions()`);
}
if (!failed) pass(`ToolRegistry wrappers are in parity with definitions (${registryNames.size} wrappers, ${REGISTRY_EXCEPTIONS.size} known exception)`);

if (failed) {
  console.error('\nDesktop registry parity FAILED.');
  process.exit(1);
}
console.log('\nDesktop registry parity OK.');
