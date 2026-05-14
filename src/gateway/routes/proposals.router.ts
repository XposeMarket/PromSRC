/**
 * proposals.router.ts — Phase 5
 *
 * REST endpoints for the proposal store.
 * These are what the web UI calls — both the Proposals page AND
 * the right-column approval panel.
 *
 * GET   /api/proposals              — list proposals (filter: ?status=pending|approved|denied|executed|all)
 * GET   /api/proposals/:id          — get single proposal
 * PATCH /api/proposals/:id          — update a pending proposal (with validation + revision tracking)
 * POST  /api/proposals/:id/approve  — approve a proposal (triggers executor if executorPrompt set)
 * POST  /api/proposals/:id/deny     — deny a proposal
 * When a proposal is created anywhere in the system, call broadcastProposalCreated()
 * exported from this file — it sends a WS event so the right column updates live.
 */

import { Router, Request, Response } from 'express';
import {
  listProposals,
  loadProposal,
  updatePendingProposal,
  approveProposal,
  denyProposal,
  setProposalStoreBroadcast,
  type ProposalExecutionMode as ApprovedProposalExecutionMode,
  type ProposalStatus,
} from '../proposals/proposal-store.js';
import { isPublicDistributionBuild } from '../../runtime/distribution.js';
import { loadTask, saveTask, type TaskStatus } from '../tasks/task-store.js';
import {
  DEV_SRC_SELF_EDIT_MODE,
  DEV_SRC_SELF_EDIT_REPAIR_MODE,
  prepareDevSrcSelfEditWorkspace,
  prepareDevSrcRepairWorkspace,
  proposalUsesDevSrcSelfEditMode,
} from '../proposals/dev-src-self-edit.js';

const router = Router();
const PROPOSAL_ACTIVE_TASK_STATUSES = new Set<TaskStatus>(['queued', 'running', 'waiting_subagent']);
const PROPOSAL_PAUSED_TASK_STATUSES = new Set<TaskStatus>(['paused', 'stalled', 'needs_assistance', 'awaiting_user_input']);

function proposalTouchesInternalCode(proposal: any): boolean {
  const affectedFiles = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [];
  const touchesSrc = affectedFiles.some((f: any) => {
    const p = String(f?.path || '').replace(/\\/g, '/').trim();
    return p.startsWith('src/') || p.startsWith('./src/') || p.includes('/src/');
  });
  const touchesWebUi = affectedFiles.some((f: any) => {
    const p = String(f?.path || '').replace(/\\/g, '/').trim();
    return p.startsWith('web-ui/') || p.startsWith('./web-ui/') || p.includes('/web-ui/');
  });
  const touchesPromRoot = affectedFiles.some((f: any) => isPromRootAffectedPath(f?.path));
  return Boolean(
    proposal?.type === 'src_edit'
    || proposal?.requiresSrcEdit
    || proposal?.requiresBuild
    || touchesSrc
    || touchesWebUi
    || touchesPromRoot
  );
}

function isPromRootAffectedPath(rawPath: unknown): boolean {
  const p = String(rawPath || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
  if (!p) return false;
  if (p.startsWith('src/') || p.startsWith('web-ui/')) return false;
  const top = p.split('/')[0] || '';
  return [
    '.prometheus',
    'scripts',
    'electron',
    'build',
    'dist',
  ].includes(top) || [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'README.md',
    'CHANGELOG.md',
    'SELF.md',
    'AGENTS.md',
  ].includes(p);
}

function normalizeProposalScopePath(rawPath: unknown): string {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function buildProposalMutationScope(proposal: any): { allowedFiles: string[]; allowedDirs: string[] } | undefined {
  const allowedFiles: string[] = [];
  const allowedDirs: string[] = [];
  for (const file of (Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [])) {
    const normalized = normalizeProposalScopePath(file?.path);
    if (!normalized) continue;
    const rawPath = String(file?.path || '').replace(/\\/g, '/').trim();
    if (rawPath.endsWith('/')) {
      allowedDirs.push(normalized);
    } else {
      allowedFiles.push(normalized);
    }
  }
  const uniqueFiles = Array.from(new Set(allowedFiles));
  const uniqueDirs = Array.from(new Set(allowedDirs));
  if (uniqueFiles.length === 0 && uniqueDirs.length === 0) return undefined;
  return { allowedFiles: uniqueFiles, allowedDirs: uniqueDirs };
}

type ProposalExecutionLane = ApprovedProposalExecutionMode;

function legacyInferProposalExecutionLane(proposal: any, opts: { touchesInternalCode: boolean; needsBuild: boolean }): ProposalExecutionLane {
  if (opts.touchesInternalCode || opts.needsBuild) return 'code_change';
  const type = String(proposal?.type || 'general').trim().toLowerCase();
  const text = `${proposal?.title || ''}\n${proposal?.summary || ''}\n${proposal?.details || ''}\n${proposal?.executorPrompt || ''}`.toLowerCase();
  const hasVerificationIntent = /\b(verify|verification|confirm|check|inspect|audit|review)\b/.test(text);
  if (hasVerificationIntent && type !== 'task_trigger') return 'review';
  return 'action';
}

function normalizeProposalExecutionLane(raw: any): ProposalExecutionLane | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'code_change' || value === 'action' || value === 'review') return value as ProposalExecutionLane;
  return null;
}

function resolveProposalExecutionLane(proposal: any, opts: { touchesInternalCode: boolean; needsBuild: boolean }): ProposalExecutionLane {
  if (opts.touchesInternalCode || opts.needsBuild) return 'code_change';
  return normalizeProposalExecutionLane(proposal?.executionMode || proposal?.execution_mode)
    || legacyInferProposalExecutionLane(proposal, opts);
}

function buildAffectedResourcesBlock(proposal: any): string {
  const affectedFiles = Array.isArray(proposal?.affectedFiles) ? proposal.affectedFiles : [];
  if (affectedFiles.length === 0) return '';
  return `\n\nAFFECTED RESOURCES / EXPECTED TOUCHPOINTS:\n${affectedFiles.map((f: any) => `  - ${f.path || '?'}${f.description ? `: ${f.description}` : ''}`).join('\n')}`;
}

function parseExecutorPromptSteps(executorPrompt: string): string[] {
  const lines = String(executorPrompt || '').split('\n');
  const steps: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:Step\s*)?(\d+)[.):]\s+(.+)/i);
    if (m) steps.push(m[2].trim());
  }
  return steps;
}

function getApprovedExecutionSteps(proposal: any): Array<{ index: number; description: string; status: 'pending' }> {
  const steps = Array.isArray(proposal?.executionSteps) ? proposal.executionSteps : [];
  return steps
    .map((step: any, index: number) => {
      const title = String(step?.title || step?.description || '').trim();
      if (!title) return null;
      const parts = [
        title,
        step?.description ? String(step.description).trim() : '',
        step?.successCriteria ? `Success: ${String(step.successCriteria).trim()}` : '',
      ].filter(Boolean);
      return {
        index,
        description: parts.join(' - ').slice(0, 300),
        status: 'pending' as const,
      };
    })
    .filter(Boolean) as Array<{ index: number; description: string; status: 'pending' }>;
}

function buildExecutionStepsBlock(proposal: any): string {
  const steps = Array.isArray(proposal?.executionSteps) ? proposal.executionSteps : [];
  const lines = steps
    .map((step: any, index: number) => {
      const title = String(step?.title || step?.description || '').trim();
      if (!title) return '';
      const kind = String(step?.kind || '').trim();
      const criteria = String(step?.successCriteria || step?.success_criteria || '').trim();
      return [
        `${index + 1}. ${title}${kind ? ` [${kind}]` : ''}`,
        step?.description ? `   - ${String(step.description).trim()}` : '',
        criteria ? `   - Success: ${criteria}` : '',
      ].filter(Boolean).join('\n');
    })
    .filter(Boolean);
  return lines.length > 0
    ? `\n\nAPPROVED EXECUTION STEPS:\n${lines.join('\n')}`
    : '';
}

function buildOperationalProposalPrompt(opts: {
  proposal: any;
  proposalId: string;
  executorPrompt: string;
  lane: Exclude<ProposalExecutionLane, 'code_change'>;
  affectedResourcesBlock: string;
  diffBlock: string;
}): string {
  const { proposal, proposalId, executorPrompt, lane, affectedResourcesBlock, diffBlock } = opts;
  const modeLabel = lane === 'review' ? 'read-mostly review' : 'bounded action';
  const teamHint = lane === 'action'
    ? [
        ``,
        `TEAM / TASK ACTION HINT: If this proposal asks you to start or dispatch a team, request the team_ops tool category, call the appropriate team tool once, capture the returned run/task/team identifiers, then stop after verification and a note.`,
      ].join('\n')
    : '';

  return [
    `[PROPOSAL ACTION EXECUTION] Executing approved ${modeLabel} proposal.`,
    ``,
    `This is not a source-code implementation proposal. Treat listed resources as context, audit surfaces, or expected outputs unless the proposal explicitly asks for a non-code workspace write.`,
    `Do not run npm/build commands unless the approved instructions explicitly require them.`,
    `Do not expand the work into broader implementation. Perform the approved action, verify the outcome, write a concise note, and complete the task.`,
    teamHint,
    ``,
    `TITLE: ${proposal.title || 'Untitled'}`,
    `PRIORITY: ${proposal.priority || 'medium'}`,
    `TYPE: ${proposal.type || 'general'}`,
    `EXECUTION LANE: ${lane}`,
    ``,
    `SUMMARY: ${proposal.summary || ''}`,
    ``,
    `APPROVED ACTION PLAN:`,
    proposal.details || proposal.summary || executorPrompt,
    buildExecutionStepsBlock(proposal),
    affectedResourcesBlock,
    diffBlock,
    proposal.estimatedImpact ? `\nEXPECTED OUTCOME: ${proposal.estimatedImpact}` : '',
    ``,
    `GLOBAL RULES:`,
    `- Execute only the approved proposal scope and approved steps.`,
    `- Do not call declare_plan; the approved execution_steps are already the task plan.`,
    `- Call step_complete after each approved step.`,
    `- If blocked, pause with a concise blocker instead of improvising or broadening scope.`,
    `- Write exactly one final write_note with tag "task_complete", then complete the task.`,
    ``,
    lane === 'review'
      ? `LANE RULES: Prefer read-only tools. Do not mutate files, teams, schedules, memory, or external systems unless the proposal explicitly approves that exact mutation. If a fix is needed, report findings and recommend a follow-up proposal instead of performing the fix.`
      : `LANE RULES: Do the approved action exactly once. Capture IDs, paths, URLs, statuses, or returned artifacts. Do not run npm/build/dev commands unless the approved steps explicitly require them.`,
    ``,
    `INSTRUCTIONS:`,
    `1. Inspect only the state needed to carry out the approved ${lane === 'review' ? 'review' : 'action'}.`,
    `   After inspection is complete, call step_complete before moving on to artifact creation or triggering work.`,
    lane === 'review'
      ? `2. Verify/audit the requested condition without expanding into implementation work.`
      : `2. Perform the action exactly once unless the approved plan explicitly says otherwise.`,
    `   After the action is complete, call step_complete before verification.`,
    lane === 'review'
      ? `3. Record pass/fail/unknown, evidence checked, findings, and recommended next action.`
      : `3. Verify the action started, completed, or produced the expected artifact/status.`,
    `   After verification is complete, call step_complete before the final note.`,
    `4. Write a concise note with identifiers, artifacts, blockers, and next steps, then complete the task.`,
    ``,
    executorPrompt ? `ADDITIONAL EXECUTOR INSTRUCTIONS:\n${executorPrompt}` : '',
    ``,
    `Proposal ID: ${proposalId}`,
  ].filter(Boolean).join('\n');
}

function buildOperationalPlanSteps(
  lane: Exclude<ProposalExecutionLane, 'code_change'>,
  executorPrompt: string,
  details?: string,
): Array<{ index: number; description: string; status: 'pending' }> {
  const parsedSteps = parseExecutorPromptSteps(executorPrompt);
  const detailSteps = parsedSteps.length >= 2 ? [] : parseExecutorPromptSteps(String(details || ''));
  const approvedSteps = parsedSteps.length >= 2 ? parsedSteps : detailSteps;
  if (approvedSteps.length >= 2 && approvedSteps.length <= 10) {
    return approvedSteps.map((desc, index) => ({
      index,
      description: desc.slice(0, 300),
      status: 'pending',
    }));
  }

  const descriptions = lane === 'review'
    ? [
        'Inspect the approved evidence, resources, and current state needed for verification.',
        'Verify the requested status or outcome without expanding into implementation work.',
        'Record the verification result, blockers, and any referenced artifacts.',
        'Write a concise completion note and finish the proposal task.',
      ]
    : [
        'Inspect the approved context and current state needed for this action.',
        'Perform the approved action exactly once.',
        'Verify the result and capture identifiers, statuses, or artifact paths.',
        'Write a concise completion note and finish the proposal task.',
      ];

  return descriptions.map((description, index) => ({ index, description, status: 'pending' }));
}

function proposalTouchesUnsupportedInternalCode(proposal: any): boolean {
  return proposalTouchesInternalCode(proposal)
    && !proposalUsesDevSrcSelfEditMode(proposal)
    && !proposalUsesDevSrcSelfEditRepairMode(proposal);
}

function proposalUsesDevSrcSelfEditRepairMode(proposal: any): boolean {
  return Boolean(proposal?.repairContext?.repairOnly) && proposalUsesDevSrcSelfEditMode(proposal);
}

function getProposalExecutorTaskStatus(proposal: any): TaskStatus | '' {
  const taskId = String(proposal?.executorTaskId || '').trim();
  if (!taskId) return '';
  const task = loadTask(taskId);
  return task?.status || '';
}

function enrichProposalExecutionState(proposal: any): any {
  if (String(proposal?.status || '').trim().toLowerCase() !== 'executing') return proposal;
  const taskStatus = getProposalExecutorTaskStatus(proposal);
  if (!taskStatus) return proposal;
  return {
    ...proposal,
    taskStatus,
    taskActive: PROPOSAL_ACTIVE_TASK_STATUSES.has(taskStatus),
    taskPaused: PROPOSAL_PAUSED_TASK_STATUSES.has(taskStatus),
  };
}

// ── GET /api/proposals ────────────────────────────────────────────────────────
router.get('/api/proposals', (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const sessionId = String(req.query.sessionId || '').trim();
    let proposals;

    if (!status || status === 'all') {
      proposals = listProposals();
    } else if (status === 'pending') {
      proposals = listProposals('pending');
    } else if (status === 'approved') {
      proposals = listProposals('approved');
    } else if (status === 'in_progress' || status === 'executing') {
      proposals = listProposals('executing').filter((proposal) => {
        const taskStatus = getProposalExecutorTaskStatus(proposal);
        if (!taskStatus) return true;
        return PROPOSAL_ACTIVE_TASK_STATUSES.has(taskStatus);
      });
    } else if (status === 'paused') {
      proposals = listProposals('executing').filter((proposal) => {
        const taskStatus = getProposalExecutorTaskStatus(proposal);
        return !!taskStatus && PROPOSAL_PAUSED_TASK_STATUSES.has(taskStatus);
      });
    } else if (status === 'denied') {
      proposals = listProposals('denied');
    } else if (status === 'executed') {
      proposals = listProposals(['executed', 'failed', 'expired']);
    } else {
      // Try as a direct status filter
      proposals = listProposals(status as ProposalStatus);
    }

    // If a sessionId filter is provided, only return proposals originating from
    // that session (or proposals with no session — e.g. background/team proposals
    // which should not appear in any specific session's right column)
    if (sessionId) {
      proposals = proposals.filter(p => p.sourceSessionId === sessionId);
    }

    proposals = proposals.map((proposal) => enrichProposalExecutionState(proposal));

    res.json({ success: true, proposals });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list proposals' });
  }
});

// ── GET /api/proposals/:id ────────────────────────────────────────────────────
router.get('/api/proposals/:id', (req: Request, res: Response) => {
  try {
    const proposal = loadProposal(req.params.id);
    if (!proposal) return res.status(404).json({ success: false, error: 'Proposal not found' });
    res.json({ success: true, proposal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to get proposal' });
  }
});

// ── PATCH /api/proposals/:id ──────────────────────────────────────────────────
router.patch('/api/proposals/:id', (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const updates = (body.updates && typeof body.updates === 'object') ? body.updates : body;
    const editedBy = String((body as any).editedBy || '').trim() || undefined;
    const note = String((body as any).note || '').trim() || undefined;

    const result = updatePendingProposal(req.params.id, updates, { editedBy, note });
    if (!result.ok) {
      if (result.error === 'not_found') {
        return res.status(404).json({ success: false, error: 'Proposal not found' });
      }
      if (result.error === 'not_pending') {
        return res.status(409).json({ success: false, error: 'Proposal is not pending and can no longer be edited' });
      }
      if (result.error === 'validation_failed') {
        return res.status(400).json({
          success: false,
          error: 'Proposal details missing required src-edit sections',
          missingSections: result.missingSections || [],
        });
      }
      return res.status(500).json({ success: false, error: 'Failed to update proposal' });
    }

    if (result.changed) {
      _broadcastFn?.({
        type: 'proposal_updated',
        proposalId: result.proposal.id,
        title: result.proposal.title,
        version: result.proposal.version,
      });
    }

    return res.json({ success: true, proposal: result.proposal, changed: result.changed });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to update proposal' });
  }
});


// ── POST /api/proposals/:id/approve ──────────────────────────────────────────
router.post('/api/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const existing = loadProposal(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    if (isPublicDistributionBuild() && proposalTouchesInternalCode(existing)) {
      return res.status(403).json({
        success: false,
        error: 'Internal code proposals are not available in the public distribution build.',
      });
    }

    const notes = String(req.body?.notes || '').trim() || undefined;
    const proposal = approveProposal(req.params.id, notes);
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    _broadcastFn?.({ type: 'proposal_approved', proposalId: proposal.id, title: proposal.title });
    let dispatchResult: { taskId: string; sessionId: string } | null = null;

    // Trigger if executorPrompt is set OR if proposal has affectedFiles + details (AI-generated proposals
    // put the full implementation plan in `details` and don't set executorPrompt explicitly). Wait only
    // until the executor task is created, so approval clicks cannot silently succeed without a real task.
    const hasExecutionPlan = !!(proposal.executorPrompt || (proposal.affectedFiles?.length && proposal.details));
    if (hasExecutionPlan) {
      try {
        dispatchResult = await dispatchApprovedProposal(proposal);
      } catch (err: any) {
        console.error(`[Proposals] Dispatch failed for ${proposal.id}:`, err?.message);
        _broadcastFn?.({ type: 'proposal_dispatch_error', proposalId: proposal.id, error: err?.message });
        return res.status(500).json({
          success: false,
          error: `Proposal approved, but executor dispatch failed: ${err?.message || 'Unknown error'}`,
          proposal: loadProposal(proposal.id) || proposal,
        });
      }
    }

    res.json({
      success: true,
      proposal: loadProposal(proposal.id) || proposal,
      dispatched: Boolean(dispatchResult),
      taskId: dispatchResult?.taskId,
      sessionId: dispatchResult?.sessionId,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve proposal' });
  }
});

/**
 * dispatchApprovedProposal — single canonical dispatch function.
 *
 * Called by BOTH the HTTP approval route AND the Telegram pr:ap callback.
 * Always sets sessionId = `proposal_${id}` so proposal results stay linked to the
 * original approval record. Source self-edit rights are now controlled by explicit
 * task metadata, not by the session prefix alone.
 * Exported so telegram-channel.ts can import and call it directly.
 */
export async function dispatchApprovedProposal(
  proposal: any,
  opts?: { channel?: 'web' | 'telegram'; telegramChatId?: number },
): Promise<{ taskId: string; sessionId: string }> {
  if (isPublicDistributionBuild() && proposalTouchesInternalCode(proposal)) {
    throw new Error('Internal code proposal execution is disabled in the public distribution build.');
  }
	  if (proposalTouchesUnsupportedInternalCode(proposal)) {
	    throw new Error('Automatic internal-code proposal execution is limited to approved dev self-edit proposals touching only src/ and/or web-ui/ files.');
	  }
  if (proposal?.teamExecution && proposalTouchesInternalCode(proposal)) {
    throw new Error('Team manager proposals cannot execute Prometheus internal source-code changes. Create dev src proposals from the main/dev agent path instead.');
  }

  const { launchBackgroundTaskRunner } = await import('../tasks/task-router.js');
  const { createTask } = await import('../tasks/task-store.js');
  const {
    markProposalExecuting,
    markProposalFailed,
    markProposalRepairing,
    hasSrcAffectedFiles,
  } = await import('../proposals/proposal-store.js');

  const proposalId = proposal.id;
  const executorPrompt = String(proposal.executorPrompt || '');
  const proposalMutationScope = buildProposalMutationScope(proposal);
  const repairContext = proposal?.repairContext && typeof proposal.repairContext === 'object'
    ? proposal.repairContext
    : undefined;
  const usesDevSrcSelfEditRepair = proposalUsesDevSrcSelfEditRepairMode(proposal);
  const usesDevSrcSelfEdit = !usesDevSrcSelfEditRepair && proposalUsesDevSrcSelfEditMode(proposal);
  const hasWebUiAffectedFiles = Array.isArray(proposal.affectedFiles) && proposal.affectedFiles.some((f: any) => {
    const p = String(f?.path || '').replace(/\\/g, '/').trim();
    return p.startsWith('web-ui/') || p.startsWith('./web-ui/') || p.includes('/web-ui/');
  });
  if ((usesDevSrcSelfEdit || usesDevSrcSelfEditRepair) && (!proposalMutationScope || proposalMutationScope.allowedFiles.length === 0)) {
    throw new Error('Dev self-edit proposals require at least one approved src/ or web-ui/ file in affectedFiles.');
  }
  const needsBuild = Boolean(proposal.requiresBuild) || hasSrcAffectedFiles(proposal.affectedFiles || []) || hasWebUiAffectedFiles;
		  const needsSrcEdit = Boolean(proposal.requiresSrcEdit) || hasSrcAffectedFiles(proposal.affectedFiles || []);
		  const needsWebUiEdit = hasWebUiAffectedFiles;
		  const needsPromRootEdit = (proposal.affectedFiles || []).some((f: any) => isPromRootAffectedPath(f?.path));
	  const sessionId = `proposal_${proposalId}`;
  const teamExecution = proposal?.teamExecution && typeof proposal.teamExecution === 'object'
    ? proposal.teamExecution
    : undefined;
  const executionLane = resolveProposalExecutionLane(proposal, {
    touchesInternalCode: proposalTouchesInternalCode(proposal),
    needsBuild,
  });
  const usesOperationalExecutionMode = !usesDevSrcSelfEdit && !usesDevSrcSelfEditRepair && executionLane !== 'code_change';
  if (executionLane === 'code_change' && !usesDevSrcSelfEdit && !usesDevSrcSelfEditRepair) {
    throw new Error('code_change proposals must touch only approved dev self-edit files under src/ and/or web-ui/. Use action or review for non-code approvals.');
  }
  const defaultBuildCommand = usesDevSrcSelfEditRepair || usesDevSrcSelfEdit
    ? (hasWebUiAffectedFiles ? 'npm run sync:web-ui && npm run build:backend' : 'npm run build:backend')
    : 'npm run build';
  const canonicalBuildCommand = String(repairContext?.canonicalBuildCommand || defaultBuildCommand).trim() || defaultBuildCommand;
  const devSrcSandboxBlock = usesDevSrcSelfEditRepair ? [
    ``,
    `SANDBOX MODE: Dev src build repair.`,
    `You are editing an isolated repair copy of a failed proposal sandbox, not the live repo.`,
    `Fix only the captured build failure. Do NOT continue implementing the original proposal in this repair task.`,
    `Only approved src/ and web-ui/ files are writable. After a successful repair build, finish with a concise repair summary; Prometheus will automatically hand the repaired sandbox back to the blocked original task.`,
  ].join('\n') : usesDevSrcSelfEdit ? [
    ``,
    `SANDBOX MODE: Dev src self-edit.`,
    `You are editing an isolated copy of Prometheus source code, not the live repo.`,
    `Only approved src/ and web-ui/ files are writable, and only scoped approved files will be promoted back after a successful build.`,
    `Do not create or edit files outside the approved code_change scope.`,
  ].join('\n') : '';

  const devSrcWorkspace = usesDevSrcSelfEditRepair
    ? prepareDevSrcRepairWorkspace(
      proposalId,
      String(repairContext?.failedWorkspaceRoot || '').trim(),
      proposalMutationScope?.allowedFiles || [],
    )
    : usesDevSrcSelfEdit
      ? prepareDevSrcSelfEditWorkspace(proposalId, proposalMutationScope?.allowedFiles || [])
      : undefined;

  // Build execution prompt with explicit src-tool instructions when needed
  const affectedFilesBlock = (proposal.affectedFiles || []).length > 0
    ? `\n\nAFFECTED FILES:\n${(proposal.affectedFiles || []).map((f: any) => `  - [${f.action || 'edit'}] ${f.path || '?'}: ${f.description || ''}`).join('\n')}`
    : '';
  const affectedResourcesBlock = buildAffectedResourcesBlock(proposal);
  const diffBlock = proposal.diffPreview
    ? `\n\nDIFF PREVIEW / REFERENCE:\n\`\`\`\n${proposal.diffPreview}\n\`\`\``
    : '';

  const srcToolBlock = needsSrcEdit ? [
    ``,
    `⚠️ CRITICAL — SRC EDIT TOOLS: You MUST use src-specific tools for ALL src/ edits.`,
    `Do NOT use find_replace, replace_lines, create_file, or write_file for src/ paths — those`,
    `resolve to workspace, not src/, and will FAIL with "file not found". Use ONLY:`,
    `  • source_stats(file)                                     — src/ file metadata`,
    `  • read_source(file, start_line?, num_lines?)               — read src/ file`,
    `  • list_source(path?)                                       — list src/ dir`,
    `  • grep_source(pattern, path?)                              — search src/`,
    `  • find_replace_source(file, find, replace)                 — text swap`,
    `  • replace_lines_source(file, start_line, end_line, new_content) — line edit`,
    `  • insert_after_source(file, after_line, content)           — insert lines`,
    `  • delete_lines_source(file, start_line, end_line)          — delete lines`,
    `  • write_source(file, content, overwrite?)                  — create/overwrite src file`,
    `Prefer find_replace_source with a complete exact anchor, or write_source for full-file rewrites.`,
    `Avoid fragile line-number edits after prior insertions/deletions. If you use line tools, re-read the exact surrounding lines immediately before each edit.`,
    `Source write tools reject syntactically invalid TypeScript/JavaScript before writing. Treat that as a correction signal and retry with a structurally complete edit.`,
	  ].join('\n') : '';
	  const promToolBlock = needsPromRootEdit ? [
	    ``,
	    `CRITICAL - PROM-ROOT EDIT TOOLS: You MUST use prom-root-specific tools for allowlisted project-root edits outside src/ and web-ui/.`,
	    `Do NOT use find_replace, replace_lines, create_file, write_file, or delete_file for these paths.`,
	    `Use ONLY:`,
	    `  - list_prom(path?)                                               - list allowlisted project-root dirs`,
	    `  - prom_file_stats(file)                                          - prom-root file metadata`,
	    `  - read_prom_file(file, start_line?, num_lines?, head?, tail?)     - read prom-root file`,
	    `  - grep_prom(pattern, path?, glob?, case_insensitive?)             - search prom-root`,
	    `  - find_replace_prom(file, find, replace)                         - text swap`,
	    `  - replace_lines_prom(file, start_line, end_line, new_content)     - line edit`,
	    `  - insert_after_prom(file, after_line, content)                   - insert lines`,
	    `  - delete_lines_prom(file, start_line, end_line)                  - delete lines`,
	    `  - write_prom_file(file, content, overwrite?)                     - create/overwrite prom-root file`,
	    `  - delete_prom_file(file)                                         - delete prom-root file`,
	  ].join('\n') : '';
  const webUiToolBlock = needsWebUiEdit ? [
    ``,
    `⚠️ CRITICAL — WEB-UI EDIT TOOLS: You MUST use web-ui-specific tools for ALL web-ui/ edits.`,
    `Do NOT use find_replace, replace_lines, create_file, or write_file for web-ui/ paths.`,
    `Use ONLY:`,
    `  • webui_source_stats(file)                                       — web-ui file metadata`,
    `  • read_webui_source(file, head?, tail?)                           — read web-ui file`,
    `  • list_webui_source(path?)                                         — list web-ui dir`,
    `  • grep_webui_source(pattern, path?, glob?, case_insensitive?)     — search web-ui`,
    `  • find_replace_webui_source(file, find, replace)                  — text swap`,
    `  • replace_lines_webui_source(file, start_line, end_line, new_content) — line edit`,
    `  • insert_after_webui_source(file, after_line, content)            — insert lines`,
    `  • delete_lines_webui_source(file, start_line, end_line)           — delete lines`,
    `  • write_webui_source(file, content, overwrite?)                   — create/overwrite web-ui file`,
  ].join('\n') : '';

  const approvedExecutionSteps = getApprovedExecutionSteps(proposal);
  const parsedSteps = parseExecutorPromptSteps(executorPrompt);
  if (!usesDevSrcSelfEditRepair && approvedExecutionSteps.length < 2) {
    throw new Error('Executable proposals must include at least two approved execution_steps. Revise the proposal with explicit inspect/action-or-edit/verify/complete steps before approval.');
  }

  const fullPrompt = usesOperationalExecutionMode
    ? buildOperationalProposalPrompt({
        proposal,
        proposalId,
        executorPrompt,
        lane: executionLane,
        affectedResourcesBlock,
        diffBlock,
      })
    : [
		    `[APPROVED PROPOSAL EXECUTION]`,
        `LANE: code_change`,
        `Proposal ID: ${proposalId}`,
        devSrcSandboxBlock,
		    srcToolBlock,
		    webUiToolBlock,
		    promToolBlock,
    ``,
    `TITLE: ${proposal.title || 'Untitled'}`,
    `PRIORITY: ${proposal.priority || 'medium'}`,
    `TYPE: ${proposal.type || 'general'}`,
    ``,
    `SUMMARY: ${proposal.summary || ''}`,
    ``,
    `FULL IMPLEMENTATION PLAN:`,
    proposal.details || proposal.summary || executorPrompt,
    buildExecutionStepsBlock(proposal),
    affectedFilesBlock,
    diffBlock,
    proposal.estimatedImpact ? `\nEXPECTED IMPACT: ${proposal.estimatedImpact}` : '',
    needsBuild ? `\nBUILD REQUIRED: Yes — run ${canonicalBuildCommand} after edits. MANDATORY. Stop if build fails — task will pause for assistance.` : '',
    ``,
    `GLOBAL RULES:`,
    `- Execute only the approved proposal scope and approved steps.`,
    `- Do not call declare_plan; execution_steps are already the task plan.`,
    `- Call step_complete after each approved step.`,
    `- If blocked or if an unapproved file is required, pause clearly instead of broadening scope.`,
    `- Write exactly one final write_note with tag "task_complete", then complete the task.`,
    ``,
    `CODE_CHANGE RULES:`,
    `- Use only source-specific tools for src/ and web-ui/ edits.`,
    `- Generic workspace write tools are disabled in this lane.`,
    `- Re-read before fragile line-number edits.`,
    `- Run the canonical verification command before completion.`,
    `- If verification fails, stop source edits and follow the repair-proposal flow only when explicitly allowed.`,
    ``,
    `INSTRUCTIONS:`,
	    `1. Read affected files with ${needsSrcEdit || needsWebUiEdit || needsPromRootEdit ? 'the correct source read tool first (read_source for src/, read_webui_source for web-ui/, read_prom_file for allowlisted prom-root files)' : 'read_file first'} to understand current state.`,
	    `2. Apply edits using ${needsSrcEdit || needsWebUiEdit || needsPromRootEdit ? 'the source tool matching the target path and edit operation (src/*_source for src/, webui/*_webui_source for web-ui/, *_prom for allowlisted prom-root files)' : 'find_replace or replace_lines'}.`,
    `3. For one-time parallel side work, use additive background primitives: background_spawn, background_status/background_progress, background_join.`,
    `4. ${needsBuild ? `Run: run_command({command:"${canonicalBuildCommand}", shell:true}). If it fails, STOP — do not retry.` : 'Verify your changes are correct.'}`,
    `5. Report exactly what was changed and any issues encountered.`,
    ``,
    executorPrompt ? `ADDITIONAL EXECUTOR INSTRUCTIONS:\n${executorPrompt}` : '',
    ``,
    `Proposal ID: ${proposalId}`,
  ].filter(Boolean).join('\n');

  // Build plan steps from executorPrompt numbered steps, or fall back to per-file steps
  const planSteps: Array<{ index: number; description: string; status: 'pending' }> = [];
  if (approvedExecutionSteps.length > 0) {
    planSteps.push(...approvedExecutionSteps);
    const lastDesc = (approvedExecutionSteps[approvedExecutionSteps.length - 1]?.description || '').toLowerCase();
    if (needsBuild && !/build|compile|restart/i.test(lastDesc)) {
      planSteps.push({ index: planSteps.length, description: `Run ${canonicalBuildCommand} to compile and verify. Stop immediately if build fails and hand off to a repair proposal.`, status: 'pending' });
    }
  } else if (usesOperationalExecutionMode) {
    planSteps.push(...buildOperationalPlanSteps(executionLane, executorPrompt, proposal.details));
  } else if (usesDevSrcSelfEditRepair) {
    planSteps.push(
      { index: 0, description: 'Inspect the captured build failure and failed sandbox state.', status: 'pending' },
      { index: 1, description: 'Apply the minimum repair to the approved src/web-ui files only.', status: 'pending' },
      { index: 2, description: `Run ${canonicalBuildCommand} in the repair sandbox and stop if it fails again.`, status: 'pending' },
    );
  } else if (parsedSteps.length >= 2) {
    parsedSteps.forEach((desc, i) => planSteps.push({ index: i, description: desc.slice(0, 300), status: 'pending' }));
    const lastDesc = (parsedSteps[parsedSteps.length - 1] || '').toLowerCase();
    if (needsBuild && !/build|compile|restart/i.test(lastDesc)) {
      planSteps.push({ index: planSteps.length, description: `Run ${canonicalBuildCommand} to compile and verify. Stop immediately if build fails and hand off to a repair proposal.`, status: 'pending' });
    }
  } else {
    let stepIdx = 0;
    planSteps.push({ index: stepIdx++, description: 'Read all affected source files to understand current state.', status: 'pending' });
    for (const af of (proposal.affectedFiles || [])) {
      const verb = af.action === 'create' ? 'Create' : af.action === 'delete' ? 'Delete' : 'Edit';
      planSteps.push({ index: stepIdx++, description: `${verb} ${af.path || '?'}${af.description ? ': ' + af.description : ''}`, status: 'pending' });
    }
    if (needsBuild) planSteps.push({ index: stepIdx++, description: `Run ${canonicalBuildCommand} to compile and verify. Stop if build fails — task will pause for assistance.`, status: 'pending' });
    planSteps.push({ index: stepIdx++, description: 'Verify all changes and report summary.', status: 'pending' });
  }

  console.log(`[Proposals] Dispatching: "${proposal.title}" (${proposalId}) — sessionId: ${sessionId}`);

	  try {
	    const taskChannel: 'web' | 'telegram' = opts?.channel === 'telegram' ? 'telegram' : 'web';
    let teamTaskContext: { callerContext: string; teamWorkspacePath?: string; agentName: string } | undefined;
    let teamExecutorProviderStr: string | undefined;
    if (teamExecution) {
      const { getManagedTeam } = await import('../teams/managed-teams.js');
      const {
        buildTeamSubagentCallerContext,
        resolveTeamSubagentModelRouting,
      } = await import('../teams/team-dispatch-runtime.js');
      const team = getManagedTeam(String(teamExecution.teamId || ''));
      const executorAgentId = String(teamExecution.executorAgentId || '').trim();
      if (!team) throw new Error(`Team not found for team proposal: ${teamExecution.teamId}`);
      if (!executorAgentId || !Array.isArray(team.subagentIds) || !team.subagentIds.includes(executorAgentId)) {
        throw new Error(`Assigned proposal executor "${executorAgentId || '(missing)'}" is not a member of team "${team.name || team.id}".`);
      }
      teamTaskContext = buildTeamSubagentCallerContext(
        team.id,
        executorAgentId,
        fullPrompt,
        { sourceLabel: 'TEAM PROPOSAL EXECUTION' },
      );
      teamExecutorProviderStr = resolveTeamSubagentModelRouting(executorAgentId).executorProvider;
    }
	    // Resolve executor model: explicit executorProviderId/Model takes priority,
    // then fall back to riskTier → agent_model_defaults config key.
	    let executorProviderStr: string | undefined = teamExecution
        ? teamExecutorProviderStr
        : proposal.executorProviderId && proposal.executorModel
          ? `${proposal.executorProviderId}/${proposal.executorModel}`
          : undefined;
	    if (!teamExecution && !executorProviderStr && proposal.riskTier) {
      try {
        const { getConfig } = await import('../../config/config.js');
        const cfgDefaults = (getConfig().getConfig() as any)?.agent_model_defaults || {};
        const configKey = proposal.riskTier === 'low' ? 'proposal_executor_low_risk' : 'proposal_executor_high_risk';
        const fromConfig: string | undefined = cfgDefaults[configKey];
        if (fromConfig) executorProviderStr = fromConfig;
      } catch { /* non-fatal — fall through to default */ }
    }
	    const task = createTask({
		      sessionId,
		      title: `[Proposal] ${proposal.title || 'Untitled'}`,
		      prompt: fullPrompt,
		      channel: teamExecution ? 'web' : taskChannel,
		      telegramChatId: !teamExecution && taskChannel === 'telegram' ? opts?.telegramChatId : undefined,
		      plan: planSteps,
		      executorProvider: executorProviderStr,
          agentWorkspace: devSrcWorkspace?.projectRoot || teamTaskContext?.teamWorkspacePath,
          originatingSessionId: teamExecution?.originatingSessionId,
          suppressOriginDelivery: Boolean(teamExecution),
          teamSubagent: teamExecution ? {
            teamId: String(teamExecution.teamId),
            agentId: String(teamExecution.executorAgentId),
            agentName: teamTaskContext?.agentName || teamExecution.executorAgentName,
            callerContext: teamTaskContext?.callerContext,
          } : undefined,
		      proposalExecution: {
	        proposalId,
            mode: usesDevSrcSelfEditRepair
              ? DEV_SRC_SELF_EDIT_REPAIR_MODE
              : usesDevSrcSelfEdit
                ? DEV_SRC_SELF_EDIT_MODE
                : executionLane,
            projectRoot: devSrcWorkspace?.projectRoot,
            liveProjectRoot: devSrcWorkspace?.liveProjectRoot,
            buildRequired: needsBuild,
            canonicalBuildCommand,
            liveFileBaselines: usesDevSrcSelfEdit ? devSrcWorkspace?.liveFileBaselines : undefined,
            promotion: usesDevSrcSelfEdit ? { status: 'pending' } : undefined,
		        mutationScope: proposalMutationScope,
	            repairContext: repairContext ? { ...repairContext } : undefined,
            teamExecution: teamExecution ? { ...teamExecution } : undefined,
		      },
		    });
	    // Mark proposal as executing with the REAL background task id.
	    markProposalExecuting(proposalId, task.id);
      if (usesDevSrcSelfEditRepair && repairContext?.resumeOriginalTaskId) {
        const originalTask = loadTask(String(repairContext.resumeOriginalTaskId));
        if (originalTask?.proposalExecution?.buildFailure) {
          originalTask.proposalExecution = {
            ...(originalTask.proposalExecution || {}),
            buildFailure: {
              ...originalTask.proposalExecution.buildFailure,
              status: 'repairing',
              repairProposalId: proposalId,
              repairTaskId: task.id,
            },
          };
          saveTask(originalTask);
          _broadcastFn?.({ type: 'task_panel_update', taskId: originalTask.id });
        }
      }
		    _broadcastFn?.({
          type: 'proposal_executing',
          proposalId,
          title: proposal.title,
          sessionId,
          taskId: task.id,
          channel: teamExecution ? 'team_chat' : taskChannel,
          teamId: teamExecution?.teamId,
          agentId: teamExecution?.executorAgentId,
        });
	    _broadcastFn?.({ type: 'bg_task_created', taskId: task.id, title: task.title });
	    launchBackgroundTaskRunner(task.id);
	    return { taskId: task.id, sessionId };
	  } catch (taskErr: any) {
	    console.error(`[Proposals] Task launch failed for ${proposalId}:`, taskErr?.message);
	    markProposalFailed(proposalId, taskErr?.message || 'Task launch failed');
      if (repairContext?.rootProposalId) {
        markProposalRepairing(
          String(repairContext.rootProposalId),
          `Repair proposal ${proposalId} could not be launched: ${taskErr?.message || 'Task launch failed'}.`,
        );
      }
	    throw taskErr;
	  }
}

// ── POST /api/proposals/:id/deny ─────────────────────────────────────────────
router.post('/api/proposals/:id/deny', (req: Request, res: Response) => {
  try {
    const notes = String(req.body?.notes || '').trim() || undefined;
    const proposal = denyProposal(req.params.id, notes);
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    _broadcastFn?.({ type: 'proposal_denied', proposalId: proposal.id, title: proposal.title });

    res.json({ success: true, proposal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to deny proposal' });
  }
});

// ── WS broadcast helper ───────────────────────────────────────────────────────
// server-v2 calls setBroadcastFn() once on startup to inject broadcastWS.
// This lets proposals anywhere in the system push live updates to the UI.

type BroadcastFn = (msg: Record<string, any>) => void;
let _broadcastFn: BroadcastFn | null = null;

export function setProposalsBroadcast(fn: BroadcastFn): void {
  _broadcastFn = fn;
  // Also wire the proposal-store so createProposal() anywhere auto-broadcasts
  setProposalStoreBroadcast(fn);
}

/**
 * Call this whenever a proposal is created anywhere in the system
 * (policy engine, team manager, nightly consolidator, etc.)
 * It sends a WS event so the right-column approval panel refreshes live.
 */
export function broadcastProposalCreated(proposal: {
  id: string;
  title: string;
  priority: string;
  sourceAgentId?: string;
  sourceTeamId?: string;
  sessionId?: string;
}): void {
  _broadcastFn?.({
    type: 'proposal_created',
    proposalId: proposal.id,
    title: proposal.title,
    priority: proposal.priority,
    sourceAgentId: proposal.sourceAgentId,
    sourceTeamId: proposal.sourceTeamId,
    // sessionId is present when created from a specific chat session
    // (right column shows it); absent for team/background proposals
    // (shows on Proposals page only)
    sessionId: proposal.sessionId,
  });
}

export { router };
