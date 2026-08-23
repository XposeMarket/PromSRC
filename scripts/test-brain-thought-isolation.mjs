import fs from 'node:fs';
import assert from 'node:assert/strict';

const runner = fs.readFileSync('src/gateway/brain/brain-runner.ts', 'utf8');
const toolBuilder = fs.readFileSync('src/gateway/tool-builder.ts', 'utf8');
const chatHelpers = fs.readFileSync('src/gateway/chat/chat-helpers.ts', 'utf8');
const chatFiles = [];
for (const path of ['src/gateway/routes/chat.router.ts', 'src/gateway/server-v2.ts']) {
  if (fs.existsSync(path)) chatFiles.push(fs.readFileSync(path, 'utf8'));
}
for (const dirent of fs.readdirSync('src/gateway/chat', { withFileTypes: true })) {
  if (!dirent.isFile() || !dirent.name.endsWith('.ts')) continue;
  chatFiles.push(fs.readFileSync(`src/gateway/chat/${dirent.name}`, 'utf8'));
}
const chatRuntime = chatFiles.find((text) => text.includes('brain_thought_isolated_profile')) || '';
const livePrompt = runner.slice(runner.indexOf('private _buildThoughtPromptV2'), runner.indexOf('private _buildDreamCleanupPromptV2'));
assert(!livePrompt.includes('You are Prometheus'));
assert(!livePrompt.includes("You have the user's USER.md"));
assert(!livePrompt.includes('JSON.stringify(activityPackage'));
assert(livePrompt.includes('buildBrainThoughtActivityIndex'));
assert(livePrompt.includes('Browser observations in the Activity Package are evidence'));
assert(runner.includes("'brain_context_search'"));
assert(runner.includes("'brain_activity_read'"));
assert(runner.includes("'brain_thought_submit'"));
assert(runner.includes('{ brainThoughtRuntime: true }'));
assert(runner.includes('submissionSucceeded && fileLooksFresh && capsuleArtifactValid && !runFailed'));
assert(!livePrompt.includes('workspace_edit'));
assert(chatRuntime.includes('You are Thought, an internal supervisory cognition process inside Prometheus.'));
assert(chatRuntime.includes("reason: 'brain_thought_isolated_profile'"));
assert(toolBuilder.includes('includeBrainThoughtTools'));
assert(toolBuilder.includes("`brainThought:${includeBrainThoughtTools ? '1' : '0'}`"));
assert(toolBuilder.includes('...(includeBrainThoughtTools ? getBrainThoughtToolDefinitions() : [])'));
assert(chatHelpers.includes('isBrainThoughtRunActive(sessionId)'));
console.log('brain-thought isolation contract: ok');
