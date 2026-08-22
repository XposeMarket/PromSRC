import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const sourceCreate = read('web-ui/src/bot-create.js');
const generatedCreate = read('generated/public-web-ui/static/bot-create.js');
const sourceBridge = read('web-ui/src/bot-create-settings-bridge.js');
const generatedBridge = read('generated/public-web-ui/static/bot-create-settings-bridge.js');
const sourcePerf = read('web-ui/src/performance.js');
const generatedPerf = read('generated/public-web-ui/static/performance.js');
const promptFile = read('src/agents/agent-prompt-file.ts');
const channelsRouter = read('src/gateway/routes/channels.router.ts');

assert.equal(sourceCreate, generatedCreate, 'bot-create.js source/generated mirror drifted');
assert.equal(sourceBridge, generatedBridge, 'bot-create-settings-bridge.js source/generated mirror drifted');
assert.equal(sourcePerf, generatedPerf, 'performance.js source/generated mirror drifted');

assert.match(sourcePerf, /if \(!window\.__PROM_SHOULD_BOOT_MOBILE\?\.\(\)\)/, 'Bot creation must stay outside the mobile/PWA runtime');
assert.match(sourcePerf, /import\('\.\/bot-create\.js'\)/, 'desktop shell must boot the Bot creator');
assert.match(sourcePerf, /import\('\.\/bot-create-settings-bridge\.js'\)/, 'desktop shell must unify the Settings creation entry point');

assert.match(sourceCreate, /What is this Bot for\?/, 'creation flow must expose the purpose question');
assert.match(sourceCreate, /## Purpose/, 'purpose must be written into AGENT.md');
assert.match(sourceCreate, /## Working Identity/, 'AGENT.md must contain a minimal working identity');
assert.match(sourceCreate, /api\('\/api\/agents'/, 'Bot creation must use the first-class agent resource route');
assert.match(sourceCreate, /\/agent-md`/, 'Bot creation must persist the identity through the canonical AGENT.md route');
assert.doesNotMatch(sourceCreate, /spawn_subagent|create_if_missing|\/spawn['"`]/, 'user Bot creation must not depend on the dynamic worker/spawn contract');
assert.doesNotMatch(sourceCreate, /api\([^\n]*(?:memory-md|heartbeat-md)/, 'Bot creation must not eagerly create memory or heartbeat files');
assert.match(sourceCreate, /does not become a tool allowlist, success criteria, timeout, or heartbeat policy/, 'UI must explain the identity/runtime-policy boundary');

assert.match(sourceBridge, /settings-agents-new-btn/, 'Settings + New must be routed to the shared Bot creator');
assert.match(sourceBridge, /removeAttribute\('onclick'\)/, 'legacy Settings creation handler must be removed before wiring the new creator');
assert.match(sourceBridge, /openBotCreateModal/, 'Settings must open the shared Bot creator');

assert.match(channelsRouter, /router\.post\('\/api\/agents',/, 'first-class POST /api/agents route must exist');
assert.match(channelsRouter, /ensureAgentWorkspace\(saved as any\)/, 'new agent resources must still receive their private identity workspace');

assert.match(promptFile, /normalizeAgentPromptBootstrap/, 'new AGENT.md bootstrap must normalize the historical mixed-policy scaffold');
assert.match(promptFile, /List tools this agent is allowed to use\./, 'normalizer must recognize the historical tool-policy scaffold');
assert.match(promptFile, /## Purpose/, 'bootstrap normalizer must preserve the agent description as Purpose');
assert.match(promptFile, /## Working Identity/, 'bootstrap normalizer must emit identity-only guidance');
assert.match(promptFile, /Explicit user[\s\S]*remain byte-for-byte untouched/, 'normalization must not rewrite existing/custom AGENT.md files');

console.log('Bot creation contract OK');
