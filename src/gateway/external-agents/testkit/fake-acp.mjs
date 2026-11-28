import readline from 'node:readline';
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const result = (id, value) => send({ id, result: value });
let promptId; let sessionId = 'fixture-acp-session'; let mode = ''; let question = 900;
// --antigravity: answer like Google's `agy acp` 1.5.14 (v1 handshake, choices as config options, -32000 when signed out).
const antigravity = process.argv.includes('--antigravity'); const signedOut = process.argv.includes('--signed-out'); let agyModel = 'gemini-4-neon';
const choice = (value) => ({ value, name: value });
const agyOptions = () => [
  { id: 'model', name: 'Model', type: 'select', currentValue: agyModel, options: [{ group: 'google', name: 'Google', options: [{ value: 'gemini-4-neon', name: 'Gemini 4 Neon' }, { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }] }, { value: 'claude-fable-5-2', name: 'Claude Fable 5.2' }] },
  ...(agyModel === 'claude-fable-5-2' ? [] : [{ id: 'thinking', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: 'high', options: (agyModel === 'gemini-4-neon' ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'high']).map(choice) }]),
];
function update(text, id = sessionId) { send({ method: 'session/update', params: { sessionId: id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } }); }
function finish() { update('Hello ACP'); result(promptId, { stopReason: 'end_turn' }); }
readline.createInterface({ input: process.stdin }).on('line', (line) => {
 const m = JSON.parse(line);
 if (antigravity && m.method === 'initialize') return result(m.id, { protocolVersion: 1, agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14' }, agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} }, auth: { logout: {} } }, authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }] });
 if (antigravity && m.method === 'session/new') return signedOut ? send({ id: m.id, error: { code: -32000, message: 'Authentication required' } }) : result(m.id, { sessionId, configOptions: agyOptions() });
 if (m.method === 'session/set_config_option') { if (m.params.configId === 'model') agyModel = m.params.value; return result(m.id, { configOptions: agyOptions() }); }
 if (m.method === 'session/close') return result(m.id, {});
 if (m.method === 'initialize') return result(m.id, { protocolVersion: 1, agentInfo: { name: 'cursor', version: 'fixture' }, agentCapabilities: { loadSession: true } });
 const models = { currentModelId: 'fixture-a', availableModels: [{ modelId: 'fixture-a', name: 'Fixture A' }, { modelId: 'fixture-b', name: 'Fixture B' }] };
 if (m.method === 'session/new') return result(m.id, { sessionId, models });
 if (m.method === 'session/set_model') return result(m.id, {});
 if (m.method === 'session/load') {
   if (m.params.sessionId === 'missing') return send({ id: m.id, error: { code: -32000, message: 'Session not found' } });
   sessionId = m.params.sessionId; update('OLD REPLAY'); return result(m.id, { models });
 }
 if (m.method === 'session/prompt') {
   promptId = m.id; mode = m.params.prompt[0].text; update('WRONG SESSION', 'other-session');
   if (mode === 'CRASH') return process.exit(1);
   if (mode === 'WAIT') return;
   if (mode === 'QUESTION') return send({ id: question, method: 'cursor/ask_question', params: { questions: [{ id: 'q', prompt: 'Choose', options: [{ id: 'a', label: 'A' }] }] } });
   if (mode === 'PLAN') return send({ id: question, method: 'cursor/create_plan', params: { name: 'Plan', plan: 'Do the thing' } });
   if (mode === 'PERMISSION' || mode === 'PENDING_END') {
     send({ id: question, method: 'session/request_permission', params: { sessionId, toolCall: { title: 'Run test', rawInput: { command: 'npm test' } }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'always', kind: 'allow_always', name: 'Allow always' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }] } });
     if (mode === 'PENDING_END') setTimeout(finish, 30); return;
   }
   return finish();
 }
 if (m.method === 'session/cancel') return result(promptId, { stopReason: 'cancelled' });
 if (m.id === question) { update(JSON.stringify(m.result)); finish(); }
});
