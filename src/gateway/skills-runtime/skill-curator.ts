import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SkillChangeLedgerEntry, SkillsManager } from './skills-manager';
import { scanSkillText, type SkillSafetyScan } from './skill-safety';

export type SkillCuratorMode = 'dry-run' | 'pending' | 'auto-safe';
export type SkillCuratorSuggestionStatus = 'pending' | 'applied' | 'rejected' | 'quarantined';
export type SkillCuratorLessonType =
  | 'recovery'
  | 'style_pattern'
  | 'component_recipe'
  | 'workflow_recipe'
  | 'trigger_patch'
  | 'instruction_patch';

export interface SkillCuratorSuggestion {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SkillCuratorSuggestionStatus;
  skillId: string;
  title: string;
  reason: string;
  lessonType?: SkillCuratorLessonType;
  futureTrigger?: string;
  learnedBehavior?: string;
  whyUseful?: string;
  approvePreview?: string;
  qualityScore?: number;
  autoApplyEligible?: boolean;
  autoDecisionReason?: string;
  evidence: string[];
  risk: 'low' | 'medium' | 'high';
  change: {
    kind: 'write_resource' | 'manifest_overlay' | 'review_only';
    path?: string;
    content?: string;
    manifest?: Record<string, unknown>;
  };
  scan: SkillSafetyScan;
  appliedAt?: string;
  rejectedAt?: string;
}

export interface SkillCuratorRunResult {
  mode: SkillCuratorMode;
  runId: string;
  startedAt: string;
  reportPath: string;
  suggestions: SkillCuratorSuggestion[];
  auditedChanges: SkillCuratorAuditedChange[];
  applied: string[];
  quarantined: string[];
}

export interface SkillCuratorAuditedChange {
  id: string;
  timestamp: string;
  skillId: string;
  changeType: string;
  appliedBy: string;
  risk: 'low' | 'medium' | 'high';
  verdict: 'accepted' | 'needs_review';
  reviewReason: string;
  changedPaths: string[];
  evidence: string[];
  reason?: string;
}

export interface SkillCuratorActivityItem {
  id: string;
  timestamp: string;
  source: 'ledger' | 'gardener';
  status: 'applied' | 'observed';
  skillId?: string;
  title: string;
  summary: string;
  changeType?: string;
  appliedBy?: string;
  risk?: 'low' | 'medium' | 'high';
  changedPaths: string[];
  evidence: string[];
  reason?: string;
  requestExcerpt?: string;
  finalResponseExcerpt?: string;
  suggestedAction?: string;
  toolSequence?: string[];
}

type CandidateRow = {
  id?: string;
  timestamp?: string;
  date?: string;
  type?: string;
  confidence?: string;
  risk?: string;
  skillId?: string;
  reason?: string;
  suggestedAction?: string;
  requestExcerpt?: string;
  finalResponseExcerpt?: string;
  toolSequence?: string[];
  userCorrectionHints?: string[];
  errors?: Array<{ tool?: string; args?: string; result?: string }>;
  touchedPaths?: string[];
  outcomeHints?: string[];
  evidence?: string[];
  businessContext?: unknown;
};

function curatorDir(workspacePath: string): string {
  return path.join(workspacePath, 'Brain', 'skill-curator');
}

function suggestionsPath(workspacePath: string): string {
  return path.join(curatorDir(workspacePath), 'suggestions.json');
}

function ensureCuratorDirs(workspacePath: string): void {
  for (const rel of ['runs', 'reports']) {
    fs.mkdirSync(path.join(curatorDir(workspacePath), rel), { recursive: true });
  }
}

function readJsonArray<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, rows: T[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as T; } catch { return null; }
      })
      .filter((row): row is T => !!row);
  } catch {
    return [];
  }
}

function recentCandidateRows(workspacePath: string, days = 14): CandidateRow[] {
  const root = path.join(workspacePath, 'Brain', 'skill-gardener');
  if (!fs.existsSync(root)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows: CandidateRow[] = [];
  for (const day of fs.readdirSync(root)) {
    const dir = path.join(root, day);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const dayTs = Date.parse(`${day}T00:00:00`);
    if (Number.isFinite(dayTs) && dayTs < cutoff) continue;
    rows.push(...readJsonl<CandidateRow>(path.join(dir, 'live-candidates.jsonl')));
  }
  return rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

function recentSkillChangeRows(skillsManager: SkillsManager, days = 2, limit = 250): SkillChangeLedgerEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return skillsManager.listChangeLedger(undefined, limit)
    .filter((row) => {
      const ts = Date.parse(String(row.timestamp || ''));
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

function auditSkillChange(row: SkillChangeLedgerEntry): SkillCuratorAuditedChange {
  const changedPaths = Array.isArray(row.changedPaths) ? row.changedPaths.map(String) : [];
  const evidence = Array.isArray(row.evidence) ? row.evidence.map(String) : [];
  const changeText = `${row.changeType || ''} ${row.reason || ''}`;
  const appliedBy = String(row.appliedBy || 'unknown');
  let risk: 'low' | 'medium' | 'high' = 'low';
  let verdict: 'accepted' | 'needs_review' = 'accepted';
  let reviewReason = 'Additive, evidence-backed skill change recorded for the daily audit.';

  const touchesEntrypoint = changedPaths.some((item) => /^SKILL\.md$/i.test(item) || /(^|\/)SKILL\.md$/i.test(item));
  const touchesManifestOnly = changedPaths.length > 0 && changedPaths.every((item) => item.includes('../.manifests/') || item === 'skill.json');
  const destructive = /\b(delete|archive|deprecat|remove|rewrite|replace|overwrite|merge)\b/i.test(changeText);
  const createsSkill = /\bskill_created|import|create_bundle\b/i.test(String(row.changeType || ''));
  const noEvidence = evidence.length === 0;

  if (destructive || createsSkill) {
    risk = 'high';
    verdict = 'needs_review';
    reviewReason = destructive
      ? 'Destructive or lifecycle-changing skill edit should be reviewed before it is trusted as self-improvement.'
      : 'New skill creation should be reviewed for real trigger value, scope, and overlap with existing skills.';
  } else if (touchesEntrypoint && !touchesManifestOnly) {
    risk = 'high';
    verdict = 'needs_review';
    reviewReason = 'Entrypoint instruction edits can change agent behavior broadly and need human or critic review.';
  } else if (noEvidence && !/^skill_curator$/i.test(appliedBy)) {
    risk = 'medium';
    verdict = 'needs_review';
    reviewReason = 'Skill change has no evidence links, so the curator should verify the reason before treating it as trusted.';
  } else if (/^(Prom|skill_manager|skill_create_bundle)$/i.test(appliedBy)) {
    risk = 'medium';
    verdict = 'needs_review';
    reviewReason = 'Direct Prometheus/manual skill mutation should be checked by the daily curator audit.';
  } else if (/manifest|trigger/i.test(String(row.changeType || '')) && touchesManifestOnly) {
    reviewReason = 'Manifest or trigger-only change recorded; low-risk as long as it matches the evidence.';
  } else if (/resource|known_issue|guardrail|example|instructions/i.test(String(row.changeType || ''))) {
    reviewReason = 'Additive resource-style skill change recorded; low-risk because it preserves the skill body and cites evidence.';
  }

  return {
    id: suggestionId({
      audit: true,
      timestamp: row.timestamp,
      skillId: row.skillId,
      changeType: row.changeType,
      afterHash: row.afterHash,
      changedPaths,
    }),
    timestamp: row.timestamp,
    skillId: row.skillId,
    changeType: row.changeType,
    appliedBy,
    risk,
    verdict,
    reviewReason,
    changedPaths,
    evidence,
    reason: row.reason,
  };
}

function isBrainAppliedBy(value: string): boolean {
  return /^(brain_|skill_curator$|curator$|gardener$|thought$|dream$)/i.test(String(value || '').trim());
}

function activityRisk(value: unknown): 'low' | 'medium' | 'high' | undefined {
  const risk = String(value || '').toLowerCase();
  if (risk === 'low' || risk === 'medium' || risk === 'high') return risk;
  return undefined;
}

function buildLedgerActivity(row: SkillChangeLedgerEntry): SkillCuratorActivityItem {
  const changedPaths = Array.isArray(row.changedPaths) ? row.changedPaths.map(String).filter(Boolean) : [];
  const evidence = Array.isArray(row.evidence) ? row.evidence.map(String).filter(Boolean) : [];
  const appliedBy = String(row.appliedBy || 'skill_manager');
  const changeType = String(row.changeType || 'skill_update');
  const title = `${row.skillId || 'unknown skill'} ${changeType.replace(/[_-]+/g, ' ')}`;
  const summary = row.reason
    || (isBrainAppliedBy(appliedBy)
      ? 'Brain applied a skill update from observed Thought/Dream evidence.'
      : 'Skill change recorded in the maintenance ledger.');
  return {
    id: suggestionId({
      activity: 'ledger',
      timestamp: row.timestamp,
      skillId: row.skillId,
      changeType: row.changeType,
      afterHash: row.afterHash,
      changedPaths,
    }),
    timestamp: row.timestamp,
    source: 'ledger',
    status: 'applied',
    skillId: row.skillId,
    title,
    summary,
    changeType,
    appliedBy,
    changedPaths,
    evidence,
    reason: row.reason,
  };
}

function buildGardenerActivity(row: CandidateRow): SkillCuratorActivityItem {
  const skillId = String(row.skillId || '').trim() || undefined;
  const type = String(row.type || 'observation');
  const title = skillId
    ? `${skillId} ${type.replace(/[_-]+/g, ' ')}`
    : `Gardener ${type.replace(/[_-]+/g, ' ')}`;
  const summary = String(row.suggestedAction || row.reason || row.requestExcerpt || 'Thought/Gardener captured a reusable skill signal.').trim();
  return {
    id: suggestionId({
      activity: 'gardener',
      id: row.id,
      timestamp: row.timestamp || row.date,
      skillId,
      type,
      suggestedAction: row.suggestedAction,
    }),
    timestamp: String(row.timestamp || row.date || ''),
    source: 'gardener',
    status: 'observed',
    skillId,
    title,
    summary,
    changeType: type,
    risk: activityRisk(row.risk),
    changedPaths: Array.isArray(row.touchedPaths) ? row.touchedPaths.map(String).filter(Boolean) : [],
    evidence: Array.isArray(row.evidence) ? row.evidence.map(String).filter(Boolean) : [],
    reason: row.reason,
    requestExcerpt: row.requestExcerpt,
    finalResponseExcerpt: row.finalResponseExcerpt,
    suggestedAction: row.suggestedAction,
    toolSequence: Array.isArray(row.toolSequence) ? row.toolSequence.map(String).filter(Boolean) : [],
  };
}

function buildSkillChangeAuditSuggestion(audit: SkillCuratorAuditedChange): SkillCuratorSuggestion | null {
  if (audit.verdict !== 'needs_review') return null;
  const now = new Date().toISOString();
  const title = `Review skill change: ${audit.skillId} ${audit.changeType}`;
  const changed = audit.changedPaths.length ? audit.changedPaths.join(', ') : '(no changed paths recorded)';
  const content = [
    `# Daily Skill Change Audit`,
    '',
    `Skill: ${audit.skillId}`,
    `Change type: ${audit.changeType}`,
    `Applied by: ${audit.appliedBy}`,
    `Timestamp: ${audit.timestamp}`,
    `Risk: ${audit.risk}`,
    '',
    '## Why Review',
    audit.reviewReason,
    '',
    '## Changed Paths',
    ...audit.changedPaths.map((item) => `- ${item}`),
    '',
    '## Evidence',
    ...(audit.evidence.length ? audit.evidence.map((item) => `- ${item}`) : ['- (none recorded)']),
    '',
    '## Reason',
    audit.reason || '(none recorded)',
    '',
  ].join('\n');
  const scan = scanSkillText(content, 'daily-skill-change-audit.md');
  return {
    id: audit.id,
    createdAt: now,
    updatedAt: now,
    status: scan.verdict === 'critical' ? 'quarantined' : 'pending',
    skillId: audit.skillId,
    title,
    reason: `${audit.reviewReason} Changed paths: ${changed}.`,
    lessonType: 'instruction_patch',
    futureTrigger: 'Use during the daily self-improvement audit whenever Prometheus, Thought, Dream, or tooling changed skills directly.',
    learnedBehavior: 'Review the actual skill mutation ledger before trusting the day\'s self-improvement as good memory.',
    whyUseful: 'Keeps Prometheus self-editing honest by checking normal chat, Thought, Dream, curator, and manual skill changes in one daily pass.',
    approvePreview: 'Approve marks this daily skill-change audit as accepted. It does not mutate skill files.',
    qualityScore: 80,
    autoApplyEligible: false,
    autoDecisionReason: 'Review-only ledger audit items are never auto-applied.',
    evidence: Array.from(new Set([
      'workspace/skills/.history/skill-change-ledger.jsonl',
      ...audit.evidence,
    ])).slice(0, 10),
    risk: audit.risk,
    change: { kind: 'review_only', content },
    scan,
  };
}

function suggestionId(seed: unknown): string {
  return `sc_${crypto.createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 16)}`;
}

function safeDateKey(raw?: string): string {
  const ts = Date.parse(String(raw || ''));
  const d = Number.isFinite(ts) ? new Date(ts) : new Date();
  return d.toISOString().slice(0, 10);
}

function cleanSnippet(raw: unknown, max = 280): string {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(raw: unknown, fallback = 'lesson'): string {
  const slug = String(raw || '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

function hasFailureSignal(row: CandidateRow): boolean {
  const finalText = String(row.finalResponseExcerpt || '');
  return !!(row.errors && row.errors.length)
    || row.type === 'update_existing_skill'
    || (Array.isArray(row.outcomeHints) && row.outcomeHints.some((hint) => /error|failed|blocked/i.test(String(hint))))
    || /\b(failed|error|blocked|unable|could not|timeout|exception|workaround|but .* exists)\b/i.test(finalText);
}

function hasPositiveReusableSignal(row: CandidateRow): boolean {
  const text = `${row.requestExcerpt || ''}\n${row.finalResponseExcerpt || ''}`;
  return (Array.isArray(row.userCorrectionHints) && row.userCorrectionHints.includes('explicit_reusable_instruction'))
    || /\b(next time|from now on|always|prefer|remember to|keep this style|that was (really )?(good|great|perfect|fire)|love this)\b/i.test(text);
}

function isCreativeVideoSignal(row: CandidateRow): boolean {
  const text = `${row.requestExcerpt || ''}\n${row.finalResponseExcerpt || ''}\n${(row.toolSequence || []).join(' ')}`;
  return /\b(hyperframes|html motion|creative|promo|video|mp4|scene|animation|3d|canvas|export)\b/i.test(text);
}

function isExportArtifactRecovery(row: CandidateRow): boolean {
  const finalText = String(row.finalResponseExcerpt || '');
  return /failed to fetch/i.test(finalText) && /\b(mp4|file .* exists|does exist|nonzero|snapshot|quality report)\b/i.test(finalText);
}

function isPatchRecovery(row: CandidateRow): boolean {
  const errors = row.errors || [];
  return errors.some((err) => /\b(text not found|patch context|context drift)\b/i.test(String(err.result || '')));
}

function chooseLessonSkill(row: CandidateRow, skillsManager: SkillsManager, fallbackSkillId: string): string {
  if (isExportArtifactRecovery(row) && skillsManager.get('prometheus-creative-mode')) return 'prometheus-creative-mode';
  if (isPatchRecovery(row) && skillsManager.get('file-surgery')) return 'file-surgery';
  return fallbackSkillId;
}

function errorSignature(row: CandidateRow): string {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const preferred = errors.find((err) => /find_replace/i.test(String(err.tool || '')) || /\b(text not found|patch context|context drift)\b/i.test(String(err.result || '')));
  const first = preferred || errors.find((err) => err && (err.tool || err.result));
  const finalText = String(row.finalResponseExcerpt || '');
  if (isExportArtifactRecovery(row)) {
    return 'Creative export reported `Failed to fetch`, but the output artifact appeared to exist.';
  }
  if (first) {
    const tool = cleanSnippet(first.tool || 'tool', 80);
    const result = cleanSnippet(first.result || '', 180);
    return result ? `${tool} failed: ${result}` : `${tool} failed during the workflow.`;
  }
  const m = finalText.match(/(?:failed|error|blocked|unable|could not)[^.!\n]{0,180}/i);
  return m ? cleanSnippet(m[0], 220) : 'The workflow hit an error, blocker, or rework signal.';
}

function recoveryBehavior(row: CandidateRow): string {
  const finalText = String(row.finalResponseExcerpt || '');
  if (isExportArtifactRecovery(row)) {
    return 'Before treating the export as failed, verify the artifact path, file size, timeline snapshots, and quality report; if those pass, report it as an export transport/status issue.';
  }
  if (isPatchRecovery(row)) {
    return 'After patch/context drift, re-read the exact surrounding lines, make the patch smaller, and run the narrowest syntax or validation check before continuing.';
  }
  return '';
}

function positiveStyleBehavior(row: CandidateRow): string {
  const finalText = String(row.finalResponseExcerpt || '');
  const bullets = finalText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line.length > 8 && line.length < 180)
    .filter((line) => /\b(palette|typing|3d|canvas|transition|cta|scene|animation|mockup|grid|nodes|style|effect)\b/i.test(line))
    .slice(0, 8);
  if (bullets.length) return bullets.join('; ');
  return cleanSnippet(row.suggestedAction || row.reason, 360)
    || 'Capture the reusable style/component pattern the user explicitly liked.';
}

function observedEvidence(row: CandidateRow): string[] {
  const dateKey = safeDateKey(row.timestamp);
  const out = Array.isArray(row.evidence) && row.evidence.length
    ? row.evidence.map(String)
    : [`Brain/skill-gardener/${dateKey}/live-candidates.jsonl`];
  return Array.from(new Set(out)).slice(0, 8);
}

function buildLessonContent(params: {
  title: string;
  sourceId: string;
  captured: string;
  confidence: string;
  lessonType: SkillCuratorLessonType;
  futureTrigger: string;
  learnedBehavior: string;
  whyUseful: string;
  recoverySteps?: string[];
  avoid?: string[];
  evidence: string[];
}): string {
  return [
    `# ${params.title}`,
    '',
    `Source candidate: ${params.sourceId || '(unknown)'}`,
    `Captured: ${params.captured || new Date().toISOString()}`,
    `Lesson type: ${params.lessonType}`,
    `Confidence: ${params.confidence || 'medium'}`,
    '',
    '## Future Trigger',
    params.futureTrigger,
    '',
    '## Learned Behavior',
    params.learnedBehavior,
    '',
    '## Why This Helps',
    params.whyUseful,
    '',
    ...(params.recoverySteps && params.recoverySteps.length ? [
      '## Recovery Steps',
      ...params.recoverySteps.map((step, idx) => `${idx + 1}. ${step}`),
      '',
    ] : []),
    ...(params.avoid && params.avoid.length ? [
      '## Avoid',
      ...params.avoid.map((step) => `- ${step}`),
      '',
    ] : []),
    '## Evidence',
    ...params.evidence.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function buildResourceSuggestion(row: CandidateRow, skillsManager: SkillsManager): SkillCuratorSuggestion | null {
  const sourceSkillId = String(row.skillId || '').trim();
  if (!sourceSkillId) return null;
  const skillId = chooseLessonSkill(row, skillsManager, sourceSkillId);
  const dateKey = safeDateKey(row.timestamp);
  let lessonType: SkillCuratorLessonType | null = null;
  let title = '';
  let pathName = '';
  let futureTrigger = '';
  let learnedBehavior = '';
  let whyUseful = '';
  let recoverySteps: string[] | undefined;
  let avoid: string[] | undefined;
  let risk: 'low' | 'medium' | 'high' = row.risk === 'high' ? 'high' : row.risk === 'medium' ? 'medium' : 'low';
  let qualityScore = 0;
  let autoApplyEligible = false;
  let autoDecisionReason = '';

  if (hasFailureSignal(row)) {
    const behavior = recoveryBehavior(row);
    if (!behavior) return null;
    lessonType = 'recovery';
    const signature = errorSignature(row);
    title = signature.includes('Failed to fetch')
      ? 'Creative export: Failed to fetch but artifact exists'
      : `Recovery note: ${cleanSnippet(signature, 90)}`;
    futureTrigger = signature.includes('Failed to fetch')
      ? 'Use this when Creative/HyperFrames export reports `Failed to fetch` after rendering.'
      : `Use this when ${skillId} hits this failure pattern: ${signature}`;
    learnedBehavior = behavior;
    whyUseful = 'Prevents Prometheus from rerendering, abandoning a valid result, or wandering into unrelated fixes when a known recovery path exists.';
    recoverySteps = signature.includes('Failed to fetch')
      ? [
        'Check whether the exported MP4 path exists.',
        'Check that the file size is nonzero.',
        'Render timeline snapshots or inspect frames to confirm the clip changed over time.',
        'Run or inspect the quality report for fatal layout/export issues.',
        'If those pass, treat the message as a transport/status reporting issue, not a failed render.',
      ]
      : undefined;
    avoid = signature.includes('Failed to fetch')
      ? ['Do not discard or rerender a valid export solely because the API response said `Failed to fetch`.']
      : ['Do not save raw tool logs as the lesson; save the recovery behavior that should change the next run.'];
    pathName = `references/recovery/${slugify(title)}-${dateKey}.md`;
    qualityScore = 86;
    autoApplyEligible = risk === 'low';
    autoDecisionReason = 'Low-risk recovery note with an explicit failure/workaround signal.';
  } else if (hasPositiveReusableSignal(row) && isCreativeVideoSignal(row)) {
    lessonType = 'style_pattern';
    title = `Creative style pattern: ${skillId}`;
    futureTrigger = 'Use this when the user asks for a similar creative/video output or explicitly says to keep this style.';
    learnedBehavior = positiveStyleBehavior(row);
    whyUseful = 'Preserves a user-approved creative direction as reusable style guidance instead of saving a raw transcript.';
    pathName = `references/styles/${slugify(skillId)}-${dateKey}.md`;
    qualityScore = 72;
    autoApplyEligible = risk === 'low';
    autoDecisionReason = 'Low-risk style resource with positive or explicit reusable feedback.';
  } else if (hasPositiveReusableSignal(row)) {
    lessonType = 'workflow_recipe';
    title = `Reusable workflow recipe: ${skillId}`;
    futureTrigger = 'Use this when the user asks for this same operating pattern again or explicitly asks Prometheus to remember the workflow.';
    learnedBehavior = cleanSnippet(row.suggestedAction || row.reason, 360)
      || 'Repeat the user-approved operating pattern using the specific constraints that made the prior run successful.';
    whyUseful = 'Captures a user-approved behavior change without preserving noisy tool-by-tool transcript details.';
    pathName = `references/workflows/${slugify(skillId)}-${dateKey}.md`;
    qualityScore = 68;
    autoApplyEligible = risk === 'low';
    autoDecisionReason = 'Low-risk workflow resource with explicit reusable/positive signal.';
  } else {
    return null;
  }

  const evidence = observedEvidence(row);
  const content = buildLessonContent({
    title,
    sourceId: String(row.id || ''),
    captured: String(row.timestamp || new Date().toISOString()),
    confidence: String(row.confidence || 'medium'),
    lessonType,
    futureTrigger,
    learnedBehavior,
    whyUseful,
    recoverySteps,
    avoid,
    evidence,
  });
  const scan = scanSkillText(content, pathName);
  const now = new Date().toISOString();
  return {
    id: suggestionId({ skillId, lessonType, pathName, futureTrigger, learnedBehavior }),
    createdAt: now,
    updatedAt: now,
    status: scan.verdict === 'critical' ? 'quarantined' : 'pending',
    skillId,
    title: `Add ${lessonType.replace(/_/g, ' ')} to ${skillId}`,
    reason: cleanSnippet(row.reason || whyUseful, 500),
    lessonType,
    futureTrigger,
    learnedBehavior,
    whyUseful,
    approvePreview: `Approve will add ${pathName} to ${skillId}.`,
    qualityScore,
    autoApplyEligible,
    autoDecisionReason,
    evidence,
    risk,
    change: {
      kind: 'write_resource',
      path: pathName,
      content,
    },
    scan,
  };
}
function buildTriggerSuggestion(row: CandidateRow, skillsManager: SkillsManager): SkillCuratorSuggestion | null {
  const skillId = String(row.skillId || '').trim();
  if (!skillId) return null;
  const skill = skillsManager.get(skillId);
  if (!skill) return null;
  const phrase = String(row.requestExcerpt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 4)
    .join(' ');
  if (!phrase) return null;
  const triggers = Array.from(new Set([...(skill.triggers || []), phrase]));
  const manifest = { ...skill.manifest, triggers };
  const scan = scanSkillText(JSON.stringify(manifest, null, 2), 'skill.json overlay');
  const now = new Date().toISOString();
  return {
    id: suggestionId({ skillId, type: 'add_trigger', phrase }),
    createdAt: now,
    updatedAt: now,
    status: scan.verdict === 'critical' ? 'quarantined' : 'pending',
    skillId,
    title: `Add trigger to ${skillId}`,
    reason: 'Brain observed skill discovery friction after skills were listed without a matching skill read.',
    lessonType: 'trigger_patch',
    futureTrigger: `When a user asks for work matching "${phrase}" and no skill is selected.`,
    learnedBehavior: `Add "${phrase}" as a trigger so Prometheus routes to ${skillId} earlier.`,
    whyUseful: 'Improves skill discovery without changing skill instructions or workflow behavior.',
    approvePreview: `Approve will update ${skillId}'s trigger metadata.`,
    qualityScore: 62,
    autoApplyEligible: true,
    autoDecisionReason: 'Low-risk manifest trigger enrichment.',
    evidence: Array.isArray(row.evidence) && row.evidence.length ? row.evidence.map(String) : [],
    risk: 'low',
    change: { kind: 'manifest_overlay', manifest },
    scan,
  };
}

function mergeSuggestions(existing: SkillCuratorSuggestion[], incoming: SkillCuratorSuggestion[]): SkillCuratorSuggestion[] {
  const byId = new Map<string, SkillCuratorSuggestion>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (old && old.status !== 'pending' && old.status !== 'quarantined') continue;
    byId.set(item.id, old ? { ...old, ...item, createdAt: old.createdAt, status: old.status } : item);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function dedupeIncomingSuggestions(incoming: SkillCuratorSuggestion[]): SkillCuratorSuggestion[] {
  const byId = new Map<string, SkillCuratorSuggestion>();
  const riskRank: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (!old) {
      byId.set(item.id, item);
      continue;
    }
    const chosen = (riskRank[item.risk] < riskRank[old.risk] || (item.qualityScore || 0) > (old.qualityScore || 0))
      ? item
      : old;
    byId.set(item.id, {
      ...chosen,
      evidence: Array.from(new Set([...old.evidence, ...item.evidence])),
      autoApplyEligible: old.autoApplyEligible || item.autoApplyEligible,
      autoDecisionReason: chosen.autoDecisionReason || old.autoDecisionReason || item.autoDecisionReason,
    });
  }
  return Array.from(byId.values());
}

export function listSkillCuratorSuggestions(workspacePath: string): SkillCuratorSuggestion[] {
  return readJsonArray<SkillCuratorSuggestion>(suggestionsPath(workspacePath));
}

export function listSkillCuratorActivity(
  workspacePath: string,
  skillsManager: SkillsManager,
  options?: { days?: number; limit?: number },
): SkillCuratorActivityItem[] {
  const days = Math.max(1, Math.floor(Number(options?.days) || 14));
  const limit = Math.max(1, Math.floor(Number(options?.limit) || 160));
  const ledgerLimit = Math.max(limit, 250);
  const ledger = recentSkillChangeRows(skillsManager, days, ledgerLimit)
    .map(buildLedgerActivity);
  const observed = recentCandidateRows(workspacePath, days)
    .filter((row) => row.type !== 'no_action_but_record_episode' || row.confidence !== 'low')
    .map(buildGardenerActivity);

  const byId = new Map<string, SkillCuratorActivityItem>();
  for (const item of [...ledger, ...observed]) {
    if (!item.timestamp) continue;
    byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, limit);
}

export function rejectSkillCuratorSuggestion(workspacePath: string, id: string): SkillCuratorSuggestion | null {
  const rows = listSkillCuratorSuggestions(workspacePath);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  rows[idx] = { ...rows[idx], status: 'rejected', updatedAt: new Date().toISOString(), rejectedAt: new Date().toISOString() };
  writeJsonArray(suggestionsPath(workspacePath), rows);
  return rows[idx];
}

export function applySkillCuratorSuggestion(workspacePath: string, skillsManager: SkillsManager, id: string): SkillCuratorSuggestion | null {
  const rows = listSkillCuratorSuggestions(workspacePath);
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  const suggestion = rows[idx];
  if (suggestion.status === 'quarantined') throw new Error('Cannot apply a quarantined skill suggestion.');
  if (suggestion.change.kind === 'write_resource') {
    skillsManager.writeResource(suggestion.skillId, suggestion.change.path || '', suggestion.change.content || '', {
      type: 'doc',
      description: suggestion.title,
      change: {
        changeType: 'brain_curator_resource',
        evidence: suggestion.evidence,
        appliedBy: 'skill_curator',
        reason: suggestion.learnedBehavior || suggestion.reason,
      },
    });
  } else if (suggestion.change.kind === 'manifest_overlay') {
    skillsManager.writeManifestOverlay(suggestion.skillId, suggestion.change.manifest || {}, {
      changeType: 'brain_curator_manifest',
      evidence: suggestion.evidence,
      appliedBy: 'skill_curator',
      reason: suggestion.learnedBehavior || suggestion.reason,
    });
  } else if (suggestion.change.kind === 'review_only') {
    // Review-only audit items intentionally do not mutate skill files.
  }
  rows[idx] = { ...suggestion, status: 'applied', updatedAt: new Date().toISOString(), appliedAt: new Date().toISOString() };
  writeJsonArray(suggestionsPath(workspacePath), rows);
  return rows[idx];
}

function canAutoApplySuggestion(suggestion: SkillCuratorSuggestion): boolean {
  if (suggestion.status !== 'pending') return false;
  if (!suggestion.autoApplyEligible) return false;
  if (suggestion.risk !== 'low') return false;
  if (suggestion.scan.verdict === 'critical') return false;
  if ((suggestion.qualityScore || 0) < 60) return false;
  if (suggestion.lessonType === 'instruction_patch') return false;
  return suggestion.change.kind === 'write_resource' || suggestion.change.kind === 'manifest_overlay';
}

function isWeakLegacySuggestion(suggestion: SkillCuratorSuggestion): boolean {
  if (suggestion.status !== 'pending') return false;
  if (suggestion.lessonType || suggestion.learnedBehavior || suggestion.futureTrigger) return false;
  const content = String(suggestion.change.content || '');
  const reason = String(suggestion.reason || '');
  const title = String(suggestion.title || '');
  if (/Add (workflow example|troubleshooting note) to /i.test(title)) return true;
  const isGenericWorkflow = /workflow example/i.test(title)
    || /helped complete a reusable workflow/i.test(reason)
    || /Business workflow detected/i.test(reason);
  if (!isGenericWorkflow) return false;
  const hasUsefulFailure = /\b(failed|error|blocked|unable|could not|workaround|troubleshooting|recovery)\b/i.test(content);
  const hasReusablePreference = /\b(next time|from now on|always|prefer|keep this style|future trigger|learned behavior)\b/i.test(content);
  return !hasUsefulFailure && !hasReusablePreference;
}

export function runSkillCurator(params: {
  workspacePath: string;
  skillsManager: SkillsManager;
  mode: SkillCuratorMode;
}): SkillCuratorRunResult {
  ensureCuratorDirs(params.workspacePath);
  params.skillsManager.scanSkills();
  const startedAt = new Date().toISOString();
  const runId = `skill_curator_${startedAt.replace(/[:.]/g, '-')}`;
  const rows = recentCandidateRows(params.workspacePath);
  const skillChangeRows = recentSkillChangeRows(params.skillsManager);
  const auditedChanges = skillChangeRows.map(auditSkillChange);
  const auditSuggestions = auditedChanges
    .map(buildSkillChangeAuditSuggestion)
    .filter((item): item is SkillCuratorSuggestion => !!item && !!params.skillsManager.get(item.skillId));
  const incomingRaw = rows
    .filter((row) => row.type !== 'no_action_but_record_episode')
    .map((row) => row.type === 'add_trigger'
      ? buildTriggerSuggestion(row, params.skillsManager)
      : buildResourceSuggestion(row, params.skillsManager))
    .filter((item): item is SkillCuratorSuggestion => !!item && !!params.skillsManager.get(item.skillId));
  const incoming = dedupeIncomingSuggestions([...incomingRaw, ...auditSuggestions]);

  const existing = listSkillCuratorSuggestions(params.workspacePath);
  const merged = mergeSuggestions(existing, incoming);
  const quarantined = incoming.filter((item) => item.status === 'quarantined').map((item) => item.id);
  const applied: string[] = [];
  const autoRejected: string[] = [];
  const now = new Date().toISOString();
  const persisted = merged.map((suggestion) => {
    if (!isWeakLegacySuggestion(suggestion)) return suggestion;
    autoRejected.push(suggestion.id);
    return {
      ...suggestion,
      status: 'rejected' as SkillCuratorSuggestionStatus,
      updatedAt: now,
      rejectedAt: now,
      autoDecisionReason: 'Auto-rejected legacy workflow dump: no failure recovery, positive reusable signal, future trigger, or learned behavior.',
    };
  });

  if (params.mode !== 'dry-run') {
    writeJsonArray(suggestionsPath(params.workspacePath), persisted);
  }

  if (params.mode === 'auto-safe') {
    for (const suggestion of persisted) {
      if (!canAutoApplySuggestion(suggestion)) continue;
      try {
        applySkillCuratorSuggestion(params.workspacePath, params.skillsManager, suggestion.id);
        applied.push(suggestion.id);
      } catch {}
    }
  }

  const reportPath = path.join(curatorDir(params.workspacePath), 'reports', `${runId}.md`);
  const report = [
    `# Skill Curator Run - ${startedAt}`,
    '',
    `Mode: ${params.mode}`,
    `Candidates reviewed: ${rows.length}`,
    `Recent skill changes audited: ${auditedChanges.length}`,
    `Suggestions generated: ${incoming.length}`,
    `Applied: ${applied.length}`,
    `Auto-rejected weak legacy suggestions: ${autoRejected.length}`,
    `Quarantined: ${quarantined.length}`,
    '',
    '## Daily Skill Change Audit',
    ...(auditedChanges.length ? auditedChanges.map((a) => [
      `### ${a.skillId} - ${a.changeType}`,
      `- ID: ${a.id}`,
      `- Timestamp: ${a.timestamp}`,
      `- Applied by: ${a.appliedBy}`,
      `- Verdict: ${a.verdict}`,
      `- Risk: ${a.risk}`,
      `- Review reason: ${a.reviewReason}`,
      `- Changed paths: ${a.changedPaths.join(', ') || '(none)'}`,
      `- Evidence: ${a.evidence.join(', ') || '(none)'}`,
      a.reason ? `- Reason: ${a.reason}` : '',
    ].filter(Boolean).join('\n')) : ['No recent skill changes found.']),
    '',
    '## Suggestions',
    ...(incoming.length ? incoming.map((s) => [
      `### ${s.title}`,
      `- ID: ${s.id}`,
      `- Skill: ${s.skillId}`,
      `- Status: ${s.status}`,
      `- Risk: ${s.risk}`,
      `- Lesson type: ${s.lessonType || '(legacy)'}`,
      `- Learned behavior: ${s.learnedBehavior || '(none)'}`,
      `- Reason: ${s.reason}`,
      `- Auto eligible: ${s.autoApplyEligible ? 'yes' : 'no'}${s.autoDecisionReason ? ` - ${s.autoDecisionReason}` : ''}`,
      `- Evidence: ${s.evidence.join(', ') || '(none)'}`,
      `- Change: ${s.change.kind}${s.change.path ? ` ${s.change.path}` : ''}`,
    ].join('\n')) : ['No new suggestions.']),
    '',
  ].join('\n');
  fs.writeFileSync(reportPath, report, 'utf-8');

  return {
    mode: params.mode,
    runId,
    startedAt,
    reportPath,
    suggestions: incoming,
    auditedChanges,
    applied,
    quarantined,
  };
}
