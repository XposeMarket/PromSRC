import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const picker = fs.readFileSync(path.join(root, 'web-ui/src/components/agent-voice-picker.js'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'web-ui/src/mobile/mobile-pages.js'), 'utf8');
const chatRouter = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');

assert.match(
  picker,
  /const CODEX_PROVIDER = 'openai_codex';/,
  'subagent profiles need a distinct Codex Voice/Live provider identity',
);
assert.match(
  picker,
  /status\?\.codexBridgeAvailable === true[\s\S]*?status\?\.transport === 'codex_app_server'[\s\S]*?status\?\.auth === 'chatgpt_oauth_app_server'/,
  'the picker must identify the working ChatGPT OAuth app-server transport',
);
assert.match(
  picker,
  /Codex Voice \/ Live · ChatGPT OAuth/,
  'the subagent editor must name the actual OAuth voice route',
);
assert.match(
  picker,
  /const CODEX_VOICES = \['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'\]/,
  'the picker must expose AVAS v3 voices rather than public Realtime voices',
);
assert.match(
  picker,
  /savedProvider === 'openai_realtime'[\s\S]*?\? CODEX_PROVIDER/,
  'legacy OpenAI Realtime profiles must present as Codex Voice/Live when the bridge is active',
);
assert.match(
  picker,
  /provider === CODEX_PROVIDER \? \[\] : \[current\]/,
  'legacy public voices must not leak into the Codex voice list',
);
assert.match(
  picker,
  /mode: providerEl\.value === CODEX_PROVIDER \? 'codex_voice_live' : ''/,
  'saved Codex profiles must retain an explicit transport mode',
);

assert.match(
  mobile,
  /provider === 'openai_codex' \|\| provider === 'openai_realtime'/,
  'mobile subagent voice settings must map Codex profiles to the proven live voice engine',
);
assert.match(
  mobile,
  /targetRequiresCodexOauthBridge[\s\S]*?targetVoiceProfile\?\.provider[\s\S]*?=== 'openai_codex'[\s\S]*?requiresCodexOauthBridge = targetRequiresCodexOauthBridge/,
  'an explicit Codex subagent profile must forbid fallback to public Realtime',
);

assert.match(
  chatRouter,
  /const ownerAgentId = ownerTarget\.kind === 'subagent'[\s\S]*?const agentId = String\(args\?\.agent_id \|\| args\?\.agentId \|\| ownerAgentId\)/,
  'subagent Voice/Live agent_control must default to its own matching worker',
);
assert.match(
  chatRouter,
  /source: ownerAgentId === agentId \? 'subagent_voice_worker_chat'[\s\S]*?resumedVoiceTarget:[\s\S]*?voiceContinuation:/,
  'a matching worker reply must return to the same subagent Voice/Live function call',
);
assert.match(
  chatRouter,
  /voice_ops agent_control is your worker path[\s\S]*?agent_action chat[\s\S]*?returns it to this same/,
  'subagent voice instructions must use synchronous own-worker chat for substantive work',
);
assert.match(
  chatRouter,
  /!identity\.isSubagent \|\| String\(tool\?\.function\?\.name[\s\S]*?!== 'voice_thread_ops'/,
  'subagent Voice/Live must not receive Prometheus-only thread operations',
);
assert.match(
  chatRouter,
  /For your existing worker run, use voice_ops agent_control run_status, run_message, run_resume, run_pause, run_rerun, or run_cancel/,
  'subagent voice must retain status and run-control parity for its worker',
);
assert.match(
  mobile,
  /functionCallConnections: new Map\(\)[\s\S]*?connections\.set\(callId, __pmRealtimeAgent\?\.conn \|\| null\)/,
  'mobile must bind each asynchronous tool call to the exact room participant connection that issued it',
);
assert.match(
  mobile,
  /connections\?\.get\(String\(callId\)\) \|\| __pmRealtimeAgent\.conn/,
  'worker results must return to the issuing subagent AVAS session instead of whichever room participant is active later',
);

console.log('subagent Codex Voice/Live contract passed');
