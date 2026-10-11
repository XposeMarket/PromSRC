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
import { queryAuditLogAsync } from '../audit-log.js';
import { getDevEditLedger, getDevEditLedgerPatch } from '../dev-edit-ledger.js';

import { readContextReceipts, configureContextReceipts } from '../../runtime/context-receipt';

const router = Router();

// This router is mounted behind requireGatewayAuth + requireAccountAccess.
router.get('/api/context-receipts', (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...readContextReceipts({ id: typeof req.query.id === 'string' ? req.query.id : undefined, sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined, days: Number(req.query.days || 7), limit: Number(req.query.limit || 20), detail: req.query.detail === 'true' }) });
  } catch { res.status(400).json({ success: false, error: 'Invalid context receipt query' }); }
});
router.post('/api/context-receipts/settings', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    if ((body.enabled !== undefined && typeof body.enabled !== 'boolean') || (body.reset !== undefined && typeof body.reset !== 'boolean') || (body.retentionDays !== undefined && (!Number.isFinite(body.retentionDays) || body.retentionDays < 1 || body.retentionDays > 30))) return res.status(400).json({ success: false, error: 'Invalid receipt settings' });
    return res.json({ success: true, settings: configureContextReceipts(body) });
  } catch { return res.status(500).json({ success: false, error: 'Context receipt settings unavailable' }); }
});

router.get('/api/audit-log', async (req: Request, res: Response) => {
  try {
    const {
      from, to, agentId, toolName, tier, status,
      limit, offset, nonMainOnly,
    } = req.query as Record<string, string>;

    const result = await queryAuditLogAsync({
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
