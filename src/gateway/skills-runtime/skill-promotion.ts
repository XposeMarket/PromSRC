import { rankSkillMatches, type SkillsManager } from './skills-manager';
import { getSkillRoutingEvidence, sha, type RoutingEvidenceResult } from '../learning/turn-recorder';
import type { RoutingOriginalResolver, SkillCuratorSuggestion } from './skill-curator';

export interface SkillReplayReport {
  passed: boolean;
  checkedAt: string;
  errors: string[];
  positive: Array<{ promptHash: string; passed: boolean }>;
  negative: Array<{ promptHash: string; passed: boolean }>;
  holdout: Array<{ turnId: string; requestHash: string; skillId: string; beforeRank: number; afterRank: number; passed: boolean }>;
}

/** Pure preflight: evaluate the proposed in-memory catalog, never mutate skill files. */
export function evaluateSkillPromotion(manager: SkillsManager, suggestion: SkillCuratorSuggestion, evidence: RoutingEvidenceResult, resolveOriginal: RoutingOriginalResolver): SkillReplayReport {
  const report: SkillReplayReport = { passed: false, checkedAt: new Date().toISOString(), errors: [], positive: [], negative: [], holdout: [] };
  const before = manager.getAll();
  const target = manager.get(suggestion.skillId);
  if (!target) { report.errors.push('Target skill is unavailable.'); return report; }
  const overlay = suggestion.change.manifest || {};
  const after = before.map(skill => skill.id === target.id ? { ...skill, ...overlay, manifest: { ...skill.manifest, ...overlay }, id: skill.id } as typeof skill : skill);
  const positive = suggestion.triggerEvaluation?.positive.map(p => p.prompt) || [];
  const negative = suggestion.triggerEvaluation?.negative.map(p => p.prompt) || [];
  if (!positive.length || !negative.length) report.errors.push('Positive AND negative trigger examples required before promotion.');
  if (positive.length > 12 || negative.length > 12 || [...positive, ...negative].some(p => typeof p !== 'string' || !p.trim() || p.length > 4000)) {
    report.errors.push('Trigger examples exceed bounded replay limits.');
    return report;
  }
  const training = new Set([...positive, ...negative].map(p => sha(p.trim())));
  if (positive.some(p => negative.includes(p))) report.errors.push('Positive and negative examples overlap.');
  for (const prompt of positive) {
    const top = rankSkillMatches(after, prompt, { limit: 1 })[0];
    report.positive.push({ promptHash: sha(prompt.trim()), passed: top?.id === target.id && top.confidence === 'high' });
  }
  for (const prompt of negative) {
    const match = rankSkillMatches(after, prompt, { limit: 6 }).find(s => s.id === target.id);
    report.negative.push({ promptHash: sha(prompt.trim()), passed: !match || match.confidence === 'low' });
  }
  if (report.positive.some(p => !p.passed) || report.negative.some(p => !p.passed)) report.errors.push('Trigger evaluation failed against current catalog.');
  if (evidence.scan.partial) report.errors.push('Routing evidence scan incomplete.');
  const samples = evidence.filter(turn => turn.routingMatched && !training.has(turn.requestHash) && turn.reviews.some(r => r.relevance === 'relevant' && r.nativeReviewed === true)).sort((a, b) => a.requestHash.localeCompare(b.requestHash));
  const seen = new Set<string>();
  for (const turn of samples) {
    if (seen.has(turn.requestHash)) continue;
    seen.add(turn.requestHash);
    if (seen.size > 32) break;
    const original = resolveOriginal(turn.sessionId, turn.requestHash);
    if (!original || sha(original.request.trim()) !== turn.requestHash) { report.errors.push(`Original holdout unavailable: ${turn.turnId}`); continue; }
    const oldRanks = rankSkillMatches(before, original.request, { limit: 6 });
    const newRanks = rankSkillMatches(after, original.request, { limit: 6 });
    for (const review of turn.reviews.filter(r => r.relevance === 'relevant' && r.nativeReviewed === true)) {
      if (review.contextHash !== original.contextHash) { report.errors.push(`Holdout context mismatch: ${turn.turnId}`); continue; }
      const oldRank = oldRanks.findIndex(s => s.id === review.skillId && s.confidence !== 'low');
      const newRank = newRanks.findIndex(s => s.id === review.skillId && s.confidence !== 'low');
      const confidence = (value: string) => value === 'high' ? 2 : value === 'medium' ? 1 : 0;
      const passed = oldRank >= 0 && newRank >= 0 && newRank <= oldRank && confidence(newRanks[newRank].confidence) >= confidence(oldRanks[oldRank].confidence);
      report.holdout.push({ turnId: turn.turnId, requestHash: turn.requestHash, skillId: review.skillId, beforeRank: oldRank, afterRank: newRank, passed });
    }
  }
  if (!report.holdout.length) report.errors.push('No independent, natively-reviewed real-request holdout available.');
  if (report.holdout.some(h => !h.passed)) report.errors.push('Previously relevant routing regressed.');
  report.passed = report.errors.length === 0;
  return report;
}

export function replaySkillPromotion(workspacePath: string, manager: SkillsManager, suggestion: SkillCuratorSuggestion, resolveOriginal: RoutingOriginalResolver): SkillReplayReport {
  return evaluateSkillPromotion(manager, suggestion, getSkillRoutingEvidence(workspacePath, { days: 90, limit: 10000 }), resolveOriginal);
}
