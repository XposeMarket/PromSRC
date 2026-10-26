import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPersonalityContext, type PersonalityContextSnapshot } from './prompt-context';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';

// Behavioral regression: dynamic tool menu and subagent roster must live in the
// VOLATILE tail, so the STABLE prefix stays byte-identical for the same durable
// profile/project regardless of tool activation or roster changes. Covers the
// interactive Tier 1/Tier 2 paths, the teach_mode path, and the autonomous
// background_task path where tool menus were also moved.

const skillsManager = { buildTurnContext: () => '', getSkill: () => null } as any;

function snapshot(overrides: Partial<PersonalityContextSnapshot>): PersonalityContextSnapshot {
  return {
    businessContextEnabled: false,
    activatedToolCategories: [],
    runtimeHostContext: 'HOST_CONTEXT_FIXTURE',
    runtimeActor: null,
    runtimeActorMemory: '',
    runtimeActorManagerMemory: '',
    projectContextBlock: '',
    skillTurnContext: '',
    activeSkillsContext: '',
    memoryAtomContext: '',
    retrievedMemoryContext: '',
    subagentsRosterBlock: '',
    advanceTurn: false,
    ...overrides,
  };
}

type RenderOpts = {
  executionMode?: string;
  historyLength?: number;
  profile?: 'teach_mode';
  extraCats?: Set<string>;
  snap: PersonalityContextSnapshot;
};

async function render(workspacePath: string, sessionId: string, opts: RenderOpts): Promise<string> {
  return buildPersonalityContext(
    sessionId,
    workspacePath,
    'Continue the assignment.',
    opts.executionMode ?? 'interactive',
    opts.historyLength ?? 3,
    skillsManager,
    () => new Map(),
    () => {},
    opts.extraCats ?? new Set(),
    { serializedSnapshot: opts.snap, ...(opts.profile ? { profile: opts.profile } : {}) },
  );
}

function splitPrompt(prompt: string): { stable: string; volatile: string } {
  const idx = prompt.indexOf(PROMPT_CACHE_MARKER);
  if (idx < 0) return { stable: prompt, volatile: '' };
  return { stable: prompt.slice(0, idx), volatile: prompt.slice(idx + PROMPT_CACHE_MARKER.length) };
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-prefix-stability-'));
  try {
    fs.writeFileSync(path.join(root, 'USER.md'), 'USER_PROFILE_FIXTURE');
    fs.writeFileSync(path.join(root, 'SOUL.md'), 'SOUL_PROFILE_FIXTURE');
    fs.writeFileSync(path.join(root, 'MEMORY.md'), 'MEMORY_PROFILE_FIXTURE');

    const toolsA = ['workspace_write'];
    const toolsB = ['browser_automation', 'media_generation'];
    const rosterA = 'ROSTER_FIXTURE_ALPHA';
    const rosterB = 'ROSTER_FIXTURE_BRAVO';

    // Tier 2 (subsequent turn): tool activation and roster change, durable profile fixed.
    const t2A = splitPrompt(await render(root, 'prefix_t2', { historyLength: 3, snap: snapshot({ activatedToolCategories: toolsA, subagentsRosterBlock: rosterA }) }));
    const t2B = splitPrompt(await render(root, 'prefix_t2', { historyLength: 3, snap: snapshot({ activatedToolCategories: toolsB, subagentsRosterBlock: rosterB }) }));
    assert.equal(t2A.stable, t2B.stable, 'Tier2 stable prefix must not change with tool activation or roster');
    assert.ok(!t2A.stable.includes(rosterA), 'Tier2 roster must not be in stable prefix');
    assert.equal(countOf(t2A.volatile, rosterA), 1, 'Tier2 roster must appear exactly once in volatile');
    assert.equal(countOf(t2A.volatile, '[TOOLS]'), 1, 'Tier2 tool menu must appear exactly once in volatile');
    assert.ok(!t2A.stable.includes('[TOOLS]'), 'Tier2 tool menu must not be in stable prefix');
    assert.notEqual(t2A.volatile, t2B.volatile, 'Tier2 volatile tail must reflect different tool categories');
    assert.ok(t2A.volatile.indexOf(rosterA) < t2A.volatile.indexOf('[TOOLS]'), 'Tier2 roster must precede tools as in original order');

    // Tier 1 (first turn): tool activation changes, durable profile fixed.
    const t1A = splitPrompt(await render(root, 'prefix_t1', { historyLength: 0, snap: snapshot({ activatedToolCategories: toolsA }) }));
    const t1B = splitPrompt(await render(root, 'prefix_t1', { historyLength: 0, snap: snapshot({ activatedToolCategories: toolsB }) }));
    assert.equal(t1A.stable, t1B.stable, 'Tier1 stable prefix must not change with tool activation');
    assert.equal(t1A.stable, t2A.stable, 'first and subsequent turns must share the durable prefix');
    assert.ok(!t1A.stable.includes('[TOOLS]'), 'Tier1 tool menu must not be in stable prefix');
    assert.equal(countOf(t1A.volatile, '[TOOLS]'), 1, 'Tier1 tool menu must appear exactly once in volatile');

    // Autonomous background_task: tool menu comes from extraCats; must be volatile.
    const bgA = splitPrompt(await render(root, 'prefix_bg', { executionMode: 'background_task', extraCats: new Set(toolsA), snap: snapshot({}) }));
    const bgB = splitPrompt(await render(root, 'prefix_bg', { executionMode: 'background_task', extraCats: new Set(toolsB), snap: snapshot({}) }));
    assert.equal(bgA.stable, bgB.stable, 'background_task stable prefix must not change with tool activation');
    assert.ok(!bgA.stable.includes('[TOOLS]'), 'background_task tool menu must not be in stable prefix');
    assert.equal(countOf(bgA.volatile, '[TOOLS]'), 1, 'background_task tool menu must appear exactly once in volatile');

    // Teach mode: tool menu must be volatile.
    const teachA = splitPrompt(await render(root, 'prefix_teach', { profile: 'teach_mode', historyLength: 0, snap: snapshot({ activatedToolCategories: toolsA }) }));
    const teachB = splitPrompt(await render(root, 'prefix_teach', { profile: 'teach_mode', historyLength: 0, snap: snapshot({ activatedToolCategories: toolsB }) }));
    assert.equal(teachA.stable, teachB.stable, 'teach_mode stable prefix must not change with tool activation');
    assert.ok(!teachA.stable.includes('[TOOLS]'), 'teach_mode tool menu must not be in stable prefix');
    assert.equal(countOf(teachA.volatile, '[TOOLS]'), 1, 'teach_mode tool menu must appear exactly once in volatile');

    // Negative: an edited durable profile must change the stable prefix.
    fs.writeFileSync(path.join(root, 'USER.md'), 'USER_PROFILE_EDITED');
    const t2Edited = splitPrompt(await render(root, 'prefix_t2', { historyLength: 3, snap: snapshot({ activatedToolCategories: toolsA, subagentsRosterBlock: rosterA }) }));
    assert.notEqual(t2Edited.stable, t2A.stable, 'edited durable profile must change stable prefix');
    assert.ok(t2Edited.stable.includes('USER_PROFILE_EDITED'));

    // Empty dynamic inputs must not leave undefined text.
    const empty = await render(root, 'prefix_t2', { historyLength: 3, snap: snapshot({ activatedToolCategories: [], subagentsRosterBlock: '' }) });
    assert.ok(!empty.includes('undefined'), 'empty dynamic inputs must not emit undefined');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('prompt prefix stability regression passed');
}

void main();
