/**
 * approvals.router.ts — Phase 5
 *
 * REST endpoints for the approval queue (policy-gated tool calls).
 *
 * GET  /api/approvals          — list all approvals (filter by status via ?status=pending)
 * GET  /api/approvals/:id      — get a single approval record
 * POST /api/approvals/:id      — resolve an approval { decision: 'approved' | 'rejected' }
 */

import { Router, Request, Response } from 'express';
import { getApprovalQueue } from '../verification-flow.js';
import { getToolRegistry } from '../../tools/registry.js';

const router = Router();

// ── GET /api/approvals ────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const queue = getApprovalQueue();
    const status = String(req.query.status || '');
    const records = status === 'pending'
      ? queue.listPending()
      : queue.listAll();

    // Sort newest first (queue already does this but be explicit)
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ success: true, approvals: records });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list approvals' });
  }
});

// ── GET /api/approvals/:id ────────────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const record = getApprovalQueue().get(req.params.id);
    if (!record) return res.status(404).json({ success: false, error: 'Approval not found' });
    res.json({ success: true, approval: record });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to get approval' });
  }
});

// ── POST /api/approvals/:id ───────────────────────────────────────────────────
// Body: { decision: 'approved' | 'rejected' }
router.post('/:id', async (req: Request, res: Response) => {
  try {
    const { decision } = req.body || {};
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ success: false, error: 'decision must be "approved" or "rejected"' });
    }

    const queue = getApprovalQueue();
    const record = queue.resolve(req.params.id, decision === 'approved');
    if (!record) {
      return res.status(404).json({ success: false, error: 'Approval not found or already resolved' });
    }

    // If approved and it's a commit-tier tool, execute it now via bypass
    let executionResult: any = null;
    if (decision === 'approved' && record.policyTier === 'commit') {
      try {
        const registry = getToolRegistry();
        executionResult = await registry.executeBypass(record.toolName, record.toolArgs);
      } catch (execErr: any) {
        executionResult = { success: false, error: execErr?.message || 'Execution failed' };
      }
    }

    res.json({
      success: true,
      approval: record,
      executionResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to resolve approval' });
  }
});

export default router;
