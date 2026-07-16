import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeWorkerBroker } from '../process/runtime-worker-broker';
import {
  buildPersonalityContext,
  type BuildPersonalityContextOptions,
  type PersonalityContextSnapshot,
} from '../prompt-context';

async function main(): Promise<void> {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-context-worker-'));
  const memoryDir = path.join(workspacePath, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'USER.md'), 'User equivalence fixture.\n');
  fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), 'Soul equivalence fixture.\n');
  fs.writeFileSync(path.join(workspacePath, 'MEMORY.md'), 'Memory equivalence fixture.\n');
  fs.writeFileSync(path.join(memoryDir, `${new Date().toISOString().split('T')[0]}-intraday-notes.md`), '');

  const snapshot: PersonalityContextSnapshot = {
    businessContextEnabled: false,
    activatedToolCategories: [],
    runtimeActor: null,
    runtimeActorMemory: '',
    runtimeActorManagerMemory: '',
    projectContextBlock: '[fixture project]',
    skillTurnContext: '[fixture skill turn context]',
    activeSkillsContext: '[fixture active skill context]',
    retrievedMemoryContext: '[fixture retrieved memory]',
    subagentsRosterBlock: '[fixture subagent roster]',
    advanceTurn: true,
  };
  const options: BuildPersonalityContextOptions & { serializedSnapshot: PersonalityContextSnapshot } = {
    serializedSnapshot: snapshot,
  };
  const fakeSkillsManager = {
    buildTurnContext: () => {
      throw new Error('Mutable SkillsManager must not be used with a serialized snapshot.');
    },
  };
  const args = {
    sessionId: 'context_worker_equivalence',
    workspacePath,
    messageText: 'Continue the representative task.',
    executionMode: 'interactive',
    historyLength: 2,
    extraCats: [] as string[],
    options,
  };
  const inProcess = await buildPersonalityContext(
    args.sessionId,
    args.workspacePath,
    args.messageText,
    args.executionMode,
    args.historyLength,
    fakeSkillsManager as any,
    () => new Map(),
    () => {},
    new Set(args.extraCats),
    options,
  );

  const broker = new RuntimeWorkerBroker({
    name: 'context-worker-regression',
    entryBasename: 'context-build-worker',
    maxMessageBytes: 2 * 1024 * 1024,
    startupTimeoutMs: 15_000,
    defaultJobTimeoutMs: 15_000,
  });
  try {
    const result = await broker.run<{ context: string; rssBytes: number }>(
      'build_personality_context',
      args,
      15_000,
    );
    assert.equal(result.context, inProcess, 'worker prompt must exactly match snapshot-backed in-process assembly');
    assert.ok(result.rssBytes > 0);
    assert.ok(result.context.includes('[fixture project]'));
    assert.ok(result.context.includes('[fixture skill turn context]'));
  } finally {
    await broker.shutdown();
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
  console.log('context-build worker equivalence regression passed');
}

void main();
