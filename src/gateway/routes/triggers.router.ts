/**
 * triggers.router.ts - inbound webhook endpoints + trigger admin API.
 *
 * Public (secret-authenticated, mounted BEFORE gateway auth):
 *   POST /triggers/hook/:id            HMAC (X-Hub-Signature-256 / X-Prometheus-Signature) or token header
 *   POST /triggers/hook/:id/:token     secret embedded in the URL (for senders that cannot sign)
 *
 * Admin (gateway auth):
 *   GET/POST/PATCH/DELETE /api/triggers/endpoints[/:id]
 *   GET/POST/PATCH/DELETE /api/triggers/rules[/:id]
 *   GET  /api/triggers/runs
 *   POST /api/triggers/test          dispatch a manual/webhook-shaped event through the engine
 */
import express from 'express';
import { getTriggerService } from '../triggers/trigger-service';
import {
  extractWebhookEventMeta,
  parseWebhookBody,
  publicEndpointView,
  verifyWebhookRequest,
  WEBHOOK_ENDPOINT_ID_RE,
} from '../triggers/webhook-endpoints';
import { manualTriggerEvent, webhookTriggerEvent } from '../triggers/trigger-adapters';
import { buildTriggerRuleFromInput, summarizeDispatch } from '../triggers/trigger-rule-input';

export const TRIGGER_HOOK_MAX_BYTES = 2 * 1024 * 1024;

/** Raw-body parser for the public hook path; must run before express.json(). */
export function triggerHookRawBodyMiddleware(): express.RequestHandler {
  const raw = express.raw({ type: () => true, limit: TRIGGER_HOOK_MAX_BYTES });
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    raw(req, res, (err?: any) => {
      if (err) {
        res.status(err?.type === 'entity.too.large' ? 413 : 400).json({ ok: false, error: err?.type === 'entity.too.large' ? 'Payload too large (2 MiB max)' : 'Invalid body' });
        return;
      }
      (req as any).triggerRawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      next();
    });
  };
}

function unavailable(res: express.Response): void {
  res.status(503).json({ ok: false, error: 'Trigger service is not initialized' });
}

// ── Public hook router ───────────────────────────────────────────────────────
export const triggerHookRouter = express.Router();

async function handleHook(req: express.Request, res: express.Response): Promise<void> {
  const svc = getTriggerService();
  if (!svc) return unavailable(res);
  const id = String(req.params.id || '').trim().toLowerCase();
  // Uniform 404 for unknown/disabled/invalid so endpoint ids can't be probed.
  const ep = WEBHOOK_ENDPOINT_ID_RE.test(id) ? svc.endpoints.get(id) : null;
  if (!ep || !ep.enabled) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  const rawBody: Buffer = (req as any).triggerRawBody || Buffer.alloc(0);
  const auth = verifyWebhookRequest(ep, { pathToken: req.params.token, headers: req.headers as any, rawBody });
  if (!auth.ok) {
    console.warn(`[Triggers] Rejected webhook ${id}: ${auth.reason}`);
    res.status(req.params.token ? 404 : 401).json({ ok: false, error: req.params.token ? 'Not found' : 'Unauthorized' });
    return;
  }

  const body = parseWebhookBody(rawBody, String(req.headers['content-type'] || ''));
  const meta = extractWebhookEventMeta(ep, req.headers as any, body as any);
  // GitHub sends "ping" once when a hook is created. Acknowledge without running rules.
  if (meta.eventType === 'ping') {
    svc.endpoints.recordDelivery(ep.id, 'ping');
    res.status(200).json({ ok: true, endpoint: ep.id, event: 'ping', pong: true });
    return;
  }

  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query || {})) if (typeof v === 'string') query[k.slice(0, 80)] = v.slice(0, 500);
  const event = webhookTriggerEvent({
    provider: ep.id,
    deliveryId: meta.deliveryId,
    eventType: meta.eventType,
    payload: { ...body, ...(Object.keys(query).length ? { _query: query } : {}) },
  });
  if (meta.subject) event.subject = meta.subject;
  event.metadata = { ...(event.metadata || {}), endpointKind: ep.kind, authMethod: auth.method };
  svc.endpoints.recordDelivery(ep.id, meta.eventType);

  try {
    const summary = await svc.runtime.dispatch(event);
    console.log(`[Triggers] ${ep.id} ${meta.eventType} -> matched ${summary.matchedRuleIds.length} rule(s)`);
    res.status(202).json({ ok: true, endpoint: ep.id, ...summarizeDispatch(summary) });
  } catch (error: any) {
    console.warn(`[Triggers] dispatch failed for ${ep.id}: ${String(error?.message || error)}`);
    res.status(500).json({ ok: false, error: 'Dispatch failed' });
  }
}

triggerHookRouter.post('/triggers/hook/:id', (req, res) => { void handleHook(req, res); });
triggerHookRouter.post('/triggers/hook/:id/:token', (req, res) => { void handleHook(req, res); });
triggerHookRouter.get('/triggers/hook/:id', (_req, res) => { res.status(405).json({ ok: false, error: 'Use POST' }); });

// ── Admin router (mounted behind gateway auth) ───────────────────────────────
export const triggersAdminRouter = express.Router();

function baseUrl(req: express.Request): string {
  const svc = getTriggerService();
  const configured = svc?.endpoints.getPublicBaseUrl();
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}`;
}

triggersAdminRouter.get('/api/triggers/endpoints', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  const reveal = req.query.reveal === '1' || req.query.reveal === 'true';
  res.json({ ok: true, publicBaseUrl: svc.endpoints.getPublicBaseUrl() || null, endpoints: svc.endpoints.list().map((ep) => publicEndpointView(ep, { reveal, baseUrl: baseUrl(req) })) });
});

triggersAdminRouter.post('/api/triggers/endpoints', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  try {
    const ep = svc.endpoints.create({ id: req.body?.id, name: req.body?.name, kind: req.body?.kind, description: req.body?.description });
    res.json({ ok: true, endpoint: publicEndpointView(ep, { reveal: true, baseUrl: baseUrl(req) }) });
  } catch (error: any) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

triggersAdminRouter.patch('/api/triggers/endpoints/:id', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  try {
    const ep = svc.endpoints.update(req.params.id, { name: req.body?.name, enabled: req.body?.enabled, description: req.body?.description, kind: req.body?.kind, rotateSecret: req.body?.rotate_secret === true });
    res.json({ ok: true, endpoint: publicEndpointView(ep, { reveal: req.body?.rotate_secret === true, baseUrl: baseUrl(req) }) });
  } catch (error: any) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

triggersAdminRouter.delete('/api/triggers/endpoints/:id', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  res.json({ ok: svc.endpoints.delete(req.params.id) });
});

triggersAdminRouter.get('/api/triggers/rules', (_req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  res.json({ ok: true, rules: svc.runtime.listRules() });
});

triggersAdminRouter.post('/api/triggers/rules', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  try {
    const rule = svc.runtime.upsertRule(buildTriggerRuleFromInput(req.body || {}, null));
    res.json({ ok: true, rule });
  } catch (error: any) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

triggersAdminRouter.patch('/api/triggers/rules/:id', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  const existing = svc.runtime.getRule(req.params.id);
  if (!existing) return void res.status(404).json({ ok: false, error: 'Rule not found' });
  try {
    const rule = svc.runtime.upsertRule(buildTriggerRuleFromInput({ ...(req.body || {}), id: existing.id }, existing));
    res.json({ ok: true, rule });
  } catch (error: any) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

triggersAdminRouter.delete('/api/triggers/rules/:id', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  res.json({ ok: svc.runtime.deleteRule(req.params.id) });
});

triggersAdminRouter.get('/api/triggers/runs', (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  res.json({ ok: true, runs: svc.runtime.store.listRuns(Number(req.query.limit) || 50) });
});

triggersAdminRouter.post('/api/triggers/test', async (req, res) => {
  const svc = getTriggerService(); if (!svc) return unavailable(res);
  try {
    const b = req.body || {};
    const event = b.endpoint_id
      ? webhookTriggerEvent({ provider: String(b.endpoint_id), deliveryId: `test_${Date.now()}`, eventType: String(b.event_type || 'test'), payload: b.payload || {} })
      : manualTriggerEvent({ eventType: String(b.event_type || 'run'), payload: b.payload || {}, subject: b.subject, sourceId: b.source_id });
    const summary = await svc.runtime.dispatch(event);
    res.json({ ok: true, ...summarizeDispatch(summary) });
  } catch (error: any) { res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});
