import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordLearningTurn, getSkillRoutingEvidence, submitSkillRoutingFeedback, computeSkillRoutingStats, sha } from './turn-recorder';
import { buildRoutingReviewSuggestions, buildUnreviewedRoutingSuggestions } from '../skills-runtime/skill-curator';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-evidence-'));
try {
  const capture = (request: string, read = false) => recordLearningTurn({ workspacePath: root, sessionId: 's1', executionMode: 'interactive', request, finalResponse: '',
    toolResults: read ? [{ name: 'skill_read', args: { id: 'deploy' } }] : [], routing: { version: 2, mode: 'active', messageHash: sha(request),
      candidates: [{ id: 'deploy', reason: 'strong_trigger_match', score: 80, confidence: 'high', instructionChars: 0, estimatedTokens: 0, matchedTriggers: ['build'] }],
      excluded: [{ id: 'other', reason: 'domain conflict' }], discoveryRecommended: false, discoveryReason: '', autoInjectedInstructions: false, instructionsRequireSkillRead: true } })!;
  const noMatch = recordLearningTurn({ workspacePath: root, sessionId: 'empty', executionMode: 'interactive', request: 'hello', finalResponse: '', toolResults: [] })!;
  assert.equal(getSkillRoutingEvidence(root, { turnId: noMatch.turnId })[0].offered.length, 0);
  const first = capture('build a birthday card token=secret-value');
  const second = capture('build a sand castle', true);
  const third = capture('build a model boat');
  const unknownSample = capture('build a snowman');
  const pendingUnknown = buildUnreviewedRoutingSuggestions(root);
  assert.equal(pendingUnknown.length, 1); assert.match(pendingUnknown[0].title, /UNKNOWN/); assert.equal(pendingUnknown[0].change.kind, 'review_only');
  assert.match(pendingUnknown[0].reason, /NOT irrelevant/);
  submitSkillRoutingFeedback(root, { turnId: unknownSample.turnId, requestHash: unknownSample.requestHash, skillId: 'deploy', relevance: 'relevant', reason: 'Context reviewed', reviewerSource: 'agent', reviewerId: 'judge_1', reviewedEvidence: 'Original context showed a software build task' });
  assert.equal(getSkillRoutingEvidence(root, { turnId: unknownSample.turnId })[0].reviews[0].reviewerSource, 'agent');
  let stats = computeSkillRoutingStats(root, Infinity);
  assert.equal(stats.days, 30); assert.equal(stats.skills[0].precision, 1); assert.equal(stats.skills[0].unknown, 3); assert.equal(stats.skills[0].readRate, 1 / 4);
  assert.equal(buildRoutingReviewSuggestions(root).length, 0, 'unread is not irrelevant');
  const review = (r: typeof first, relevance = 'irrelevant') => submitSkillRoutingFeedback(root, { turnId: r.turnId, requestHash: r.requestHash, skillId: 'deploy', relevance, reason: 'Not a software deployment task' });
  review(first); review(second);
  assert.equal(buildRoutingReviewSuggestions(root).length, 0, 'two requests insufficient');
  review(third); review(first);
  const suggestions = buildRoutingReviewSuggestions(root);
  assert.equal(suggestions.length, 1); assert.equal(suggestions[0].status, 'pending'); assert.equal(suggestions[0].change.kind, 'review_only'); assert.equal(suggestions[0].autoApplyEligible, false);
  assert.equal(suggestions[0].id, buildRoutingReviewSuggestions(root)[0].id); assert.equal(suggestions[0].evidence.length, 3);
  assert.match(suggestions[0].reason, /stricter/); assert.ok(suggestions[0].evidence.some(e => e.includes(first.requestHash)));
  stats = computeSkillRoutingStats(root); assert.equal(stats.skills[0].precision, 1 / 4); assert.equal(stats.skills[0].irrelevant, 3); assert.equal(stats.terms[0].irrelevant, 3);
  review(second, 'relevant'); stats = computeSkillRoutingStats(root); assert.equal(stats.skills[0].precision, 1 / 2);
  review(second, 'unknown'); assert.equal(buildRoutingReviewSuggestions(root).length, 0);
  const persisted = getSkillRoutingEvidence(root, { skillId: 'deploy', relevance: 'unknown' }); assert.equal(persisted.length, 1); assert.equal(persisted[0].turnId, second.turnId);
  assert.equal(getSkillRoutingEvidence(root, { turnId: first.turnId })[0].excluded![0].id, 'other');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'Brain', 'learning', 'turns', first.ts.slice(0, 10) + '.jsonl'), 'utf8'), /secret-value/);
  const good = { turnId: first.turnId, requestHash: first.requestHash, skillId: 'deploy', relevance: 'irrelevant', reason: 'example' };
  for (const bad of [{ ...good, skillId: '../deploy' }, { ...good, relevance: 'no' }, { ...good, reviewerSource: 'agent' }, { ...good, reviewerSource: 'agent', reviewerId: 'judge', reviewedEvidence: 'a'.repeat(1001) }, { ...good, reason: 'a'.repeat(501) }, { ...good, requestHash: sha('wrong') }, { ...good, workspacePath: root }, { ...good, skillId: 'not-offered' }, null]) assert.throws(() => submitSkillRoutingFeedback(root, bad));
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-foreign-')); try { assert.throws(() => submitSkillRoutingFeedback(foreign, good)); } finally { fs.rmSync(foreign, { recursive: true, force: true }); }
  const file = path.join(root, 'Brain', 'learning', 'turns', first.ts.slice(0, 10) + '.jsonl');
  const legacy = { ...second, v: 1, sessionId: 'legacy', labels: [{ skillId: 'deploy', label: 'hit', terms: ['build'] }] }; delete (legacy as any).turnId;
  fs.appendFileSync(file, JSON.stringify(legacy) + '\nnull\n{"v":2,"offered":null}\n');
  fs.appendFileSync(path.join(root, 'Brain', 'learning', 'routing-feedback.jsonl'), '{"relevance":"irrelevant"}\nnull\n');
  const evidence = getSkillRoutingEvidence(root); assert.equal(evidence.length, 6); assert.ok(evidence.some(e => e.legacyProxy && e.reviews.length === 0));
  assert.equal(computeSkillRoutingStats(root, 999999).days, 90); assert.equal(computeSkillRoutingStats(root).skills[0].unknown, 2);
  console.log('skill-routing-observability regression: ok');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// Shared gateway identity joins the normal turn's prompt receipts and skill evidence.
const joinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-join-'));
try {
 const rec = recordLearningTurn({ workspacePath: joinRoot, sessionId: 'join', executionMode: 'interactive', request: 'hello', finalResponse: 'hi', toolResults: [], gatewayTurnId: 'turn-test-123' })!;
 assert.equal(rec.gatewayTurnId, 'turn-test-123');
 assert.equal(getSkillRoutingEvidence(joinRoot, { turnId: rec.turnId })[0].gatewayTurnId, 'turn-test-123');
} finally { fs.rmSync(joinRoot, { recursive: true, force: true }); }

const budgetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-budget-'));
try {
 const dir = path.join(budgetRoot, 'Brain', 'learning', 'turns'); fs.mkdirSync(dir, { recursive: true });
 const now = new Date(); const day = now.toISOString().slice(0, 10);
 // An oversized evidence file must be reported as partial, not a complete empty scan.
 fs.writeFileSync(path.join(dir, `${day}.jsonl`), 'x'.repeat(4 * 1024 * 1024 + 1));
 const evidence = getSkillRoutingEvidence(budgetRoot, { days: 90 });
 assert.equal(evidence.scan.partial, true); assert.equal(evidence.scan.maxBytes, 8 * 1024 * 1024);
 assert.equal(computeSkillRoutingStats(budgetRoot, 90).scan.partial, true);
} finally { fs.rmSync(budgetRoot, { recursive: true, force: true }); }
