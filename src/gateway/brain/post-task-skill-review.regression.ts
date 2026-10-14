import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPostTaskSkillReviewEnabled } from './post-task-skill-review';

let passed = 0;
for (const [name, config, expected] of [
  ['fresh install off', {}, false],
  ['review flag alone is not consent', { brain: { skillLearning: { autoReview: true } } }, false],
  ['Brain alone is not learning consent', { brain: { enabled: true } }, false],
  ['explicit opt-in enabled', { brain: { enabled: true, skillLearning: { autoReview: true } } }, true],
  ['disable reverses opt-in', { brain: { enabled: true, skillLearning: { autoReview: false } } }, false],
] as const) {
  assert.equal(isPostTaskSkillReviewEnabled(config), expected, name);
  passed++;
  console.log(`PASS ${name}`);
}
const source = fs.readFileSync('src/gateway/routes/chat/pipeline/handle-chat.ts', 'utf8');
assert.match(source, /finalizeSkillGardenerForTurn[\s\S]*enqueuePostTurnJob\([\s\S]*reviewCompletedMultiToolTurn/);
passed++;
console.log(`post-task skill review regression: ${passed}/${passed} passed`);
