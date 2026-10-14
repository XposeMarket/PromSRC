import { getConfig } from '../../config/config';
import { submitSkillGardenerCandidate } from './skill-episodes';

export interface PostTaskSkillReviewInput {
  workspacePath: string;
  sessionId: string;
  executionMode: string;
  request: string;
  finalResponse: string;
  toolResults: unknown[];
}

function cleanText(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function toolName(result: any): string {
  return cleanText(result?.name || result?.toolName || result?.action || 'unknown', 120);
}

function toolFailed(result: any): boolean {
  if (result?.error === true || result?.failed === true || result?.success === false) return true;
  return /\b(error|failed|exception|not found|invalid)\b/i.test(cleanText(result?.result || result?.content || result?.output || '', 500));
}

/**
 * Opt-in, deterministic review of a completed multi-tool turn. The review is
 * deliberately conservative: it only submits a pending candidate when several
 * tool failures expose a repeated workflow gap. It never edits a skill or
 * promotes a candidate.
 */
export function isPostTaskSkillReviewEnabled(config = getConfig().getConfig() as any): boolean {
  return config?.brain?.enabled === true && config?.brain?.skillLearning?.autoReview === true;
}

export function reviewCompletedMultiToolTurn(input: PostTaskSkillReviewInput): void {
  const config = getConfig().getConfig() as any;
  if (!isPostTaskSkillReviewEnabled(config)) return;

  const tools = Array.isArray(input.toolResults) ? input.toolResults : [];
  if (tools.length < 2) return;

  const names = tools.map(toolName).filter(Boolean);
  const failures = tools.filter(toolFailed);
  // A single failed command is normal iteration. Only flag an evidence-backed
  // recurring breakdown in a substantial tool turn.
  if (failures.length < 2 || names.length < 3) return;

  const failureNames = failures.map(toolName).filter(Boolean);
  const evidence = [
    `post_task_review: multi-tool turn (${names.length} tools; ${failures.length} failed signals)`,
    `tool_sequence: ${names.slice(0, 12).join(' -> ')}`,
    `failure_tools: ${failureNames.slice(0, 8).join(', ')}`,
    `request: ${cleanText(input.request, 500)}`,
    `response: ${cleanText(input.finalResponse, 500)}`,
  ].filter(Boolean);

  submitSkillGardenerCandidate({
    workspacePath: input.workspacePath,
    sessionId: input.sessionId,
    executionMode: `${input.executionMode}:post_task_review`,
    type: 'create_new_skill_candidate',
    confidence: 'low',
    risk: 'high',
    reason: `Completed multi-tool turn contained ${failures.length} deterministic failure signals across ${names.length} tools; assess whether a reusable workflow gap exists before any skill change.`,
    suggestedAction: 'Review the captured tool sequence and failure evidence. Submit no mutation or promotion without independent curator replay evidence and native-reviewed holdouts.',
    requestExcerpt: cleanText(input.request, 1200),
    evidence,
    submittedBy: 'post_task_skill_review',
  });
}
