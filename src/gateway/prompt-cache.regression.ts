import assert from 'assert';
import { PROMPT_CACHE_MARKER } from '../providers/LLMProvider';
import { splitOnCacheMarker } from '../providers/content-utils';
import { assembleCacheAwareSystemPrompt, partitionInvariantToolGuidance } from './prompt-cache';

function buildTurn(input: { time: string; caller: string; retrieved: string }): string {
  return assembleCacheAwareSystemPrompt({
    stableParts: [
      'You are Prom, a local AI assistant running inside Prometheus.',
      '[CURRENT_MODEL]\nprovider=openai_codex\nmodel=gpt-5.6-terra',
    ],
    personalityContext: [
      '[PROMETHEUS_SOUL]\nstable soul',
      '[TOOLS]\nstable tool guidance',
      PROMPT_CACHE_MARKER,
      `[MEMORY_RETRIEVED]\n${input.retrieved}`,
    ].join('\n\n'),
    volatileParts: [
      `Current date: ${input.time}.`,
      input.caller,
    ],
  });
}

function testTurnVolatilityDoesNotChangePrefix(): void {
  const first = splitOnCacheMarker(buildTurn({
    time: 'Monday, July 22, 2026, 09:00 AM',
    caller: '[BROWSER SESSION ACTIVE: first page]',
    retrieved: 'first retrieval',
  }));
  const second = splitOnCacheMarker(buildTurn({
    time: 'Monday, July 22, 2026, 09:01 AM',
    caller: '[BROWSER SESSION ACTIVE: second page]',
    retrieved: 'second retrieval',
  }));

  assert.equal(first.stable, second.stable, 'ordinary turn state must not change the reusable prefix');
  assert.ok(first.stable.includes('[TOOLS]'), 'the expensive tool guidance must remain in the reusable prefix');
  assert.ok(!first.stable.includes('Current date:'), 'the clock must be after the cache breakpoint');
  assert.ok(!first.stable.includes('[BROWSER SESSION ACTIVE:'), 'live browser state must be after the cache breakpoint');
  assert.ok(second.volatile.includes('09:01 AM'));
  assert.ok(second.volatile.includes('second retrieval'));
}

function testContextWithoutItsOwnMarkerStillGetsAStablePrefix(): void {
  const prompt = assembleCacheAwareSystemPrompt({
    stableParts: ['base policy'],
    personalityContext: 'profile without a marker',
    volatileParts: ['Current date: changed each turn.'],
  });
  const parts = splitOnCacheMarker(prompt);
  assert.ok(parts.stable.includes('base policy'));
  assert.ok(parts.stable.includes('profile without a marker'));
  assert.equal(parts.volatile, 'Current date: changed each turn.');
}

function testCallerContextCanRemainMostSpecific(): void {
  const prompt = assembleCacheAwareSystemPrompt({
    stableParts: ['base policy'],
    personalityContext: `stable personality${PROMPT_CACHE_MARKER}volatile personality`,
    volatileBeforePersonality: ['recent tool observation'],
    volatileAfterPersonality: ['[TEAM DISPATCH] assigned task', '[ONBOARDING MEET & GREET MODE]'],
  });
  const volatile = splitOnCacheMarker(prompt).volatile;
  assert.ok(
    volatile.indexOf('recent tool observation') < volatile.indexOf('volatile personality')
      && volatile.indexOf('volatile personality') < volatile.indexOf('[TEAM DISPATCH]'),
    'callers that require final precedence must remain after volatile personality context',
  );
  assert.ok(
    volatile.indexOf('volatile personality') < volatile.indexOf('[ONBOARDING MEET & GREET MODE]'),
    'onboarding must remain after personality context as it was before cache assembly',
  );
}

testTurnVolatilityDoesNotChangePrefix();
testContextWithoutItsOwnMarkerStillGetsAStablePrefix();
testCallerContextCanRemainMostSpecific();
console.log('prompt cache assembly regression checks passed');

const guidance = ['PARALLELISM: fixed rules', 'SKILLS: fixed rules', 'BACKGROUND: fixed rules'];
const makeMenu = (active: string) => `[TOOLS] live menu\n\n${guidance[2]}\n\n[ACTIVE_TOOL_CATEGORIES] ${active}\n\n${guidance[0]}\n\n${guidance[1]}`;
const firstParts = [makeMenu('browser'), '[SUBAGENTS] first roster', '[TODAY_NOTES] first notes'];
const firstPartition = partitionInvariantToolGuidance(firstParts, guidance);
const secondPartition = partitionInvariantToolGuidance([makeMenu('workspace'), '[SUBAGENTS] second roster'], guidance);
assert.deepEqual(firstPartition.stable, guidance);
assert.deepEqual(secondPartition.stable, firstPartition.stable);
assert.ok(firstPartition.volatile[0].includes('browser'));
assert.ok(secondPartition.volatile[0].includes('workspace'));
assert.equal(firstPartition.volatile[1], firstParts[1]);
assert.equal(firstPartition.volatile[2], firstParts[2]);
for (const block of guidance) {
  assert.ok(!firstPartition.volatile.join('\n').includes(block));
  assert.equal(firstPartition.stable.filter(value => value === block).length, 1);
}
assert.ok(firstParts[0].includes(guidance[0]), 'input not mutated');
const unrelated = `User quoted\n\n${guidance[0]}`;
assert.deepEqual(partitionInvariantToolGuidance([unrelated], guidance), { stable: [], volatile: [unrelated] });
const partial = `[TOOLS] menu\n\n${guidance[0]} plus changed policy`;
assert.deepEqual(partitionInvariantToolGuidance([partial], guidance), { stable: [], volatile: [partial] });
assert.deepEqual(partitionInvariantToolGuidance(['[TOOLS] no fixed guidance'], guidance).stable, []);
console.log('invariant tool guidance cache partition checks passed');
