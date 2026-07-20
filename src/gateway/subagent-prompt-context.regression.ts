import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAgentPromptFile } from '../agents/agent-prompt-file';
import { buildPersonalityContext } from './prompt-context';
import { clearRuntimeActorContext, setRuntimeActorContext } from './runtime-actor';

async function assembledPrompt(sessionId: string, workspacePath: string, executionMode: string, profile?: 'direct_subagent'): Promise<string> {
  return buildPersonalityContext(
    sessionId,
    workspacePath,
    'Check the current assignment.',
    executionMode,
    1,
    { buildTurnContext: () => '', getSkill: () => null } as any,
    () => new Map(),
    () => {},
    new Set(),
    profile ? { profile } : undefined,
  );
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-subagent-prompt-'));
  const agentRoot = path.join(root, 'agent');
  fs.mkdirSync(agentRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'USER.md'), 'ROOT_USER_MUST_NOT_APPEAR');
  fs.writeFileSync(path.join(root, 'SOUL.md'), 'ROOT_SOUL_MUST_NOT_APPEAR');
  fs.writeFileSync(path.join(root, 'MEMORY.md'), 'ROOT_MEMORY_MUST_NOT_APPEAR');
  writeAgentPromptFile(agentRoot, 'AGENT_IDENTITY_FIXTURE');
  fs.writeFileSync(path.join(agentRoot, 'MEMORY.md'), 'AGENT_MEMORY_FIXTURE');

  try {
    for (const [sessionId, executionMode, profile] of [
      ['prompt_direct_agent', 'interactive', 'direct_subagent'],
      ['prompt_heartbeat_agent', 'heartbeat', undefined],
    ] as const) {
      setRuntimeActorContext(sessionId, {
        kind: 'agent',
        surface: executionMode === 'heartbeat' ? 'heartbeat' : 'direct_chat',
        agentId: 'fixture-agent',
        identityRoot: agentRoot,
        memoryRoot: agentRoot,
        executionRoot: root,
      });
      const prompt = await assembledPrompt(sessionId, root, executionMode, profile);
      assert.equal((prompt.match(/\[AGENT_IDENTITY - PRIVATE TO THIS AGENT\]/g) || []).length, 1, `${executionMode}: identity must occur exactly once`);
      assert.equal((prompt.match(/\[AGENT_MEMORY - PRIVATE TO THIS AGENT\]/g) || []).length, 1, `${executionMode}: memory must occur exactly once`);
      assert.ok(prompt.indexOf('AGENT_IDENTITY_FIXTURE') < prompt.indexOf('AGENT_MEMORY_FIXTURE'), `${executionMode}: AGENT.md must precede MEMORY.md`);
      assert.ok(!prompt.includes('ROOT_USER_MUST_NOT_APPEAR'));
      assert.ok(!prompt.includes('ROOT_SOUL_MUST_NOT_APPEAR'));
      assert.ok(!prompt.includes('ROOT_MEMORY_MUST_NOT_APPEAR'));
      clearRuntimeActorContext(sessionId);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('subagent assembled prompt identity/memory regression passed');
}

void main();
