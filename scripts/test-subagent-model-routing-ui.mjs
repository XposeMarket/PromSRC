import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const picker = fs.readFileSync(path.join(root, 'web-ui/src/components/agent-model-picker.js'), 'utf8');
const modelRouting = fs.readFileSync(path.join(root, 'src/agents/model-routing.ts'), 'utf8');
const spawner = fs.readFileSync(path.join(root, 'src/agents/spawner.ts'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-manager.ts'), 'utf8');

assert.match(picker, /id=\"\$\{prefix\}-provider-/);
assert.match(picker, /id=\"\$\{prefix\}-modelselect-/);
assert.doesNotMatch(picker, /modelcustom|custom model id|type=\"text\"/i, 'subagent model controls must be dropdown-only');
assert.match(picker, /body: JSON\.stringify\(\{ model: fullModel \}\)/, 'model save must serialize the selected route');
assert.match(picker, /body: JSON\.stringify\(\{ model: '' \}\)/, 'clear must serialize an empty model override');
assert.match(picker, /body: JSON\.stringify\(\{ reasoning_effort: reasoningEffort \}\)/, 'reasoning save must serialize the per-agent override');
assert.match(picker, /Use provider default/, 'reasoning selector must expose clear-to-inherit');
assert.match(picker, /Reasoning cleared \(using Settings default\)/, 'reasoning clear must be visible');

assert.match(modelRouting, /agent_model_defaults\.main_chat/, 'global Settings main-chat mirror must be a routing fallback');
assert.match(modelRouting, /resolveConfiguredAgentRouting/, 'model routing must expose complete route resolution');
assert.match(spawner, /fallbackToPrimary: true/, 'manual spawn must resolve the configured primary route');
assert.match(spawner, /No model is configured for subagent/, 'no-model spawn failure must be actionable');
assert.match(manager, /executorReasoningEffort: executorRouting\.reasoningEffort/, 'created subagent tasks must preserve inherited reasoning');

console.log('PASS: dropdown-only subagent UI, clear serialization, inherited routing, and actionable spawn contracts');
