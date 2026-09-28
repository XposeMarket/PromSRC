// Regression: subagents and team members get the main-chat tool system
// (core tools + auto category activation from the REAL task), and an explicit
// allowed_tools list makes a minimal agent. Guards the 2026-09-28 "70 vs 55 tools" bug
// where the [TEAM DISPATCH] wrapper text alone provisioned browser/agents/tasks categories.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 1. Wrapper text must not drive category detection.
const { extractTeamDispatchTaskText } = require(path.join(root, 'dist/gateway/teams/team-dispatch-runtime.js'));
const { detectKeywordToolCategories } = require(path.join(root, 'dist/runtime/tool-category-keyword-router.js'));
const task = 'Run git rev-parse --short HEAD in PromSRC and report the hash.';
const wrapped = [
  '[TEAM DISPATCH]', '', 'YOUR TASK:', task, '', 'ADDITIONAL CONTEXT:', 'Keep it short.', '',
  '[TEAM CONTEXT — Product Lab]', 'Team workspace (your working directory): C:\\x', '',
  'TOOL RULES — follow exactly:', '1. You start with core tools; categories your task needs load automatically.',
  '2. For web/browser automation call browser_open directly.', '',
  'Execute the task above now. Use your tools, verify results, and report what actually happened.',
].join('\n');
const extracted = extractTeamDispatchTaskText(wrapped);
assert.ok(extracted.includes(task), 'extracted text keeps the task');
assert.ok(extracted.includes('Keep it short.'), 'extracted text keeps additional context');
assert.ok(!/TOOL RULES|TEAM CONTEXT|browser_open/.test(extracted), 'extracted text drops wrapper boilerplate');
assert.equal(extractTeamDispatchTaskText(task), task, 'non-wrapped text passes through unchanged');
const wrappedCats = [...detectKeywordToolCategories(wrapped)].sort();
const taskCats = [...detectKeywordToolCategories(extracted)].sort();
assert.ok(wrappedCats.length > taskCats.length, `wrapper over-provisions (${wrappedCats}) vs task (${taskCats})`);
assert.deepEqual(taskCats, ['workspace_write'], 'a terminal task gets exactly the terminal category, like main chat');

// 2. Dispatch passes the extracted text + allowlist into handleChat.
const dispatch = read('src/gateway/teams/team-dispatch-runtime.ts');
assert.match(dispatch, /toolCategoryDetectionText:\s*extractTeamDispatchTaskText\(task\)/);
assert.match(dispatch, /resolveAgentToolFilter\(agentId\)/);
assert.doesNotMatch(dispatch, /You have FULL tool access/, 'dispatch no longer claims every tool is loaded');

// 3. handleChat honors detection text and pre-activates allowlist categories.
const router = read('src/gateway/routes/chat.router.ts');
assert.match(router, /autoActivateToolCategories\(sessionId,\s*toolCategoryDetectionText,/);
assert.match(router, /allowlistCategories\.add\(category\)/);

// 4. Every agent runtime resolves the allowlist through the shared policy.
assert.match(read('src/gateway/teams/team-member-room.ts'), /return resolveAgentToolFilter\(agentId\)/);
assert.match(read('src/gateway/routes/channels.router.ts'), /directSubagentChat: true, toolFilter: resolveAgentToolFilter\(agentId\)/);
assert.match(read('src/gateway/tasks/background-task-runner.ts'), /return resolveAgentToolFilter\(agentId\)/);

// 5. Allowlisted tool names map to real categories (so pre-activation can expose them).
const { getToolCategory } = require(path.join(root, 'dist/gateway/tool-builder.js'));
assert.equal(getToolCategory('workspace_run'), 'workspace_write');
assert.equal(getToolCategory('write_note'), null, 'core tools need no activation');

console.log('PASS agent tool surface parity (main-chat tool system for subagents + minimal-agent allowlist)');
