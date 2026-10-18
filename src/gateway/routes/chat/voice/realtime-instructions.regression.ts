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
interface InstructionInput {
  contextBlock: string;
  contextPacket: Record<string, unknown>;
  conversationSummary?: string;
  conversationTranscript?: string;
}
const sandbox = {
  buildRealtimeVoiceAgentInstructions: (_input: InstructionInput): string => { throw new Error('builder not loaded'); },
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
// Oversized protected context must never kill the voice session (it used to throw).
const bigBlock = `[USER]\n${'user fact '.repeat(3000)}\n[/USER]\n[SOUL]\n${'soul line '.repeat(2000)}\n[/SOUL]\n[MEMORY_REFERENCE]\n${'memory atom '.repeat(1500)}\n[/MEMORY_REFERENCE]\n[ACTIVE_SKILLS]\nshort skills\n[/ACTIVE_SKILLS]`;
const compacted = sandbox.buildRealtimeVoiceAgentInstructions({ contextBlock: bigBlock, contextPacket: {}, conversationSummary: 'Kept continuity summary' });
assert.ok(compacted.length <= 36000, `oversized context fits the cap (${compacted.length})`);
for (const marker of ['[USER]', '[/USER]', '[SOUL]', '[/SOUL]', '[MEMORY_REFERENCE]', '[/MEMORY_REFERENCE]', 'short skills', 'Kept continuity summary', '## Current time', 'Personality:']) assert.ok(compacted.includes(marker), `oversized: preserves ${marker}`);
assert.ok(compacted.includes('[trimmed to fit the realtime voice budget]'), 'oversized blocks are visibly trimmed');
const unbracketed = sandbox.buildRealtimeVoiceAgentInstructions({ contextBlock: 'protected '.repeat(5000), contextPacket: {} });
assert.ok(unbracketed.length <= 36000 && unbracketed.includes('## Current time'), 'unbracketed oversized context is capped without throwing');
console.log('realtime instructions regression: context priority, cap, continuity and oversized-context compaction checks passed');
