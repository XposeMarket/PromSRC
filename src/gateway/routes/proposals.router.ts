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
  type ProposalStatus,
} from '../proposals/proposal-store.js';

const router = Router();

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
      proposals = listProposals(['approved', 'executing']);
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
    const notes = String(req.body?.notes || '').trim() || undefined;
    const proposal = approveProposal(req.params.id, notes);
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    _broadcastFn?.({ type: 'proposal_approved', proposalId: proposal.id, title: proposal.title });
    res.json({ success: true, proposal });

    // Dispatch execution fire-and-forget after responding — shared with Telegram path
    // Trigger if executorPrompt is set OR if proposal has affectedFiles + details (AI-generated proposals
    // put the full implementation plan in `details` and don't set executorPrompt explicitly)
    const hasExecutionPlan = !!(proposal.executorPrompt || (proposal.affectedFiles?.length && proposal.details));
    if (hasExecutionPlan) {
      setImmediate(() => {
        dispatchApprovedProposal(proposal).catch((err: any) => {
          console.error(`[Proposals] Dispatch failed for ${proposal.id}:`, err?.message);
          _broadcastFn?.({ type: 'proposal_dispatch_error', proposalId: proposal.id, error: err?.message });
        });
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to approve proposal' });
  }
});

/**
 * dispatchApprovedProposal — single canonical dispatch function.
 *
 * Called by BOTH the HTTP approval route AND the Telegram pr:ap callback.
 * Always sets sessionId = `proposal_${id}` so src-edit tools unlock correctly.
 * Exported so telegram-channel.ts can import and call it directly.
 */
export async function dispatchApprovedProposal(
  proposal: any,
  opts?: { channel?: 'web' | 'telegram'; telegramChatId?: number },
): Promise<{ taskId: string; sessionId: string }> {
  const { launchBackgroundTaskRunner } = await import('../tasks/task-router.js');
  const { createTask } = await import('../tasks/task-store.js');
  const { markProposalExecuting, markProposalFailed, hasSrcAffectedFiles } = await import('../proposals/proposal-store.js');

  const proposalId = proposal.id;
  const executorPrompt = String(proposal.executorPrompt || '');
  const hasWebUiAffectedFiles = Array.isArray(proposal.affectedFiles) && proposal.affectedFiles.some((f: any) => {
    const p = String(f?.path || '').replace(/\\/g, '/').trim();
    return p.startsWith('web-ui/') || p.startsWith('./web-ui/') || p.includes('/web-ui/');
  });
  const needsBuild = Boolean(proposal.requiresBuild) || hasSrcAffectedFiles(proposal.affectedFiles || []) || hasWebUiAffectedFiles;
  const needsSrcEdit = Boolean(proposal.requiresSrcEdit) || hasSrcAffectedFiles(proposal.affectedFiles || []);
  const needsWebUiEdit = hasWebUiAffectedFiles;
  const sessionId = `proposal_${proposalId}`;  // MUST start with 'proposal_' to unlock proposal-gated source edit tools

  // Build execution prompt with explicit src-tool instructions when needed
  const affectedFilesBlock = (proposal.affectedFiles || []).length > 0
    ? `\n\nAFFECTED FILES:\n${(proposal.affectedFiles || []).map((f: any) => `  - [${f.action || 'edit'}] ${f.path || '?'}: ${f.description || ''}`).join('\n')}`
    : '';
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

  const fullPrompt = [
    `[PROPOSAL EXECUTION] Executing approved proposal.`,
    srcToolBlock,
    webUiToolBlock,
    ``,
    `TITLE: ${proposal.title || 'Untitled'}`,
    `PRIORITY: ${proposal.priority || 'medium'}`,
    `TYPE: ${proposal.type || 'general'}`,
    ``,
    `SUMMARY: ${proposal.summary || ''}`,
    ``,
    `FULL IMPLEMENTATION PLAN:`,
    proposal.details || proposal.summary || executorPrompt,
    affectedFilesBlock,
    diffBlock,
    proposal.estimatedImpact ? `\nEXPECTED IMPACT: ${proposal.estimatedImpact}` : '',
    needsBuild ? `\nBUILD REQUIRED: Yes — run npm run build after edits. MANDATORY. Stop if build fails — task will pause for assistance.` : '',
    ``,
    `INSTRUCTIONS:`,
    `1. Read affected files with ${needsSrcEdit || needsWebUiEdit ? 'the correct source read tool first (read_source for src/, read_webui_source for web-ui/)' : 'read_file first'} to understand current state.`,
    `2. Apply edits using ${needsSrcEdit || needsWebUiEdit ? 'the source tool matching the target path and edit operation (src/*_source for src/, webui/*_webui_source for web-ui/)' : 'find_replace or replace_lines'}.`,
    `3. For one-time parallel side work, use additive background primitives: background_spawn, background_status/background_progress, background_join.`,
    `4. ${needsBuild ? 'Run: run_command({command:"npm run build", shell:true}). If it fails, STOP — do not retry.' : 'Verify your changes are correct.'}`,
    `5. Report exactly what was changed and any issues encountered.`,
    ``,
    executorPrompt ? `ADDITIONAL EXECUTOR INSTRUCTIONS:\n${executorPrompt}` : '',
    ``,
    `Proposal ID: ${proposalId}`,
  ].filter(Boolean).join('\n');

  // Build plan steps from executorPrompt numbered steps, or fall back to per-file steps
  const planSteps: Array<{ index: number; description: string; status: 'pending' }> = [];
  const parsedSteps = (() => {
    const lines = executorPrompt.split('\n');
    const steps: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s*(?:Step\s*)?(\d+)[.):]\s+(.+)/i);
      if (m) steps.push(m[2].trim());
    }
    return steps;
  })();

  if (parsedSteps.length >= 2) {
    parsedSteps.forEach((desc, i) => planSteps.push({ index: i, description: desc.slice(0, 300), status: 'pending' }));
    const lastDesc = (parsedSteps[parsedSteps.length - 1] || '').toLowerCase();
    if (needsBuild && !/build|compile|restart/i.test(lastDesc)) {
      planSteps.push({ index: planSteps.length, description: 'Run npm run build to compile and verify. Stop if build fails.', status: 'pending' });
    }
  } else {
    let stepIdx = 0;
    planSteps.push({ index: stepIdx++, description: 'Read all affected source files to understand current state.', status: 'pending' });
    for (const af of (proposal.affectedFiles || [])) {
      const verb = af.action === 'create' ? 'Create' : af.action === 'delete' ? 'Delete' : 'Edit';
      planSteps.push({ index: stepIdx++, description: `${verb} ${af.path || '?'}${af.description ? ': ' + af.description : ''}`, status: 'pending' });
    }
    if (needsBuild) planSteps.push({ index: stepIdx++, description: 'Run npm run build to compile and verify. Stop if build fails — task will pause for assistance.', status: 'pending' });
    planSteps.push({ index: stepIdx++, description: 'Verify all changes and report summary.', status: 'pending' });
  }

  console.log(`[Proposals] Dispatching: "${proposal.title}" (${proposalId}) — sessionId: ${sessionId}`);

  try {
    const taskChannel: 'web' | 'telegram' = opts?.channel === 'telegram' ? 'telegram' : 'web';
    // Resolve executor model: explicit executorProviderId/Model takes priority,
    // then fall back to riskTier → agent_model_defaults config key.
    let executorProviderStr: string | undefined =
      proposal.executorProviderId && proposal.executorModel
        ? `${proposal.executorProviderId}/${proposal.executorModel}`
        : undefined;
    if (!executorProviderStr && proposal.riskTier) {
      try {
        const { getConfig } = await import('../../config/config.js');
        const cfgDefaults = (getConfig().getConfig() as any)?.agent_model_defaults || {};
        const configKey = proposal.riskTier === 'low' ? 'proposal_executor_low_risk' : 'proposal_executor_high_risk';
        const fromConfig: string | undefined = cfgDefaults[configKey];
        if (fromConfig) executorProviderStr = fromConfig;
      } catch { /* non-fatal — fall through to default */ }
    }
    const task = createTask({
      sessionId,   // 'proposal_*' prefix is what gates src-edit tools in subagent-executor
      title: `[Proposal] ${proposal.title || 'Untitled'}`,
      prompt: fullPrompt,
      channel: taskChannel,
      telegramChatId: taskChannel === 'telegram' ? opts?.telegramChatId : undefined,
      plan: planSteps,
      executorProvider: executorProviderStr,
    });
    // Mark proposal as executing with the REAL background task id.
    markProposalExecuting(proposalId, task.id);
    _broadcastFn?.({ type: 'proposal_executing', proposalId, title: proposal.title, sessionId, taskId: task.id, channel: taskChannel });
    _broadcastFn?.({ type: 'bg_task_created', taskId: task.id, title: task.title });
    launchBackgroundTaskRunner(task.id);
    return { taskId: task.id, sessionId };
  } catch (taskErr: any) {
    console.error(`[Proposals] Task launch failed for ${proposalId}:`, taskErr?.message);
    markProposalFailed(proposalId, taskErr?.message || 'Task launch failed');
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
