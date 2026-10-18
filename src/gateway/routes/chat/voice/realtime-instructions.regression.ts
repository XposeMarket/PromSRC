import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Evaluate the actual pure builders without booting the gateway/auth/tool runtime.
const source = fs.readFileSync(path.join(process.cwd(), 'src/gateway/routes/chat/voice/realtime.ts'), 'utf8');
const ast = ts.createSourceFile('realtime.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['budgetRealtimeInstructions', 'buildRealtimeVoiceAgentInstructions']);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map((node) => node.getText(ast).replace(/^export /, '')).join('\n');
const sandbox: any = {
  REALTIME_AGENT_INSTRUCTIONS_MAX: 36000,
  buildVoiceTimeContext: () => ({ source: 'test' }),
  voiceAgentTargetIdentity: () => ({ isSubagent: false, label: 'Prometheus' }),
  compactVoiceText: (text: string, max: number) => String(text).slice(0, max),
};
vm.createContext(sandbox);
vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, sandbox);
const contextBlock = `[USER]\n${'user profile '.repeat(900)}\n[/USER]\n[SOUL]\n${'soul profile '.repeat(900)}\n[/SOUL]\n[VOICE_SOUL]\nVoice identity\n[/VOICE_SOUL]\n[MEMORY_REFERENCE]\nRemembered preference\n[/MEMORY_REFERENCE]\n[ACTIVE_SKILLS]\nRelevant workflows`;
const output = sandbox.buildRealtimeVoiceAgentInstructions({
  contextBlock,
  contextPacket: { huge: 'packet '.repeat(20000) },
  conversationSummary: 'Protected continuity summary',
  conversationTranscript: 'transcript '.repeat(1200),
});
assert.ok(output.length <= 36000);
for (const marker of ['[USER]', '[/USER]', '[SOUL]', '[/SOUL]', '[VOICE_SOUL]', '[MEMORY_REFERENCE]', '[ACTIVE_SKILLS]', 'Protected continuity summary']) assert.ok(output.includes(marker), `preserves ${marker}`);
assert.ok(output.indexOf('[USER]') < output.indexOf('## This conversation so far'));
assert.ok(!output.includes('packet '.repeat(1000)), 'packet JSON is trimmed first');
assert.throws(() => sandbox.buildRealtimeVoiceAgentInstructions({ contextBlock: 'protected '.repeat(5000), contextPacket: {} }), /personal context and continuity exceed/, 'never silently tail-truncate protected context');
console.log('realtime instructions regression: context priority, cap, continuity and oversized-context checks passed');
