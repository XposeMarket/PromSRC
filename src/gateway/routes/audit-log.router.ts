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
 *   ?status=auto|approved|rejected|pending
 *   ?limit=number      — default 200, max 500
 *   ?offset=number     — for pagination
 */

import { Router, Request, Response } from 'express';
import { queryAuditLog, getRecentAuditSummary } from '../audit-log.js';

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

export { router };
