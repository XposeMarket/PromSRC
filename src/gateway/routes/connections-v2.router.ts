import { Router } from 'express';
import { getConnectionRuntime } from '../../connections/runtime';
import { browserVisionScreenshot } from '../browser-tools';
import { desktopScreenshot, getDesktopAdvisorPacket } from '../desktop-tools';

export const router = Router();

router.get('/api/computer-use/frame/:sessionId', async (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  const source = String(req.query.source || 'browser').trim().toLowerCase();
  if (!sessionId) {
    res.status(400).json({ success: false, error: 'sessionId is required' });
    return;
  }

  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    if (source === 'browser') {
      const shot = await browserVisionScreenshot(sessionId);
      if (!shot?.base64) {
        res.status(404).json({ success: false, error: 'No browser frame is available for this session yet.' });
        return;
      }
      res.json({
        success: true,
        source: 'browser',
        capturedAt: Date.now(),
        frame: {
          base64: shot.base64,
          mimeType: shot.mimeType || 'image/png',
          width: shot.width,
          height: shot.height,
          viewportWidth: shot.viewportWidth || shot.width,
          viewportHeight: shot.viewportHeight || shot.height,
        },
      });
      return;
    }

    if (source === 'desktop') {
      await desktopScreenshot(sessionId, { skipOcr: true });
      const packet = getDesktopAdvisorPacket(sessionId);
      if (!packet?.screenshotBase64) {
        res.status(404).json({ success: false, error: 'No desktop frame is available for this session yet.' });
        return;
      }
      res.json({
        success: true,
        source: 'desktop',
        capturedAt: packet.capturedAt,
        frame: {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
          captureRegion: packet.captureRegion,
          virtualScreen: packet.virtualScreen,
        },
      });
      return;
    }

    res.status(400).json({ success: false, error: 'source must be browser or desktop' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || String(error) });
  }
});

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

router.get('/api/connections-v2/:id/tools', (req, res) => {
  try {
    const connection = getConnectionRuntime().orchestrator.listConnections().find((item) => item.id === req.params.id);
    if (!connection) { res.status(404).json({ success: false, error: 'Connection not found' }); return; }
    res.json({
      success: true,
      connectionId: connection.id,
      registeredTools: connection.registeredTools,
      availableTools: connection.availableTools ?? connection.registeredTools,
      exposedTools: connection.exposedTools,
      tools: connection.tools || [],
    });
  } catch (error: any) { res.status(500).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connections-v2/:id/tools', (req, res) => {
  try {
    const requested = req.body?.availableTools ?? req.body?.toolNames;
    if (!Array.isArray(requested)) { res.status(400).json({ success: false, error: 'availableTools must be an array' }); return; }
    const result = getConnectionRuntime().orchestrator.setToolAvailability(req.params.id, requested.map(String));
    res.json({
      success: true,
      connection: result.connection,
      rejectedTools: result.rejectedTools,
    });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});

router.post('/api/connections-v2/:id/disconnect', async (req, res) => {
  try { await getConnectionRuntime().orchestrator.disconnect(req.params.id); res.json({ success: true }); }
  catch (error: any) { res.status(400).json({ success: false, error: error?.message || String(error) }); }
});
