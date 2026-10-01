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
  promptSignalScore?: number;
  promptSignalEvidence?: string[];
  matchedDomains: string[];
}

export interface SkillRoutingCandidate {
  id: string;
  reason: 'explicit_mention' | 'user_selected_relevant' | 'strong_trigger_match' | 'plausible_trigger_match';
  score: number;
  confidence: SkillRoutingConfidence;
  instructionChars: number;
  estimatedTokens: number;
  promptSignalEvidence?: string[];
}

export interface SkillRoutingReport {
  version: 2;
  mode: SkillRoutingMode;
  messageHash: string;
  candidates: SkillRoutingCandidate[];
  excluded: Array<{ id: string; reason: string }>;
  discoveryRecommended: boolean;
  discoveryReason: string;
  autoInjectedInstructions: false;
  instructionsRequireSkillRead: true;
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

const LEADING_FILLER = String.raw`^(?:(?:please|pls|ok(?:ay)?(?:\s+so)?|alright|yo|hey|beautiful|right now|when you can|so|and|also|now|can you|could you|would you|will you|go ahead and|i need you to|i want you to)[,!.]?\s+)*`;
const NON_TASK_OPENER = new RegExp(`${LEADING_FILLER}(?:did|does|is|are|was|were|what|why|who|when|where|how|do not|don't|dont|never)\\b`, 'i');
const TASK_VERB = /\b(fix|debug|build|implement|investigate|look into|dig into|audit|review|test|refactor|deploy|ship|release|research|analy[sz]e|migrate|set up|setup|configure|clean ?up|update|upgrade|create|make|generate|produce|design|automate|scrape|convert|publish|optimi[sz]e|profile|diagnose|troubleshoot|verify|validate|benchmark|draft|plan|integrate|install|monitor|reconcile|port|rewrite|add|remove|delete|organi[sz]e|edit|compare|evaluate|summari[sz]e (?:this|these|the) (?:repo|codebase|logs?|pdf|docs?|documents?|files?|meeting|thread|inbox))\b/i;

/**
 * True for real work requests (build/fix/investigate/test/research/...), false for
 * greetings, questions, definitions, and negations. Actionable tasks should always
 * check the skill catalog, even when no trigger matched.
 */
export function isActionableTaskRequest(message: string): boolean {
  const text = String(message || '').trim();
  if (!text || text.split(/\s+/).length < 3) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yo|lol|nice)[.! ]*$/i.test(text)) return false;
  if (isDefinitionalMention(text)) return false;
  if (NON_TASK_OPENER.test(text)) return false;
  return TASK_VERB.test(text);
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
  const candidates: SkillRoutingCandidate[] = [];
  const candidateIds = new Set<string>();
  const excluded: Array<{ id: string; reason: string }> = Array.from(excludedIds).map((id) => ({ id, reason: 'explicitly_excluded' }));
  const addCandidate = (match: SkillRoutingRankedMatch, reason: SkillRoutingCandidate['reason']) => {
    const key = match.id.toLowerCase();
    if (candidateIds.has(key) || candidates.length >= 4) return;
    candidateIds.add(key);
    const instructionChars = String(match.skill.instructions || '').length;
    candidates.push({
      id: match.id,
      reason,
      score: match.score,
      confidence: match.confidence,
      instructionChars,
      estimatedTokens: Math.ceil(instructionChars / 4),
      promptSignalEvidence: match.promptSignalEvidence,
    });
  };

  for (const match of ranked.filter((item) => item.explicitMention && isExplicitSkillInvocation(input.message, item.skill))) addCandidate(match, 'explicit_mention');
  for (const id of forcedIds) {
    if (excludedIds.has(id) || candidateIds.has(id)) continue;
    const match = ranked.find((item) => item.id.toLowerCase() === id);
    if (match && match.confidence !== 'low') addCandidate(match, 'user_selected_relevant');
    else excluded.push({ id, reason: byId.has(id) ? 'user_selected_but_not_relevant' : 'user_selected_unavailable_or_missing' });
  }

  if (!isDefinitionalMention(input.message)) {
    for (const match of ranked) {
      const hasPromptSignal = (match.promptSignalEvidence?.length || 0) > 0;
      if (!match.implicitEligible || (match.domainConflict && !hasPromptSignal) || candidateIds.has(match.id.toLowerCase())) continue;
      const strong = match.confidence === 'high' && (hasPromptSignal || match.matchedTriggers.length > 0 || match.matchedDomains.length >= 2);
      const plausible = match.confidence === 'medium' && match.score >= 45 && (hasPromptSignal || match.matchedTriggers.length > 0);
      if (strong) addCandidate(match, 'strong_trigger_match');
      else if (plausible) addCandidate(match, 'plausible_trigger_match');
    }
  }

  const discoveryRecommended = candidates.length === 0
    && (isSpecializedWorkflowRequest(input.message) || isActionableTaskRequest(input.message));
  return {
    version: 2,
    mode,
    messageHash: hash(String(input.message || '')),
    candidates,
    excluded,
    discoveryRecommended,
    discoveryReason: discoveryRecommended ? 'specialized_workflow_without_unambiguous_match' : '',
    autoInjectedInstructions: false,
    instructionsRequireSkillRead: true,
  };
}

export function buildActiveSkillRoutingContext(input: {
  report: SkillRoutingReport;
  skills: SkillRoutingSkill[];
}): string {
  const byId = new Map(input.skills.map((skill) => [skill.id, skill]));
  const lines = [
    '[SKILLS]',
    'Skills are tested playbooks for how work gets done here. For any actual task (build, fix, investigate, test, research, review, write, automate, deploy, clean up), check skills before the first action and read EVERY skill whose procedure covers a part of the task. Real tasks often need two or three: a domain skill for what you are working on plus workflow skills for how (for example a coding-loop skill for code edits, a verification skill before claiming done, a PR/worktree skill for source changes). Read them together in one parallel batch. Skip a candidate only when it shares words with the request but not the work. Skip skills for greetings, small talk, and quick factual answers.',
  ];
  if (input.report.candidates.length) {
    lines.push('', '[MATCHING_SKILLS] — candidates only; instructions are not loaded');
    for (const candidate of input.report.candidates) {
      const skill = byId.get(candidate.id);
      if (!skill) continue;
      const evidence = candidate.promptSignalEvidence?.length ? `; matched ${candidate.promptSignalEvidence.join(', ')}` : '';
      lines.push(`- ${skill.id} [${candidate.reason}; ${candidate.confidence}; score ${candidate.score}${evidence}] — ${skill.description || skill.name}`);
    }
    lines.push('Call skill_read for every candidate above that covers part of this task, in one parallel batch, before acting. If a phase of the task (testing, verification, deployment, review) has no candidate, call skill_list for that phase too. An explicitly requested skill must be read unless it is unavailable or excluded.');
  }
  if (input.report.discoveryRecommended) {
    lines.push('', '[SKILL_DISCOVERY_REQUIRED]', 'This is an actionable task and no installed skill matched by trigger. Before acting, call skill_list with a concise task-style query (one query per distinct phase if the task spans several, in parallel), then skill_read every strong result that covers part of the task. If nothing strong comes back, continue without a skill and, if the workflow proved reusable, offer to create one afterwards.');
  } else if (!input.report.candidates.length) {
    lines.push('', 'No skill is required for this turn. Do not call skill_list or skill_read unless the task develops into a genuinely specialized workflow.');
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
