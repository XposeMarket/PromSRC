/**
 * brain/skill-episodes.ts
 *
 * Structured evidence for the nightly Brain Dream's skill gardener lane.
 * Each episode records one turn where a skill was read, plus the surrounding
 * request, tool sequence, final response, and lightweight outcome hints.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getLocalDateStr } from './brain-state';

export interface SkillEpisodeToolResult {
  name: string;
  args?: unknown;
  result?: string;
  error?: boolean;
}

export interface SkillEpisodeInput {
  workspacePath: string;
  sessionId: string;
  executionMode: string;
  request: string;
  finalResponse: string;
  toolResults: SkillEpisodeToolResult[];
}

export type SkillGardenerCandidateType =
  | 'update_existing_skill'
  | 'add_resource_or_template'
  | 'add_trigger'
  | 'create_new_skill_candidate'
  | 'no_action_but_record_episode';

export interface SkillGardenerCandidate {
  id: string;
  timestamp: string;
  date: string;
  sessionId: string;
  executionMode: string;
  status: 'captured' | 'needs_review' | 'offered_to_user' | 'approved' | 'auto_applied' | 'deferred' | 'rejected';
  type: SkillGardenerCandidateType;
  confidence: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  skillId?: string;
  resourcePath?: string;
  reason: string;
  suggestedAction: string;
  requestExcerpt: string;
  finalResponseExcerpt: string;
  toolSequence: string[];
  skillsListed?: boolean;
  connectorsUsed?: string[];
  outcome?: string;
  userCorrectionHints?: string[];
  errors: Array<{ tool: string; args: string; result: string }>;
  touchedPaths: string[];
  outcomeHints: string[];
  evidence: string[];
  corroboratingSessionIds?: string[];
  signalProvenance?: Array<'user_instruction' | 'tool_error' | 'validation' | 'repeated_session' | 'submitted_review'>;
  submittedBy?: string;
  triggerPositivePrompts?: string[];
  triggerNegativePrompts?: string[];
  proposedTrigger?: string;
  businessContext?: BusinessWorkflowContext;
}

export interface SkillGardenerCandidateSubmission {
  workspacePath: string;
  sessionId: string;
  executionMode?: string;
  type: Exclude<SkillGardenerCandidateType, 'no_action_but_record_episode'>;
  skillId?: string;
  resourcePath?: string;
  confidence?: 'low' | 'medium' | 'high';
  risk?: 'low' | 'medium' | 'high';
  reason: string;
  suggestedAction: string;
  requestExcerpt?: string;
  evidence?: string[];
  submittedBy?: string;
  triggerPositivePrompts?: string[];
  triggerNegativePrompts?: string[];
  proposedTrigger?: string;
}

export interface BusinessWorkflowContext {
  detected: boolean;
  workflowKind?: 'lead_gen' | 'outreach' | 'quote' | 'invoice' | 'social' | 'ops' | 'client_delivery' | 'vendor_research' | 'project_management' | 'other';
  reason?: string;
}

export interface SkillGardenerRecordResult {
  skillEpisodeCount: number;
  workflowEpisodeRecorded: boolean;
  candidates: SkillGardenerCandidate[];
}

const MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'skill_create',
  'skill_create_bundle',
  'skill_manifest_write',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_update_metadata',
  'skill_repair_metadata',
  'write_proposal',
  'memory_write',
]);

const SKILL_TOOL_NAMES = new Set([
  'skill_list',
  'skill_read',
  'skill_inspect',
  'skill_resource_list',
  'skill_resource_read',
  'skill_audit_all',
  'skill_update_metadata',
  'skill_repair_metadata',
  'skill_manifest_write',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_create',
  'skill_create_bundle',
  'skill_import_bundle',
  'skill_export_bundle',
  'skill_update_from_source',
  'skill_candidate_submit',
  'skill_curator',
]);

const VALIDATION_TOOL_RE = /(?:^|_)(?:validate|validation|verify|verification|test|tests|lint|check|qa|smoke|build)(?:_|$)/i;
const FAILED_RESULT_RE = /^\s*(?:error|failed|blocked|unable|invalid)\b|"success"\s*:\s*false|"ok"\s*:\s*false/i;
const WORKFLOW_TOKEN_STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'could', 'from', 'have', 'into', 'just',
  'make', 'more', 'please', 'should', 'that', 'their', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'update', 'using', 'want', 'with', 'would', 'your', 'done', 'good', 'great', 'okay', 'please',
]);

function cleanSnippet(value: unknown, maxChars: number): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, maxChars);
}

function safeJson(value: unknown, maxChars: number): string {
  try {
    return JSON.stringify(value ?? {}).slice(0, maxChars);
  } catch {
    return '{}';
  }
}

function getSkillIdFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  return String(obj.id || obj.skill_id || obj.name || '').trim();
}

function getPathLikeArg(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  const raw = obj.filename || obj.name || obj.path || obj.file || obj.outputPath;
  const value = String(raw || '').trim();
  return value || null;
}

function makeCandidateId(seed: unknown): string {
  return `sg_${crypto.createHash('sha256').update(safeJson(seed, 5000)).digest('hex').slice(0, 16)}`;
}

function isExternalOrIntegrationTool(name: string): boolean {
  return (
    name.startsWith('connector_') ||
    name.startsWith('mcp__') ||
    name.startsWith('webhook_') ||
    name.includes('api') ||
    name.includes('integration') ||
    name === 'web_fetch' ||
    name === 'web_search' ||
    name === 'web_search_multi' ||
    name === 'web_search_single'
  );
}

function inferConnectorsUsed(toolResults: SkillEpisodeToolResult[]): string[] {
  const out = new Set<string>();
  for (const tr of toolResults) {
    const name = String(tr.name || '').toLowerCase();
    const connector = name.match(/^connector_([a-z0-9-]+)/)?.[1] || name.match(/^mcp__([^_]+)/)?.[1];
    if (connector) out.add(connector);
  }
  return Array.from(out).sort();
}

function inferSkillsListed(toolResults: SkillEpisodeToolResult[]): boolean {
  return toolResults.some((tr) => String(tr.name || '') === 'skill_list' && !tr.error);
}

function inferUserCorrectionHints(request: string): string[] {
  // User preferences and corrections must come from the user-authored request.
  // The assistant's own final response is output, not evidence of approval.
  const text = String(request || '').toLowerCase();
  const hints: string[] = [];
  if (/\b(next time|from now on|remember to|make sure to|always|prefer)\b/.test(text)) hints.push('explicit_reusable_instruction');
  if (/\b(wrong|not quite|instead|should have|you missed|don't do that)\b/.test(text)) hints.push('correction_or_rework_signal');
  return hints;
}

function toolResultLooksFailed(tr: SkillEpisodeToolResult): boolean {
  return tr.error === true || FAILED_RESULT_RE.test(String(tr.result || ''));
}

function isSuccessfulValidation(tr: SkillEpisodeToolResult): boolean {
  return VALIDATION_TOOL_RE.test(String(tr.name || '')) && !toolResultLooksFailed(tr);
}

function inferOutcome(toolResults: SkillEpisodeToolResult[], skillReads: Array<{ tr: SkillEpisodeToolResult; index: number }>): string {
  if (toolResults.some(toolResultLooksFailed)) return 'blocked';
  const validated = toolResults.some(isSuccessfulValidation);
  if (skillReads.length && validated) return 'skill_helped';
  if (!skillReads.length && validated) return 'skill_missing';
  if (skillReads.length) return 'skill_read';
  return 'completed';
}

function inferOutcomeHints(toolResults: SkillEpisodeToolResult[]): string[] {
  const hints = new Set<string>();
  const failedResults = toolResults.filter(toolResultLooksFailed);
  const successfulValidation = toolResults.some(isSuccessfulValidation);
  const failedValidation = toolResults.some((tr) => VALIDATION_TOOL_RE.test(String(tr.name || '')) && toolResultLooksFailed(tr));
  if (failedResults.length) hints.add('tool_error_seen');
  if (failedValidation) hints.add('validation_failed');
  if (successfulValidation) hints.add('validation_succeeded');
  if (toolResults.some((tr) => MUTATION_TOOL_NAMES.has(String(tr.name || '')) && !tr.error)) hints.add('mutation_or_proposal_made');
  if (toolResults.some((tr) => String(tr.name || '').startsWith('browser_'))) hints.add('browser_workflow');
  if (toolResults.some((tr) => String(tr.name || '').startsWith('desktop_'))) hints.add('desktop_workflow');
  if (toolResults.some((tr) => isExternalOrIntegrationTool(String(tr.name || '')))) hints.add('external_api_or_web_workflow');
  if (successfulValidation && failedResults.length === 0) hints.add('completed_signal');
  if (failedResults.length) hints.add('blocked_or_failed_signal');
  return Array.from(hints);
}

function inferBusinessWorkflowContext(request: string, toolSequence: string[]): BusinessWorkflowContext | undefined {
  // Do not let assistant-written summaries classify their own work as a business workflow.
  const text = `${request}\n${toolSequence.join(' ')}`.toLowerCase();
  const checks: Array<[BusinessWorkflowContext['workflowKind'], RegExp, string]> = [
    ['lead_gen', /\b(lead|prospect|qualif|google maps|local business|business audit)\b/, 'lead/prospect discovery or qualification signal'],
    ['outreach', /\b(outreach|cold email|follow.?up|dm|proposal|pitch|packet)\b/, 'outreach, follow-up, proposal, or pitch workflow signal'],
    ['quote', /\b(quote|estimate|pricing|proposal draft)\b/, 'quote/estimate workflow signal'],
    ['invoice', /\b(invoice|payment|billing|past due|receipt)\b/, 'invoice/payment workflow signal'],
    ['social', /\b(social|content calendar|post|x\/twitter|instagram|linkedin|tiktok)\b/, 'social/content workflow signal'],
    ['vendor_research', /\b(vendor|supplier|parts|tool|saas|provider)\b/, 'vendor/tool/supplier research signal'],
    ['client_delivery', /\b(client|customer|deliverable|onboarding|handoff)\b/, 'client delivery or onboarding signal'],
    ['project_management', /\b(project|milestone|deadline|status report|blocker)\b/, 'project management signal'],
    ['ops', /\b(operations|crm|contract|revenue|sales|business)\b/, 'general business operations signal'],
  ];
  for (const [workflowKind, pattern, reason] of checks) {
    if (pattern.test(text)) return { detected: true, workflowKind, reason };
  }
  return undefined;
}

function buildEpisodeContext(input: SkillEpisodeInput): {
  day: string;
  now: string;
  toolResults: SkillEpisodeToolResult[];
  skillReads: Array<{ tr: SkillEpisodeToolResult; index: number }>;
  toolSequence: string[];
  errors: Array<{ tool: string; args: string; result: string }>;
  touchedPaths: string[];
  outcomeHints: string[];
} | null {
  const workspacePath = String(input.workspacePath || '').trim();
  if (!workspacePath) return null;
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId || sessionId.startsWith('brain_')) return null;

  const toolResults = Array.isArray(input.toolResults) ? input.toolResults : [];
  if (!toolResults.length) return null;

  const skillReads = toolResults
    .map((tr, index) => ({ tr, index }))
    .filter(({ tr }) => String(tr?.name || '') === 'skill_read' && !tr?.error);

  const day = getLocalDateStr();
  const now = new Date().toISOString();
  const toolSequence = toolResults.map((tr) => String(tr?.name || 'unknown')).slice(0, 160);
  const errors = toolResults
    .filter(toolResultLooksFailed)
    .map((tr) => ({
      tool: String(tr.name || 'unknown'),
      args: safeJson(tr.args, 240),
      result: cleanSnippet(tr.result, 500),
    }))
    .slice(0, 16);
  const touchedPaths = Array.from(new Set(
    toolResults
      .filter((tr) => MUTATION_TOOL_NAMES.has(String(tr.name || '')) && !tr.error)
      .map((tr) => getPathLikeArg(tr.args))
      .filter((value): value is string => !!value),
  )).slice(0, 40);
  const outcomeHints = inferOutcomeHints(toolResults);
  return { day, now, toolResults, skillReads, toolSequence, errors, touchedPaths, outcomeHints };
}

function appendJsonl(filePath: string, rows: unknown[]): void {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8');
}

function recordSkillReadEpisodes(input: SkillEpisodeInput, ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>): number {
  const skillReads = ctx.skillReads;
  if (!skillReads.length) return 0;
  const outDir = path.join(input.workspacePath, 'Brain', 'skill-episodes', ctx.day);
  const outPath = path.join(outDir, 'episodes.jsonl');
  const seenSkillIds = new Set<string>();
  const rows: unknown[] = [];

  for (const { tr, index } of skillReads) {
    const skillId = getSkillIdFromArgs(tr.args);
    if (!skillId || seenSkillIds.has(skillId)) continue;
    seenSkillIds.add(skillId);
    const skillContent = String(tr.result || '');
    const contentHash = crypto.createHash('sha256').update(skillContent).digest('hex').slice(0, 16);
    rows.push({
      timestamp: ctx.now,
      date: ctx.day,
      sessionId: input.sessionId,
      executionMode: String(input.executionMode || 'interactive'),
      skillId,
      skillReadIndex: index,
      skillContentHash: contentHash,
      skillExcerpt: cleanSnippet(skillContent, 900),
      requestExcerpt: cleanSnippet(input.request, 1200),
      finalResponseExcerpt: cleanSnippet(input.finalResponse, 1200),
      toolSequence: ctx.toolSequence,
      skillsListed: inferSkillsListed(ctx.toolResults),
      connectorsUsed: inferConnectorsUsed(ctx.toolResults),
      outcome: inferOutcome(ctx.toolResults, ctx.skillReads),
      userCorrectionHints: inferUserCorrectionHints(input.request),
      errors: ctx.errors,
      touchedPaths: ctx.touchedPaths,
      outcomeHints: ctx.outcomeHints,
      businessContext: inferBusinessWorkflowContext(input.request, ctx.toolSequence),
    });
  }

  appendJsonl(outPath, rows);
  return rows.length;
}

function shouldRecordWorkflowEpisode(ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>): boolean {
  const nonSkillTools = ctx.toolSequence.filter((name) => !SKILL_TOOL_NAMES.has(name));
  if (ctx.skillReads.length > 0) return true;
  if (nonSkillTools.length >= 5) return true;
  if (ctx.outcomeHints.includes('browser_workflow') || ctx.outcomeHints.includes('desktop_workflow')) return true;
  if (ctx.outcomeHints.includes('external_api_or_web_workflow') && nonSkillTools.length >= 3) return true;
  if (ctx.outcomeHints.includes('mutation_or_proposal_made') && nonSkillTools.length >= 3) return true;
  return false;
}

function recordWorkflowEpisode(input: SkillEpisodeInput, ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>): boolean {
  if (!shouldRecordWorkflowEpisode(ctx)) return false;
  const outPath = path.join(input.workspacePath, 'Brain', 'skill-gardener', ctx.day, 'workflow-episodes.jsonl');
  appendJsonl(outPath, [{
    id: makeCandidateId({ kind: 'workflow_episode', sessionId: input.sessionId, request: input.request, tools: ctx.toolSequence, now: ctx.now }),
    timestamp: ctx.now,
    date: ctx.day,
    sessionId: input.sessionId,
    executionMode: String(input.executionMode || 'interactive'),
    requestExcerpt: cleanSnippet(input.request, 1600),
    finalResponseExcerpt: cleanSnippet(input.finalResponse, 1600),
    skillsRead: ctx.skillReads.map(({ tr }) => getSkillIdFromArgs(tr.args)).filter(Boolean),
    toolSequence: ctx.toolSequence,
    skillsListed: inferSkillsListed(ctx.toolResults),
    connectorsUsed: inferConnectorsUsed(ctx.toolResults),
    outcome: inferOutcome(ctx.toolResults, ctx.skillReads),
    userCorrectionHints: inferUserCorrectionHints(input.request),
    errors: ctx.errors,
    touchedPaths: ctx.touchedPaths,
    outcomeHints: ctx.outcomeHints,
    businessContext: inferBusinessWorkflowContext(input.request, ctx.toolSequence),
  }]);
  return true;
}

function workflowTokens(value: unknown): Set<string> {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !WORKFLOW_TOKEN_STOPWORDS.has(word))
    .slice(0, 40));
}

function workflowRequestsOverlap(a: unknown, b: unknown): boolean {
  const left = workflowTokens(a);
  const right = workflowTokens(b);
  if (left.size < 2 || right.size < 2) return false;
  const shared = Array.from(left).filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return shared >= 2 && shared / Math.max(1, union) >= 0.3;
}

function corroboratingWorkflowSessions(
  input: SkillEpisodeInput,
  ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>,
  skillId?: string,
  days = 30,
): string[] {
  const root = path.join(input.workspacePath, 'Brain', 'skill-gardener');
  if (!fs.existsSync(root)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = new Set<string>();
  for (const day of fs.readdirSync(root)) {
    const dayTs = Date.parse(`${day}T00:00:00`);
    if (Number.isFinite(dayTs) && dayTs < cutoff) continue;
    const filePath = path.join(root, day, 'workflow-episodes.jsonl');
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row: any;
      try { row = JSON.parse(line); } catch { continue; }
      const sessionId = String(row?.sessionId || '').trim();
      if (!sessionId || sessionId === input.sessionId) continue;
      if (!Array.isArray(row?.outcomeHints) || !row.outcomeHints.includes('validation_succeeded')) continue;
      const skillsRead = Array.isArray(row?.skillsRead) ? row.skillsRead.map(String) : [];
      if (skillId ? !skillsRead.includes(skillId) : skillsRead.length > 0) continue;
      if (!workflowRequestsOverlap(input.request, row.requestExcerpt)) continue;
      sessions.add(sessionId);
    }
  }
  return Array.from(sessions).sort();
}

function confidenceFor(
  ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>,
  evidence: { explicitUserInstruction?: boolean; corroboratingSessions?: number } = {},
): 'low' | 'medium' | 'high' {
  if (ctx.outcomeHints.includes('blocked_or_failed_signal') || ctx.errors.length) return 'medium';
  if (evidence.explicitUserInstruction) return 'high';
  if (ctx.outcomeHints.includes('validation_succeeded') && (evidence.corroboratingSessions || 0) > 0) return 'high';
  return 'medium';
}

function makeCandidate(
  input: SkillEpisodeInput,
  ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>,
  partial: Omit<SkillGardenerCandidate, 'id' | 'timestamp' | 'date' | 'sessionId' | 'executionMode' | 'status' | 'requestExcerpt' | 'finalResponseExcerpt' | 'toolSequence' | 'errors' | 'touchedPaths' | 'outcomeHints' | 'evidence'> & {
    status?: SkillGardenerCandidate['status'];
    evidence?: string[];
  },
): SkillGardenerCandidate {
  const seed = {
    type: partial.type,
    skillId: partial.skillId,
    resourcePath: partial.resourcePath,
    request: cleanSnippet(input.request, 300),
    tools: ctx.toolSequence,
    reason: partial.reason,
  };
  return {
    id: makeCandidateId(seed),
    timestamp: ctx.now,
    date: ctx.day,
    sessionId: input.sessionId,
    executionMode: String(input.executionMode || 'interactive'),
    status: partial.status || 'captured',
    requestExcerpt: cleanSnippet(input.request, 1400),
    finalResponseExcerpt: cleanSnippet(input.finalResponse, 1400),
    toolSequence: ctx.toolSequence,
    skillsListed: inferSkillsListed(ctx.toolResults),
    connectorsUsed: inferConnectorsUsed(ctx.toolResults),
    outcome: inferOutcome(ctx.toolResults, ctx.skillReads),
    userCorrectionHints: inferUserCorrectionHints(input.request),
    errors: ctx.errors,
    touchedPaths: ctx.touchedPaths,
    outcomeHints: ctx.outcomeHints,
    evidence: partial.evidence || [
      `Brain/skill-gardener/${ctx.day}/workflow-episodes.jsonl`,
      ...(ctx.skillReads.length ? [`Brain/skill-episodes/${ctx.day}/episodes.jsonl`] : []),
    ],
    ...partial,
  };
}

function inferCandidates(input: SkillEpisodeInput, ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>): SkillGardenerCandidate[] {
  const candidates: SkillGardenerCandidate[] = [];
  const skillReadIds = Array.from(new Set(ctx.skillReads.map(({ tr }) => getSkillIdFromArgs(tr.args)).filter(Boolean)));
  const validated = ctx.outcomeHints.includes('validation_succeeded') && !ctx.outcomeHints.includes('validation_failed');
  const explicitReusableInstruction = inferUserCorrectionHints(input.request).includes('explicit_reusable_instruction');
  const businessContext = inferBusinessWorkflowContext(input.request, ctx.toolSequence);
  const hadErrors = ctx.errors.length > 0 || ctx.outcomeHints.includes('blocked_or_failed_signal');
  const hadWorkflowTools = ctx.outcomeHints.some((hint) => (
    hint === 'browser_workflow' ||
    hint === 'desktop_workflow' ||
    hint === 'external_api_or_web_workflow' ||
    hint === 'mutation_or_proposal_made' ||
    hint === 'validation_succeeded'
  ));

  for (const skillId of skillReadIds) {
    const corroboratingSessionIds = corroboratingWorkflowSessions(input, ctx, skillId);
    if (hadErrors) {
      candidates.push(makeCandidate(input, ctx, {
        type: 'update_existing_skill',
        confidence: confidenceFor(ctx),
        risk: 'medium',
        skillId,
        reason: `Skill "${skillId}" was used in a run with errors, blockers, or rework signals.`,
        suggestedAction: `Review the current ${skillId} playbook and add a focused troubleshooting note, guardrail, or tool-order correction for the observed failure pattern.`,
        signalProvenance: ['tool_error'],
      }));
    }

    if ((hadWorkflowTools || explicitReusableInstruction) && (explicitReusableInstruction || (validated && corroboratingSessionIds.length > 0))) {
      candidates.push(makeCandidate(input, ctx, {
        type: 'add_resource_or_template',
        confidence: confidenceFor(ctx, {
          explicitUserInstruction: explicitReusableInstruction,
          corroboratingSessions: corroboratingSessionIds.length,
        }),
        risk: 'medium',
        skillId,
        reason: explicitReusableInstruction
          ? `The user explicitly requested reusable future behavior for skill "${skillId}".`
          : `A validated workflow using skill "${skillId}" recurred across distinct sessions.`,
        suggestedAction: `Curator should review whether a compact example, checklist, or template belongs in ${skillId}; do not mutate the skill directly.`,
        corroboratingSessionIds,
        signalProvenance: [
          ...(explicitReusableInstruction ? ['user_instruction' as const] : []),
          ...(validated ? ['validation' as const] : []),
          ...(corroboratingSessionIds.length ? ['repeated_session' as const] : []),
        ],
      }));
    }
  }

  const noSkillCorroboratingSessions = skillReadIds.length ? [] : corroboratingWorkflowSessions(input, ctx);
  if (!skillReadIds.length && validated && hadWorkflowTools && noSkillCorroboratingSessions.length > 0) {
    candidates.push(makeCandidate(input, ctx, {
      type: 'create_new_skill_candidate',
      confidence: confidenceFor(ctx, { corroboratingSessions: noSkillCorroboratingSessions.length }),
      risk: 'medium',
      reason: 'A validated workflow recurred across distinct sessions without an active skill.',
      suggestedAction: 'Curator should perform overlap analysis before offering a review-only new-skill proposal. No skill may be created automatically.',
      corroboratingSessionIds: noSkillCorroboratingSessions,
      signalProvenance: ['validation', 'repeated_session'],
    }));
  }

  if (businessContext?.detected && hadWorkflowTools && (explicitReusableInstruction || (validated && (skillReadIds.length
    ? corroboratingWorkflowSessions(input, ctx, skillReadIds[0]).length > 0
    : noSkillCorroboratingSessions.length > 0)))) {
    const corroboratingSessionIds = skillReadIds.length
      ? corroboratingWorkflowSessions(input, ctx, skillReadIds[0])
      : noSkillCorroboratingSessions;
    candidates.push(makeCandidate(input, ctx, {
      type: skillReadIds.length ? 'add_resource_or_template' : 'create_new_skill_candidate',
      confidence: confidenceFor(ctx, {
        explicitUserInstruction: explicitReusableInstruction,
        corroboratingSessions: corroboratingSessionIds.length,
      }),
      risk: 'medium',
      skillId: skillReadIds[0],
      reason: `Business workflow detected (${businessContext.workflowKind || 'other'}): ${businessContext.reason || 'reusable business process signal'}.`,
      suggestedAction: skillReadIds.length
        ? `Consider adding a business workflow example/template to ${skillReadIds[0]} so Prometheus can repeat this operating pattern for the user's business.`
        : 'Consider a new business workflow skill proposal with triggers, permissions, approval boundaries, templates, and entity/BUSINESS.md routing guidance.',
      businessContext,
      corroboratingSessionIds,
      signalProvenance: [
        ...(explicitReusableInstruction ? ['user_instruction' as const] : []),
        ...(validated ? ['validation' as const] : []),
        ...(corroboratingSessionIds.length ? ['repeated_session' as const] : []),
      ],
    }));
  }

  if (!candidates.length && shouldRecordWorkflowEpisode(ctx)) {
    candidates.push(makeCandidate(input, ctx, {
      type: 'no_action_but_record_episode',
      confidence: 'low',
      risk: 'low',
      reason: 'Workflow evidence was worth keeping, but no immediate skill update was obvious.',
      suggestedAction: 'Keep as raw evidence for nightly Brain synthesis; do not update skills unless repeated evidence appears.',
    }));
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function recordLiveCandidates(input: SkillEpisodeInput, ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>): SkillGardenerCandidate[] {
  const candidates = inferCandidates(input, ctx);
  if (!candidates.length) return [];
  const actionable = candidates.filter((candidate) => candidate.type !== 'no_action_but_record_episode');
  const outPath = path.join(input.workspacePath, 'Brain', 'skill-gardener', ctx.day, 'live-candidates.jsonl');
  appendJsonl(outPath, candidates);
  return actionable;
}

export function submitSkillGardenerCandidate(input: SkillGardenerCandidateSubmission): SkillGardenerCandidate {
  const workspacePath = String(input.workspacePath || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const reason = cleanSnippet(input.reason, 1200);
  const suggestedAction = cleanSnippet(input.suggestedAction, 1600);
  if (!workspacePath) throw new Error('workspacePath is required');
  if (!sessionId) throw new Error('sessionId is required');
  if (!reason) throw new Error('reason is required');
  if (!suggestedAction) throw new Error('suggestedAction is required');
  const allowedTypes = new Set<SkillGardenerCandidateType>([
    'update_existing_skill',
    'add_resource_or_template',
    'add_trigger',
    'create_new_skill_candidate',
  ]);
  if (!allowedTypes.has(input.type)) throw new Error(`unsupported candidate type: ${String(input.type || '(missing)')}`);
  if ((input.type === 'update_existing_skill' || input.type === 'add_resource_or_template' || input.type === 'add_trigger') && !String(input.skillId || '').trim()) {
    throw new Error(`${input.type} requires skillId`);
  }
  if (input.type === 'add_trigger') {
    if (!String(input.proposedTrigger || '').trim()) throw new Error('add_trigger requires proposedTrigger');
    if (!(input.triggerPositivePrompts || []).length || !(input.triggerNegativePrompts || []).length) {
      throw new Error('add_trigger requires positive and negative prompt sets');
    }
  }

  const now = new Date().toISOString();
  const day = getLocalDateStr();
  const evidence = Array.from(new Set((input.evidence || []).map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 20);
  const candidate: SkillGardenerCandidate = {
    id: makeCandidateId({
      submitted: true,
      type: input.type,
      skillId: input.skillId,
      resourcePath: input.resourcePath,
      reason,
      suggestedAction,
    }),
    timestamp: now,
    date: day,
    sessionId,
    executionMode: String(input.executionMode || 'candidate_submission'),
    status: 'needs_review',
    type: input.type,
    confidence: input.confidence || 'medium',
    risk: input.risk || (input.type === 'create_new_skill_candidate' ? 'high' : 'medium'),
    skillId: String(input.skillId || '').trim() || undefined,
    resourcePath: String(input.resourcePath || '').trim() || undefined,
    reason,
    suggestedAction,
    requestExcerpt: cleanSnippet(input.requestExcerpt, 1400),
    finalResponseExcerpt: '',
    toolSequence: ['skill_candidate_submit'],
    skillsListed: false,
    connectorsUsed: [],
    outcome: 'candidate_submitted',
    userCorrectionHints: [],
    errors: [],
    touchedPaths: [],
    outcomeHints: ['candidate_only', 'pending_review'],
    evidence,
    signalProvenance: ['submitted_review'],
    submittedBy: cleanSnippet(input.submittedBy || sessionId, 120),
    triggerPositivePrompts: (input.triggerPositivePrompts || []).map((item) => cleanSnippet(item, 300)).filter(Boolean).slice(0, 12),
    triggerNegativePrompts: (input.triggerNegativePrompts || []).map((item) => cleanSnippet(item, 300)).filter(Boolean).slice(0, 12),
    proposedTrigger: cleanSnippet(input.proposedTrigger, 160) || undefined,
  };
  const outPath = path.join(workspacePath, 'Brain', 'skill-gardener', day, 'live-candidates.jsonl');
  appendJsonl(outPath, [candidate]);
  return candidate;
}

export function recordSkillGardenerTurn(input: SkillEpisodeInput): SkillGardenerRecordResult {
  const empty: SkillGardenerRecordResult = {
    skillEpisodeCount: 0,
    workflowEpisodeRecorded: false,
    candidates: [],
  };
  try {
    const ctx = buildEpisodeContext(input);
    if (!ctx) return empty;
    const skillEpisodeCount = recordSkillReadEpisodes(input, ctx);
    const workflowEpisodeRecorded = recordWorkflowEpisode(input, ctx);
    const candidates = recordLiveCandidates(input, ctx);
    return {
      skillEpisodeCount,
      workflowEpisodeRecorded,
      candidates,
    };
  } catch (err: any) {
    console.warn('[BrainSkillGardener] Failed to record live skill signal:', err?.message || err);
    return empty;
  }
}

export function recordSkillEpisodes(input: SkillEpisodeInput): SkillGardenerRecordResult {
  const empty: SkillGardenerRecordResult = {
    skillEpisodeCount: 0,
    workflowEpisodeRecorded: false,
    candidates: [],
  };
  try {
    const workspacePath = String(input.workspacePath || '').trim();
    if (!workspacePath) return empty;
    const sessionId = String(input.sessionId || '').trim();
    if (!sessionId || sessionId.startsWith('brain_')) return empty;

    return recordSkillGardenerTurn(input);
  } catch (err: any) {
    console.warn('[BrainSkillEpisodes] Failed to record skill episode:', err?.message || err);
    return empty;
  }
}
