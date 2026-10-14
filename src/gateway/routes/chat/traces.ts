import type { Router, RequestHandler } from 'express';
import { currentTrace, getTrace, listRecentTraces, recordSpan, runInTrace, withSpan } from '../../observability/turn-trace';



export function registerTracesRoutes(router: Router): void {
router.get('/api/traces', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  res.json({ traces: listRecentTraces(limit) });
});

router.get('/api/traces/:traceId', (req, res) => {
  const trace = getTrace(String(req.params.traceId || ''));
  if (!trace.spans.length) return res.status(404).json({ error: 'trace not found' });
  res.json(trace);
});
}

