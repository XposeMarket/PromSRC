import assert from 'node:assert/strict';
import { buildRecommendations, rankRecommendations, recommendationFromBrainPulseCard, type Recommendation } from './recommendation-service';

const now = new Date('2026-09-02T16:00:00.000Z');

const ranked = rankRecommendations([
  {
    id: 'brain-1', label: 'Continue browser login handoff', prompt: 'Continue the browser login handoff work.',
    sourceType: 'brain', confidence: 0.72, freshnessAt: '2026-09-02T15:30:00.000Z',
  },
  {
    id: 'gh-1', label: 'Review PR 305 model selector', prompt: 'Review PR 305 against main.',
    sourceType: 'github', sourceRef: 'XposeMarket/PromSRC#305', confidence: 0.94, freshnessAt: '2026-09-02T15:45:00.000Z',
  },
  {
    id: 'expired', label: 'Fix already-finished work', prompt: 'Do stale work.',
    sourceType: 'task', confidence: 1, freshnessAt: '2026-09-01T15:45:00.000Z', expiresAt: '2026-09-02T15:00:00.000Z',
  },
], 3, now);
assert.equal(ranked[0]?.id, 'gh-1');
assert.equal(ranked.some((rec) => rec.id === 'expired'), false);

const recs = buildRecommendations({
  now,
  brainCards: [
    { title: 'Dig Into a Recent Thread', body: 'Browser auth needs follow-up.', prompt: 'Inspect the current browser auth handoff and recommend the next step.', kind: 'wonder', source: '2026-09-02/12-00' },
  ],
});
assert.equal(recs.length, 1);
assert.match(recs[0].label, /^Continue /);
assert.equal(recs[0].sourceType, 'brain');
assert.ok(recs[0].id.startsWith('rec_'));

const dupes: Recommendation[] = [
  { id: 'weak', label: 'Review PR 300', prompt: 'Review it.', sourceType: 'github', sourceRef: 'repo#300', confidence: 0.8, freshnessAt: now.toISOString() },
  { id: 'strong', label: 'Review PR 300', prompt: 'Review it with the latest findings.', sourceType: 'github', sourceRef: 'repo#300', confidence: 0.95, freshnessAt: now.toISOString() },
];
assert.equal(rankRecommendations(dupes, 3, now)[0]?.id, 'strong');

const oldBrain = recommendationFromBrainPulseCard({
  title: 'Revisit an old Brain card', body: 'Old context.', prompt: 'Review the old Brain context.', source: '2026-08-20/12-00',
}, now);
const freshBrain = recommendationFromBrainPulseCard({
  title: 'Continue a fresh Brain card', body: 'Fresh context.', prompt: 'Review the fresh Brain context.', source: '2026-09-02/15-30',
}, now);
assert.ok(oldBrain && freshBrain);
assert.ok(Date.parse(oldBrain.freshnessAt) < Date.parse(freshBrain.freshnessAt));
assert.equal(rankRecommendations([oldBrain, freshBrain], 2, now)[0]?.id, freshBrain.id);
assert.equal((oldBrain.metadata as any)?.freshnessSource, 'source');

console.log('recommendation-service regression: ok');
