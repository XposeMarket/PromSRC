/**
 * Small-context fitting: the full tool surface (~12k tokens) used to exceed a
 * local model's whole 8k window, silently truncating the request. Checks that
 * fitting stays within budget while keeping every tool, property, enum and
 * required list, and that large windows are untouched.
 * Run: npm run test:small-context-fit
 */
import assert from 'node:assert/strict';
import { estimateToolSchemaTokens, fitToolDefinitionsToBudget } from './schema-compaction';

const longText = 'This tool does something useful. '.repeat(30);
const defs = Array.from({ length: 40 }, (_, i) => ({
  type: 'function',
  function: {
    name: `tool_${i}`,
    description: longText,
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: longText },
        mode: { type: 'string', enum: ['a', 'b'], description: longText },
        items: { type: 'array', items: { type: 'object', properties: { x: { type: 'number', description: longText } } } },
      },
    },
  },
}));

const before = estimateToolSchemaTokens(defs);
assert.ok(before > 8192 / 3, 'fixture is larger than a third of an 8k window');

const budget = Math.floor(8192 / 3);
const fitted = fitToolDefinitionsToBudget(defs, budget);
assert.notEqual(fitted.level, 'full');
// Prose-only shrinking has a floor (names, types, enums, required stay). When
// the budget is below that floor it returns the minimal level, never drops
// anything, and reports the real size so the caller can see it.
assert.ok(fitted.afterTokens < before / 4, `shrinks substantially (${before} -> ${fitted.afterTokens})`);
if (fitted.afterTokens > budget) assert.equal(fitted.level, 'minimal', 'over-budget results are at the minimal level');
const roomy = fitToolDefinitionsToBudget(defs, Math.ceil(before / 2));
assert.ok(roomy.afterTokens <= Math.ceil(before / 2), 'fits when the budget is reachable');
assert.notEqual(roomy.level, 'minimal', 'stops at the first level that fits');
assert.equal(fitted.tools.length, defs.length, 'no tool dropped');
for (let i = 0; i < defs.length; i++) {
  const a = defs[i].function.parameters;
  const b = fitted.tools[i].function.parameters;
  assert.equal(fitted.tools[i].function.name, defs[i].function.name);
  assert.deepEqual(Object.keys(b.properties), Object.keys(a.properties), 'every property kept');
  assert.deepEqual(b.required, a.required, 'required list kept');
  assert.deepEqual(b.properties.mode.enum, ['a', 'b'], 'enums kept');
  assert.equal(b.properties.items.items.properties.x.type, 'number', 'nested schema kept');
}
assert.equal(defs[0].function.description, longText, 'input definitions are not mutated');

const big = fitToolDefinitionsToBudget(defs, 200_000);
assert.equal(big.level, 'full');
assert.equal(big.tools, defs, 'large windows are untouched');

console.log(`small-context fit regression passed (${before} -> ${fitted.afterTokens} tokens at ${fitted.level})`);
