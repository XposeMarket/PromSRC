import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateSkillPromotion } from './skill-promotion';
import { promoteSkillCandidate, type SkillCuratorSuggestion } from './skill-curator';
import type { Skill, SkillsManager } from './skills-manager';
import { sha, type RoutingEvidenceResult } from '../learning/turn-recorder';

const skill = (id: string, triggers: string[]) => ({ id, name: id, description: '', instructions: '', triggers, categories: [], requiredTools: [], health: { state: 'healthy' }, status: 'ready', lifecycle: 'active', eligibility: { status: 'ready' }, executionEnabled: true, implicitInvocation: true, manifest: { triggers } } as unknown as Skill);
const skills = [skill('invoice-workflow', ['invoice workflow', 'billing archive'])];
const manager = { getAll: () => skills, get: (id: string) => skills.find(s => s.id === id) } as SkillsManager;
const suggestion: SkillCuratorSuggestion = { id: 'candidate1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: 'Add export routing', reason: 'Regression fixture', autoApplyEligible: false, risk: 'low', skillId: skills[0].id, status: 'pending', evidence: [], change: { kind: 'manifest_overlay', manifest: { triggers: ['invoice workflow', 'billing archive', 'invoice export'] } }, triggerEvaluation: { passed: true, positive: [{ prompt: 'invoice export', passed: true }], negative: [{ prompt: 'water the garden', passed: true }], errors: [] } } as unknown as SkillCuratorSuggestion;
const request = 'billing archive';
const contextHash = sha('context');
const turn = { turnId: `lt_${'a'.repeat(32)}`, sessionId: 'test', requestHash: sha(request), routingMatched: true, reviews: [{ skillId: skills[0].id, relevance: 'relevant', nativeReviewed: true, contextHash }] };
function source(rows: unknown[] = [turn], partial = false): RoutingEvidenceResult {
  return Object.assign(rows, { scan: { partial, remainingBytes: 1000, maxBytes: 1000, deadlineMs: 150 } }) as RoutingEvidenceResult;
}
const resolve = () => ({ request, contextHash });
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
test('independent replay and trigger evaluation pass', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source(), resolve).passed, true));
test('previously relevant route regression rejects', () => {
  const changed = { ...suggestion, change: { ...suggestion.change, manifest: { triggers: ['invoice export'] } } };
  assert.equal(evaluateSkillPromotion(manager, changed, source(), resolve).passed, false);
});
test('positive trigger failure rejects', () => assert.equal(evaluateSkillPromotion(manager, { ...suggestion, triggerEvaluation: { ...suggestion.triggerEvaluation!, positive: [{ prompt: 'unknown request', passed: true }] } }, source(), resolve).passed, false));
test('negative collision rejects', () => assert.equal(evaluateSkillPromotion(manager, { ...suggestion, triggerEvaluation: { ...suggestion.triggerEvaluation!, negative: [{ prompt: 'invoice export', passed: true }] } }, source(), resolve).passed, false));
test('missing holdout fails closed', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source([]), resolve).passed, false));
test('partial scan fails closed', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source([turn], true), resolve).passed, false));
test('missing original fails closed', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source(), () => null).passed, false));
test('training request cannot be holdout', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source([{ ...turn, requestHash: sha('invoice export') }]), () => ({ request: 'invoice export', contextHash })).passed, false));
test('context mismatch rejects', () => assert.equal(evaluateSkillPromotion(manager, suggestion, source(), () => ({ request, contextHash: sha('wrong') })).passed, false));
test('integrated promotion persists rejection and ledger without mutation', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-promotion-'));
  try {
    const dir = path.join(workspace, 'Brain', 'skill-curator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'suggestions.json'), JSON.stringify([suggestion]));
    const result = promoteSkillCandidate(workspace, manager, suggestion.id);
    assert.equal(result?.status, 'rejected_by_replay');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'promotion-ledger.jsonl'), 'utf8')).decision, 'rejected_by_replay');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'suggestions.json'), 'utf8'))[0].status, 'rejected_by_replay');
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
test('integrated passing gate applies exactly once and records evidence', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-promotion-pass-'));
  let writes = 0;
  try {
    const dir = path.join(workspace, 'Brain', 'skill-curator');
    const learning = path.join(workspace, 'Brain', 'learning');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(learning, 'turns'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'suggestions.json'), JSON.stringify([suggestion]));
    const record = { ...turn, v: 2, ts: new Date().toISOString(), executionMode: 'interactive', requestExcerpt: request, offered: [{ id: skills[0].id, terms: ['billing archive'], score: 100, confidence: 'high' }], read: [] };
    fs.writeFileSync(path.join(learning, 'turns', `${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify(record) + '\n');
    fs.writeFileSync(path.join(learning, 'routing-feedback.jsonl'), JSON.stringify({ ...turn.reviews[0], turnId: turn.turnId, requestHash: turn.requestHash, reason: 'Reviewed authoritative original', ts: new Date().toISOString() }) + '\n');
    const writable = { ...manager, writeManifestOverlay: () => { writes++; } } as unknown as SkillsManager;
    assert.equal(promoteSkillCandidate(workspace, writable, suggestion.id, resolve)?.status, 'applied');
    assert.equal(promoteSkillCandidate(workspace, writable, suggestion.id, resolve)?.status, 'applied');
    assert.equal(writes, 1);
    const ledger = fs.readFileSync(path.join(dir, 'promotion-ledger.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(ledger.map(row => row.decision), ['authorized_by_replay', 'applied']);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

console.log(`skill promotion regression: ${passed}/${passed} passed`);
