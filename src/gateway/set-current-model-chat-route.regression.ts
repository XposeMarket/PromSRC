import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const f of ['src/gateway/agents-runtime/subagent-executor.ts','src/gateway/agents-runtime/capabilities/team-agent-executor.ts']) {
  const src = fs.readFileSync(f, 'utf8');
  const at = src.indexOf("'set_current_model'") >= 0 ? src.lastIndexOf('set_current_model') : -1;
  const block = src.slice(src.indexOf("set_current_model') {") >= 0 ? src.indexOf("set_current_model') {") : src.indexOf("case 'set_current_model'"));
  const body = block.slice(0, 2500);
  assert.ok(at >= 0, f + ': set_current_model handler missing');
  assert.match(body, /getChatModelRoute\(sessionId\)/, f + ': must check the per-chat route');
  assert.match(body, /setChatModelRoute\(sessionId/, f + ': must update the per-chat route');
  assert.match(body, /chat_route_updated/, f + ': must report chat_route_updated');
}
console.log('set-current-model chat route regression: ok');
