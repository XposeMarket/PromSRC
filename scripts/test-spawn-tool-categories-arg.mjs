// Regression: background_spawn must not silently drop tool_categories sent as a string.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/gateway/tasks/spawn-tool-categories-arg.ts'), 'utf8');
const js = src
  .replace(/export function normalizeSpawnToolCategoriesArg\(raw: unknown\): string\[\] \| undefined/, 'function normalizeSpawnToolCategoriesArg(raw)')
  .replace(/let values: unknown\[\] = \[\];/, 'let values = [];')
  .replace(/const out: string\[\] = \[\];/, 'const out = [];');
const normalize = new Function(`${js}\nreturn normalizeSpawnToolCategoriesArg;`)();

assert.deepEqual(normalize(['workspace_write']), ['workspace_write']);
assert.deepEqual(normalize('workspace_write'), ['workspace_write']);
assert.deepEqual(normalize('workspace_write, browser_automation'), ['workspace_write', 'browser_automation']);
assert.deepEqual(normalize('["workspace_write","browser_automation"]'), ['workspace_write', 'browser_automation']);
assert.deepEqual(normalize("['workspace_write']"), ['workspace_write']);
assert.equal(normalize(''), undefined);
assert.equal(normalize(undefined), undefined);
assert.equal(normalize(42), undefined);

for (const rel of ['src/gateway/agents-runtime/subagent-executor.ts', 'src/gateway/agents-runtime/capabilities/automation-executor.ts']) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.doesNotMatch(text, /Array\.isArray\(args\.tool_categories\) \? args\.tool_categories : undefined/, `${rel} must normalize tool_categories`);
  assert.match(text, /normalizeSpawnToolCategoriesArg\(args\.tool_categories\)/, `${rel} must use the shared normalizer`);
}

const exec = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
const chatStart = exec.indexOf("case 'chat_with_subagent': {");
const chat = exec.slice(chatStart, chatStart + 2500);
assert.match(chat, /requestedType === 'team_member'[\s\S]*executeTool\('agent_message_send'/, 'chat_with_subagent must route team members to agent_message_send');

console.log('PASS spawn tool_categories normalization + team-member chat routing');
