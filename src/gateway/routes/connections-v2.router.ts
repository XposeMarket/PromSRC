import { Router } from 'express';
import { getConnectionRuntime } from '../../connections/runtime';

export const router = Router();

router.get('/api/connection-discovery', (req, res) => {
  const service = String(req.query.service || '').trim();
  if (!service) { res.status(400).json({ success: false, error: 'service is required' }); return; }
  try { res.json({ success: true, discovery: getConnectionRuntime().orchestrator.discover(service) }); }
  catch (error: any) { res.status(500).json({ success: false, error: error?.message || String(error) }); }
});

router.get('/api/connection-attempts', (req, res) => {
  try { res.json({ success: true, attempts: getConnectionRuntime().orchestrator.listAttempts(Number(req.query.limit) || 50) }); }
  catch (error: any) { res.status(500).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connection-attempts', async (req, res) => {
  try {
    const serviceId = String(req.body?.serviceId || req.body?.service || '').trim();
    if (!serviceId) { res.status(400).json({ success: false, error: 'serviceId is required' }); return; }
    const runtime = getConnectionRuntime();
    const created = runtime.orchestrator.create({
      serviceId, serviceName: req.body?.serviceName,
      requestedCapabilities: Array.isArray(req.body?.requestedCapabilities) ? req.body.requestedCapabilities.map(String) : [],
      readOnly: req.body?.readOnly !== false,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : undefined,
    });
    const attempt = req.body?.plan === false ? created : await runtime.orchestrator.plan(created.id);
    res.json({ success: true, attempt });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.get('/api/connection-attempts/:id', (req, res) => {
  const attempt = getConnectionRuntime().orchestrator.getAttempt(req.params.id);
  if (!attempt) { res.status(404).json({ success: false, error: 'Connection attempt not found' }); return; }
  res.json({ success: true, attempt });
});

router.post('/api/connection-attempts/:id/connect', async (req, res) => {
  try { res.json({ success: true, attempt: await getConnectionRuntime().orchestrator.connect(req.params.id, req.body || {}) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connection-attempts/:id/continue', async (req, res) => {
  try { res.json({ success: true, attempt: await getConnectionRuntime().orchestrator.continue(req.params.id, req.body || {}) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connection-attempts/:id/verify', async (req, res) => {
  try { res.json({ success: true, attempt: await getConnectionRuntime().orchestrator.verify(req.params.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connection-attempts/:id/repair', async (req, res) => {
  try { res.json({ success: true, attempt: await getConnectionRuntime().orchestrator.repair(req.params.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connection-attempts/:id/cancel', (req, res) => {
  try { res.json({ success: true, attempt: getConnectionRuntime().orchestrator.cancel(req.params.id) }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.get('/api/connection-secure-input/:sessionId', (req, res) => {
  const status = getConnectionRuntime().secureInput.status(req.params.sessionId);
  res.status(status.valid ? 200 : 404).json({ success: status.valid, ...status });
});

router.post('/api/connection-secure-input/:sessionId', (req, res) => {
  try {
    const result = getConnectionRuntime().secureInput.submit(req.params.sessionId, req.body?.values || {});
    // Deliberately return only an opaque reference; submitted values never enter
    // chat history or a model-facing tool result.
    res.json({ success: true, credentialRef: result.credentialRef, fieldsReceived: result.fieldsReceived });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.get('/api/connections-v2', (_req, res) => {
  try { res.json({ success: true, connections: getConnectionRuntime().orchestrator.listConnections() }); }
  catch (error: any) { res.status(500).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connections-v2/:id/disconnect', async (req, res) => {
  try { await getConnectionRuntime().orchestrator.disconnect(req.params.id); res.json({ success: true }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});
