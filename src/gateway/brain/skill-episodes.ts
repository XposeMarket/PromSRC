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
  userFacingOffer?: string;
}

export interface SkillGardenerRecordResult {
  skillEpisodeCount: number;
  workflowEpisodeRecorded: boolean;
  candidates: SkillGardenerCandidate[];
  offerText?: string;
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
  'write_proposal',
  'memory_write',
]);

const SKILL_TOOL_NAMES = new Set([
  'skill_list',
  'skill_read',
  'skill_inspect',
  'skill_resource_list',
  'skill_resource_read',
  'skill_manifest_write',
  'skill_resource_write',
  'skill_resource_delete',
  'skill_create',
  'skill_create_bundle',
  'skill_import_bundle',
  'skill_export_bundle',
  'skill_update_from_source',
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

function inferUserCorrectionHints(request: string, finalResponse: string): string[] {
  const text = `${request}\n${finalResponse}`.toLowerCase();
  const hints: string[] = [];
  if (/\b(next time|from now on|remember to|make sure to|always|prefer)\b/.test(text)) hints.push('explicit_reusable_instruction');
  if (/\b(wrong|not quite|instead|should have|you missed|don't do that)\b/.test(text)) hints.push('correction_or_rework_signal');
  return hints;
}

function inferOutcome(toolResults: SkillEpisodeToolResult[], finalResponse: string, skillReads: Array<{ tr: SkillEpisodeToolResult; index: number }>): string {
  if (toolResults.some((tr) => tr.error) || /\b(failed|blocked|unable|could not|error)\b/i.test(finalResponse)) return 'blocked';
  if (skillReads.length && /\b(done|completed|fixed|created|updated|implemented|ready)\b/i.test(finalResponse)) return 'skill_helped';
  if (!skillReads.length && toolResults.length >= 5 && /\b(done|completed|fixed|created|updated|implemented|ready)\b/i.test(finalResponse)) return 'skill_missing';
  if (skillReads.length) return 'skill_read';
  return 'completed';
}

function inferOutcomeHints(toolResults: SkillEpisodeToolResult[], finalResponse: string): string[] {
  const hints = new Set<string>();
  if (toolResults.some((tr) => tr.error)) hints.add('tool_error_seen');
  if (toolResults.some((tr) => MUTATION_TOOL_NAMES.has(String(tr.name || '')) && !tr.error)) hints.add('mutation_or_proposal_made');
  if (toolResults.some((tr) => String(tr.name || '').startsWith('browser_'))) hints.add('browser_workflow');
  if (toolResults.some((tr) => String(tr.name || '').startsWith('desktop_'))) hints.add('desktop_workflow');
  if (toolResults.some((tr) => isExternalOrIntegrationTool(String(tr.name || '')))) hints.add('external_api_or_web_workflow');
  if (/\b(done|completed|fixed|created|updated|implemented|ready)\b/i.test(finalResponse)) hints.add('completed_signal');
  if (/\b(could not|failed|error|blocked|unable)\b/i.test(finalResponse)) hints.add('blocked_or_failed_signal');
  if (/\b(worked|nice|perfect|great|good run|that's it|exactly|fire)\b/i.test(finalResponse)) hints.add('positive_signal');
  return Array.from(hints);
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
    .filter((tr) => tr?.error)
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
  const outcomeHints = inferOutcomeHints(toolResults, input.finalResponse);
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
      outcome: inferOutcome(ctx.toolResults, input.finalResponse, ctx.skillReads),
      userCorrectionHints: inferUserCorrectionHints(input.request, input.finalResponse),
      errors: ctx.errors,
      touchedPaths: ctx.touchedPaths,
      outcomeHints: ctx.outcomeHints,
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
    outcome: inferOutcome(ctx.toolResults, input.finalResponse, ctx.skillReads),
    userCorrectionHints: inferUserCorrectionHints(input.request, input.finalResponse),
    errors: ctx.errors,
    touchedPaths: ctx.touchedPaths,
    outcomeHints: ctx.outcomeHints,
  }]);
  return true;
}

function confidenceFor(ctx: NonNullable<ReturnType<typeof buildEpisodeContext>>, base: 'low' | 'medium' | 'high' = 'medium'): 'low' | 'medium' | 'high' {
  if (ctx.outcomeHints.includes('blocked_or_failed_signal') || ctx.errors.length) return base === 'high' ? 'medium' : base;
  if (ctx.outcomeHints.includes('completed_signal') && ctx.outcomeHints.includes('mutation_or_proposal_made')) return 'high';
  if (ctx.outcomeHints.includes('completed_signal') && ctx.toolSequence.length >= 6) return 'high';
  return base;
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
    outcome: inferOutcome(ctx.toolResults, input.finalResponse, ctx.skillReads),
    userCorrectionHints: inferUserCorrectionHints(input.request, input.finalResponse),
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
  const hasSkillList = ctx.toolSequence.includes('skill_list');
  const skillReadIds = Array.from(new Set(ctx.skillReads.map(({ tr }) => getSkillIdFromArgs(tr.args)).filter(Boolean)));
  const completed = ctx.outcomeHints.includes('completed_signal');
  const hadErrors = ctx.errors.length > 0 || ctx.outcomeHints.includes('blocked_or_failed_signal');
  const hadWorkflowTools = ctx.outcomeHints.some((hint) => (
    hint === 'browser_workflow' ||
    hint === 'desktop_workflow' ||
    hint === 'external_api_or_web_workflow' ||
    hint === 'mutation_or_proposal_made'
  ));

  for (const skillId of skillReadIds) {
    if (hadErrors) {
      candidates.push(makeCandidate(input, ctx, {
        type: 'update_existing_skill',
        confidence: confidenceFor(ctx),
        risk: 'low',
        skillId,
        reason: `Skill "${skillId}" was used in a run with errors, blockers, or rework signals.`,
        suggestedAction: `Review the current ${skillId} playbook and add a focused troubleshooting note, guardrail, or tool-order correction for the observed failure pattern.`,
      }));
    }

    if (completed && hadWorkflowTools) {
      candidates.push(makeCandidate(input, ctx, {
        type: 'add_resource_or_template',
        confidence: confidenceFor(ctx, 'high'),
        risk: 'low',
        skillId,
        reason: `Skill "${skillId}" helped complete a reusable workflow with concrete tool choreography.`,
        suggestedAction: `Consider adding a compact example, checklist, or template resource to ${skillId} that captures the successful sequence and any useful constraints.`,
        userFacingOffer: `This run produced a reusable pattern. I can add it as an example/template resource on the "${skillId}" skill so Prometheus reuses it next time.`,
      }));
    }
  }

  if (hasSkillList && !skillReadIds.length && hadWorkflowTools) {
    candidates.push(makeCandidate(input, ctx, {
      type: 'add_trigger',
      confidence: confidenceFor(ctx),
      risk: 'low',
      reason: 'Prometheus checked skills but did not read one before completing a workflow-like task.',
      suggestedAction: 'Review whether an existing skill needs better trigger metadata or whether this workflow lacks a matching skill.',
    }));
  }

  if (!skillReadIds.length && completed && hadWorkflowTools && ctx.toolSequence.filter((name) => !SKILL_TOOL_NAMES.has(name)).length >= 5) {
    candidates.push(makeCandidate(input, ctx, {
      type: 'create_new_skill_candidate',
      confidence: confidenceFor(ctx, 'high'),
      risk: 'medium',
      reason: 'A multi-tool workflow completed without an active skill, suggesting a reusable playbook may be missing.',
      suggestedAction: 'Draft a new bundled skill proposal with triggers, required tools, permissions, and a SKILL.md outline based on this run.',
      userFacingOffer: 'This workflow looks reusable. I can turn it into a new skill so Prometheus has the playbook ready next time.',
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
  const canOffer =
    String(input.executionMode || 'interactive') === 'interactive' &&
    !/\b(hit max steps|safety boundary|stopped|aborted|failed|error|blocked|unable)\b/i.test(input.finalResponse);
  let offered = false;
  const candidatesToWrite = candidates.map((candidate) => {
    if (
      canOffer &&
      !offered &&
      candidate.userFacingOffer &&
      candidate.confidence !== 'low'
    ) {
      offered = true;
      return { ...candidate, status: 'offered_to_user' as const };
    }
    return candidate;
  });
  const actionable = candidatesToWrite.filter((candidate) => candidate.type !== 'no_action_but_record_episode');
  const outPath = path.join(input.workspacePath, 'Brain', 'skill-gardener', ctx.day, 'live-candidates.jsonl');
  appendJsonl(outPath, candidatesToWrite);
  return actionable;
}

function chooseOfferText(input: SkillEpisodeInput, candidates: SkillGardenerCandidate[]): string | undefined {
  const offer = candidates.find((candidate) => candidate.status === 'offered_to_user' && candidate.userFacingOffer);
  return offer?.userFacingOffer;
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
      offerText: chooseOfferText(input, candidates),
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
