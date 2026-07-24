/**
 * audit-log.router.ts — Phase 5
 *
 * REST endpoint for the audit log viewer (Audit page in the UI).
 *
 * GET /api/audit-log   — query log entries with optional filters
 *   ?from=ISO          — start date
 *   ?to=ISO            — end date
 *   ?agentId=string    — filter by agent
 *   ?toolName=string   — partial match on tool name
 *   ?tier=read|propose|commit
 *   ?status=auto|auto_allowed|approved|rejected|pending
 *   ?limit=number      — default 200, max 500
 *   ?offset=number     — for pagination
 */

import { Router, Request, Response } from 'express';
import { queryAuditLog, getRecentAuditSummary } from '../audit-log.js';
import { getDevEditLedger, getDevEditLedgerPatch } from '../dev-edit-ledger.js';

const router = Router();

router.get('/api/audit-log', (req: Request, res: Response) => {
  try {
    const {
      from, to, agentId, toolName, tier, status,
      limit, offset, nonMainOnly,
    } = req.query as Record<string, string>;

    const result = queryAuditLog({
      from: from || undefined,
      to: to || undefined,
      agentId: agentId || undefined,
      toolName: toolName || undefined,
      tier: tier as any || undefined,
      status: status as any || undefined,
      limit: limit ? Math.min(parseInt(limit, 10), 500) : 200,
      offset: offset ? parseInt(offset, 10) : 0,
      nonMainOnly: nonMainOnly === '1' || nonMainOnly === 'true',
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to query audit log' });
  }
});

// Immutable, mutation-grade source-edit record. The ID accepts either the
// internal dev_edit_* id or the human-facing DEV-YYYYMMDD-##### audit ID.
router.get('/api/dev-edits/:id', (req: Request, res: Response) => {
  const record = getDevEditLedger(String(req.params.id || ''));
  if (!record) return res.status(404).json({ success: false, error: 'Dev edit not found' });
  return res.json({ success: true, devEdit: record });
});

router.get('/api/dev-edits/:id/mutations/:sequence/patch', (req: Request, res: Response) => {
  const patch = getDevEditLedgerPatch(String(req.params.id || ''), Number(req.params.sequence));
  if (patch == null) return res.status(404).json({ success: false, error: 'Dev edit patch not found' });
  res.type('text/plain').send(patch);
});

export { router };
