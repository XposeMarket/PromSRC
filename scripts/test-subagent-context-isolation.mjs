import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const promptContext = fs.readFileSync(path.join(root, 'src', 'gateway', 'prompt-context.ts'), 'utf-8');
const chatRouter = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'chat.router.ts'), 'utf-8');
const channelsRouter = fs.readFileSync(path.join(root, 'src', 'gateway', 'routes', 'channels.router.ts'), 'utf-8');
const reactor = fs.readFileSync(path.join(root, 'src', 'agents', 'reactor.ts'), 'utf-8');

function branch(startMarker, endMarker) {
  const start = promptContext.indexOf(startMarker);
  const end = promptContext.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Could not locate ${startMarker}`);
  return promptContext.slice(start, end);
}

const forbiddenInjectedLabels = [
  '`[USER]\\n${',
  '`[MEMORY]\\n${',
  '`[BUSINESS]\\n${',
  '`[TODAY_NOTES',
  '`[PROJECT_CONTEXT]\\n${',
  'retrievedMemoryCtx,',
  'cisContext,',
];

for (const [name, source] of [
  ['direct_subagent', branch("if (isDirectSubagentProfile || isScheduledAgentActor || isHeartbeatAgentActor || isInteractiveAgentSwitch) {", '// ── Path SUB:')],
  ['background_agent', branch("if (executionMode === 'background_agent') {", "if (executionMode === 'team_subagent') {")],
  ['team_subagent', branch("if (executionMode === 'team_subagent') {", '// ── Path B:')],
]) {
  for (const token of forbiddenInjectedLabels) {
    assert.ok(!source.includes(token), `${name} still injects forbidden main context token: ${token}`);
  }
  assert.ok(source.includes('[PROMETHEUS_RUNTIME_CONTRACT]'), `${name} must inject the shared Prometheus runtime contract`);
  assert.ok(source.includes('agentIdentityMemory'), `${name} must inject the shared identity/memory contract`);
  assert.ok(source.includes('buildToolsContext'), `${name} must retain runtime tool policy context`);
  assert.ok(source.includes('skillTurnContext()'), `${name} must retain the canonical resolved skill context`);
}

assert.ok(promptContext.includes('skillsManager.buildTurnContext(messageText, skillContextOptions)'), 'subagent paths must use the canonical deterministic skill resolver');

assert.ok(
  chatRouter.includes("{ profile: targetAgentId ? 'direct_subagent' : 'voice_agent' }"),
  'Subagent voice must use the isolated direct-subagent context profile',
);
assert.match(
  chatRouter,
  /function loadVoiceAgentMemoryForTarget[\s\S]*?if \(resolved\) return '';/,
  'Subagent voice must not inherit main or voice-agent memory',
);
assert.ok(
  chatRouter.includes("if (toolName === 'skill_read') return content;"),
  'skill_read results must bypass generic tool-result clipping so the complete SKILL.md reaches the next reasoning round',
);
assert.ok(promptContext.includes('buildSubagentIdentityMemoryContext'), 'gateway subagent paths must use the canonical identity/memory helper');
assert.ok(reactor.includes('buildSubagentIdentityMemoryContext'), 'Reactor subagent paths must use the canonical identity/memory helper');
assert.ok(channelsRouter.includes("/api/agents/:id/memory-md"), 'per-agent memory API must be registered');
assert.match(
  promptContext,
  /profile === 'switch_model' && runtimeActor\?\.kind !== 'agent' && runtimeActor\?\.kind !== 'manager'/,
  'switch_model must not reload main Prometheus memory for a named agent or manager',
);
const voiceScoutSource = chatRouter.slice(
  chatRouter.indexOf('async function runVoiceAutomationSkillScout('),
  chatRouter.indexOf('function extractFirstVoiceUrl(', chatRouter.indexOf('async function runVoiceAutomationSkillScout(')),
);
assert.ok(!voiceScoutSource.includes("executeVoiceAgentToolWithTrace(sessionId, 'skill_read'"), 'voice automation scout must not auto-read the first lexical match');

const helperUrl = pathToFileURL(path.join(root, 'dist', 'agents', 'agent-prompt-file.js')).href;
const { readAgentPromptFile, writeAgentPromptFile } = await import(helperUrl);
const contextHelperUrl = pathToFileURL(path.join(root, 'dist', 'agents', 'subagent-prompt-context.js')).href;
const { buildSubagentIdentityMemoryContext } = await import(contextHelperUrl);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-agent-md-'));
try {
  fs.writeFileSync(path.join(tempRoot, 'system_prompt.md'), 'legacy identity', 'utf-8');
  const migrated = readAgentPromptFile(tempRoot, { migrateLegacy: true });
  assert.equal(migrated?.content, 'legacy identity');
  assert.equal(path.basename(migrated?.path || ''), 'AGENT.md');
  assert.equal(fs.readFileSync(path.join(tempRoot, 'system_prompt.md'), 'utf-8'), 'legacy identity');
  assert.equal(fs.readFileSync(path.join(tempRoot, 'AGENT.md'), 'utf-8'), 'legacy identity');

  writeAgentPromptFile(tempRoot, 'canonical identity');
  assert.equal(readAgentPromptFile(tempRoot)?.content, 'canonical identity');
  fs.writeFileSync(path.join(tempRoot, 'MEMORY.md'), 'private agent memory', 'utf-8');
  const agentContext = buildSubagentIdentityMemoryContext({ identityRoot: tempRoot, memoryRoot: tempRoot });
  assert.equal((agentContext.match(/\[AGENT_IDENTITY - PRIVATE TO THIS AGENT\]/g) || []).length, 1, 'identity delimiter must occur once');
  assert.equal((agentContext.match(/\[AGENT_MEMORY - PRIVATE TO THIS AGENT\]/g) || []).length, 1, 'memory delimiter must occur once');
  assert.ok(agentContext.indexOf('[AGENT_IDENTITY - PRIVATE TO THIS AGENT]') < agentContext.indexOf('[AGENT_MEMORY - PRIVATE TO THIS AGENT]'), 'AGENT.md must precede MEMORY.md');
  assert.ok(agentContext.includes('canonical identity'));
  assert.ok(agentContext.includes('private agent memory'));

  const heartbeatOnly = path.join(tempRoot, 'heartbeat-only');
  fs.mkdirSync(heartbeatOnly);
  fs.writeFileSync(path.join(heartbeatOnly, 'HEARTBEAT.md'), 'schedule instructions', 'utf-8');
  assert.equal(readAgentPromptFile(heartbeatOnly), null, 'HEARTBEAT.md must not become agent identity');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Subagent context isolation and AGENT.md migration checks passed.');
