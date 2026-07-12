import crypto from 'crypto';

export type SkillRoutingMode = 'legacy' | 'shadow' | 'active';
export type SkillRoutingConfidence = 'high' | 'medium' | 'low';

export interface SkillRoutingSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  executionEnabled?: boolean;
  implicitInvocation?: boolean;
  status?: string;
  health?: { state?: string; reason?: string };
  eligibility?: { status?: string };
}

export interface SkillRoutingRankedMatch {
  id: string;
  skill: SkillRoutingSkill;
  score: number;
  confidence: SkillRoutingConfidence;
  explicitMention: boolean;
  implicitEligible: boolean;
  domainConflict: boolean;
  matchedTriggers: string[];
  matchedDomains: string[];
}

export interface SkillRoutingSelection {
  id: string;
  reason: 'explicit_mention' | 'user_selected_relevant' | 'high_confidence_trigger';
  score: number;
  confidence: SkillRoutingConfidence;
  instructionChars: number;
  estimatedTokens: number;
}

export interface SkillRoutingReport {
  version: 1;
  mode: SkillRoutingMode;
  messageHash: string;
  selected: SkillRoutingSelection[];
  advisory: Array<{ id: string; score: number; confidence: SkillRoutingConfidence; reason: string }>;
  excluded: Array<{ id: string; reason: string }>;
  discoveryRecommended: boolean;
  discoveryReason: string;
  completeInstructionsInjected: boolean;
  injectedInstructionChars: number;
  estimatedInjectedTokens: number;
}

const recentReports = new Map<string, SkillRoutingReport>();

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeIds(value: Iterable<string> | string[] | undefined): Set<string> {
  return new Set(Array.from(value || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean));
}

function isAvailable(skill: SkillRoutingSkill | undefined): skill is SkillRoutingSkill {
  return !!skill
    && skill.executionEnabled !== false
    && !['blocked', 'deprecated', 'archived'].includes(String(skill.status || '').toLowerCase())
    && !['blocked', 'quarantined', 'unsupported'].includes(String(skill.eligibility?.status || '').toLowerCase())
    && String(skill.health?.state || '').toLowerCase() !== 'blocked';
}

function isSpecializedWorkflowRequest(message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (!text || /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)[.! ]*$/.test(text.trim())) return false;
  const workflowNoun = /\b(workflow|pipeline|playbook|runbook|automation|integration|migration|deployment|reconciliation|ingestion|transcription|captions?|captioning|subtitles?|rendering|scraping|outreach|campaign|audit|diagnostic|benchmark|presentation|spreadsheet|video|animation|scheduled|scheduler|cron)\b/.test(text);
  const taskVerb = /\b(add|build|create|make|run|perform|execute|design|implement|debug|fix|migrate|automate|generate|produce|investigate|analyze|reconcile|convert|publish|deploy)\b/.test(text);
  const explicitDiscovery = /\b(find|search|list|look for|is there|do we have)\b[\s\S]{0,35}\bskills?\b/.test(text);
  return explicitDiscovery || (workflowNoun && taskVerb);
}

function isExplicitSkillInvocation(message: string, skill: SkillRoutingSkill): boolean {
  const raw = String(message || '');
  const escapedId = skill.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|\\s)(?:\\$${escapedId}|skill:${escapedId})(?=$|\\s|[.,;!?])`, 'i').test(raw)) return true;
  if (/\b(what is|what does|define|explain|tell me about|describe)\b/i.test(raw)) return false;
  const names = [skill.id.replace(/[-_]+/g, ' '), skill.name].map((value) => value.trim()).filter(Boolean);
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b(use|apply|follow|invoke|load|read|with|using|add|build|create|make|run|design|implement|debug|fix|generate|produce)\\b[\\s\\S]{0,45}\\b${escaped}\\b|\\b${escaped}\\b[\\s\\S]{0,25}\\b(skill|playbook|workflow)\\b`, 'i').test(raw);
  });
}

function isDefinitionalMention(message: string): boolean {
  return /\b(what is|what are|what does|define|explain|tell me about|describe|how does)\b/i.test(String(message || ''));
}

export function getSkillRoutingMode(): SkillRoutingMode {
  const value = String(process.env.PROMETHEUS_SKILL_ROUTING_MODE || 'active').trim().toLowerCase();
  return value === 'legacy' || value === 'shadow' || value === 'active' ? value : 'active';
}

export function resolveSkillRuntimeRouting(input: {
  skills: SkillRoutingSkill[];
  rankedMatches: SkillRoutingRankedMatch[];
  message: string;
  forcedSkillIds?: string[];
  excludedSkillIds?: Iterable<string> | string[];
}): SkillRoutingReport {
  const mode = getSkillRoutingMode();
  const excludedIds = normalizeIds(input.excludedSkillIds);
  const forcedIds = normalizeIds(input.forcedSkillIds);
  const byId = new Map(input.skills.filter(isAvailable).map((skill) => [skill.id.toLowerCase(), skill]));
  const ranked = input.rankedMatches.filter((match) => byId.has(match.id.toLowerCase()) && !excludedIds.has(match.id.toLowerCase()));
  const selected: SkillRoutingSelection[] = [];
  const selectedIds = new Set<string>();
  const excluded: Array<{ id: string; reason: string }> = Array.from(excludedIds).map((id) => ({ id, reason: 'explicitly_excluded' }));
  const select = (match: SkillRoutingRankedMatch, reason: SkillRoutingSelection['reason']) => {
    const key = match.id.toLowerCase();
    if (selectedIds.has(key) || selected.length >= 3) return;
    selectedIds.add(key);
    const instructionChars = String(match.skill.instructions || '').length;
    selected.push({ id: match.id, reason, score: match.score, confidence: match.confidence, instructionChars, estimatedTokens: Math.ceil(instructionChars / 4) });
  };

  for (const match of ranked.filter((item) => item.explicitMention && isExplicitSkillInvocation(input.message, item.skill))) select(match, 'explicit_mention');
  for (const id of forcedIds) {
    if (excludedIds.has(id) || selectedIds.has(id)) continue;
    const match = ranked.find((item) => item.id.toLowerCase() === id);
    if (match && match.confidence !== 'low') select(match, 'user_selected_relevant');
    else excluded.push({ id, reason: byId.has(id) ? 'user_selected_but_not_relevant' : 'user_selected_unavailable_or_missing' });
  }

  if (!selected.length) {
    const implicit = ranked.find((match) =>
      !isDefinitionalMention(input.message)
      && (match.confidence === 'high' || (match.confidence === 'medium' && match.score >= 65 && match.matchedTriggers.length > 0))
      && match.implicitEligible
      && !match.domainConflict
      && (match.matchedTriggers.length > 0 || match.matchedDomains.length >= 2)
    );
    if (implicit) select(implicit, 'high_confidence_trigger');
  }

  const advisory = isDefinitionalMention(input.message)
    ? []
    : ranked
        .filter((match) => !selectedIds.has(match.id.toLowerCase()) && match.confidence !== 'low')
        .slice(0, 3)
        .map((match) => ({ id: match.id, score: match.score, confidence: match.confidence, reason: match.domainConflict ? 'domain_conflict' : 'not_unambiguous' }));
  const discoveryRecommended = selected.length === 0 && isSpecializedWorkflowRequest(input.message);
  const injectedInstructionChars = selected.reduce((sum, item) => sum + item.instructionChars, 0);
  return {
    version: 1,
    mode,
    messageHash: hash(String(input.message || '')),
    selected,
    advisory,
    excluded,
    discoveryRecommended,
    discoveryReason: discoveryRecommended ? 'specialized_workflow_without_unambiguous_match' : '',
    completeInstructionsInjected: mode === 'active' && selected.length > 0,
    injectedInstructionChars: mode === 'active' ? injectedInstructionChars : 0,
    estimatedInjectedTokens: mode === 'active' ? Math.ceil(injectedInstructionChars / 4) : 0,
  };
}

export function buildActiveSkillRoutingContext(input: {
  report: SkillRoutingReport;
  skills: SkillRoutingSkill[];
}): string {
  const byId = new Map(input.skills.map((skill) => [skill.id, skill]));
  const lines = [
    '[SKILLS]',
    'Load skill instructions only when the full task matches. Explicitly named or unambiguous skills below are already loaded completely; follow them before acting. Ignore weak lexical overlap.',
  ];
  for (const selection of input.report.selected) {
    const skill = byId.get(selection.id);
    if (!skill) continue;
    lines.push('', `[ACTIVATED_SKILL id="${skill.id}" reason="${selection.reason}"]`, String(skill.instructions || ''), `[/ACTIVATED_SKILL id="${skill.id}"]`);
  }
  if (input.report.discoveryRecommended) {
    lines.push('', '[SKILL_DISCOVERY_REQUIRED]', 'No installed skill matched this specialized workflow unambiguously. Call skill_list once with a concise task-style query, inspect relevance, then call skill_read for at most one strong result before acting. If no strong result exists, continue without forcing a skill.');
  } else if (!input.report.selected.length) {
    lines.push('', 'No skill is required for this turn. Do not call skill_list or skill_read unless the task develops into a genuinely specialized workflow.');
  }
  if (input.report.advisory.length) {
    lines.push('', '[SKILL_ADVISORY]', 'These are not active instructions. Ignore them unless a concrete non-obvious procedure clearly requires one:', ...input.report.advisory.map((item) => `- ${item.id} [${item.confidence}; score ${item.score}]`));
  }
  lines.push('', 'After completing a genuinely reusable workflow with no good skill fit, offer to create one or submit an evidence-backed candidate; never mutate the skill catalog automatically.');
  return lines.join('\n');
}

export function recordSkillRoutingReport(sessionId: string, report: SkillRoutingReport): void {
  const id = String(sessionId || '').trim();
  if (!id) return;
  recentReports.delete(id);
  recentReports.set(id, report);
  while (recentReports.size > 500) recentReports.delete(recentReports.keys().next().value as string);
}

export function getSkillRoutingReport(sessionId: string | undefined): SkillRoutingReport | undefined {
  return sessionId ? recentReports.get(String(sessionId)) : undefined;
}
