import { Router } from 'express';
import { getConfig } from '../../config/config';
import { getConnectionRuntime } from '../../connections/runtime';
import { listExtensionDescriptors } from '../../extensions/registry';
import { requireProtectedOwner, ownerSurfaceState, secureInputTransportAllowed } from './secure-access.router';
import { protectedPluginStorageAvailable, pluginCredentialState, setPluginCredentialState } from '../../security/plugin-credential-state';
import { clearXApiCredentials, clearXApiTokens, getXApiOAuthStatus } from '../../auth/x-api-oauth';
import { deleteBoundPluginCredential } from '../../connections/plugin-credential-binding';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../extensions/extension-bootstrap';

export const router = Router();
function services() {
  ensurePrometheusExtensionRuntimeLoaded();
  return [{ id: 'x', name: 'X · OAuth 2.0 app' }, ...listExtensionDescriptors()
    .filter(item => item.id !== 'x' && ((item.setup?.authType === 'api_key' && item.setup.fields?.length) || item.connection?.strategies?.some(strategy => strategy.adapter === 'api-key' || strategy.adapter === 'setup-token')))
    .map(item => ({ id: item.id, name: item.name }))];
}
router.use('/api/protected-plugins', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/api/protected-plugins', (req, res) => {
  res.json({ services: services(), owner: ownerSurfaceState(req), storageAvailable: protectedPluginStorageAvailable() });
});
router.post('/api/protected-plugins/request', async (req, res) => {
  if (!secureInputTransportAllowed(req) || !ownerSurfaceState(req).canApprove) { res.status(403).json({ error: 'OWNER_SURFACE_REQUIRED' }); return; }
  if (!protectedPluginStorageAvailable()) { res.status(409).json({ error: 'PROTECTED_STORAGE_REQUIRED' }); return; }
  const serviceId = String(req.body?.serviceId || '');
  if (serviceId === 'x' || !services().some(item => item.id === serviceId)) { res.status(400).json({ error: 'UNSUPPORTED_PLUGIN' }); return; }
  try {
    const runtime = getConnectionRuntime();
    const pending = runtime.orchestrator.listAttempts(50).find(item => item.serviceId === serviceId && item.state === 'awaiting_secure_input' && ['api-key', 'setup-token'].includes(item.plan?.strategy.adapter || '') && item.requiredUserAction?.type === 'secure-input' && runtime.secureInput.status(item.requiredUserAction.credentialSessionId || '').valid);
    if (pending?.requiredUserAction?.type === 'secure-input') {
      const action = pending.requiredUserAction;
      res.json({ request: { id: action.credentialSessionId, attemptId: pending.id, fields: action.fields, expiresAt: action.expiresAt } }); return;
    }
    const created = runtime.orchestrator.create({ serviceId, requestedCapabilities: [], readOnly: true });
    await runtime.orchestrator.plan(created.id);
    const attempt = await runtime.orchestrator.connect(created.id, { approved: true });
    const action = attempt.requiredUserAction;
    if (action?.type !== 'secure-input' || !action.credentialSessionId) throw new Error('UNSUPPORTED_PLUGIN');
    res.json({ request: { id: action.credentialSessionId, attemptId: attempt.id, fields: action.fields, expiresAt: action.expiresAt } });
  } catch { res.status(400).json({ error: 'PROTECTED_REQUEST_UNAVAILABLE' }); }
});
router.get('/api/protected-plugins/saved', (_req, res) => {
  const directory = getConfig().getConfigDir();
  const status = getXApiOAuthStatus(directory);
  const state = pluginCredentialState(directory, 'x');
  res.json({ credentials: [{ id: 'x', name: 'X OAuth app', configured: status.credentialsConfigured, connected: status.connected, stopped: state.stopped, history: state.history }], connections: getConnectionRuntime().orchestrator.listConnections().filter(item => item.credentialRef).map(item => ({ id: item.id, serviceId: item.serviceId, configured: item.configured, authenticated: item.authenticated, authState: item.authState, stopped: pluginCredentialState(directory, item.serviceId).stopped, history: pluginCredentialState(directory, item.serviceId).history })) });
});
router.post('/api/protected-plugins/x/:action', (req, res, next) => {
  if (req.params.action === 'stop') {
    if (!secureInputTransportAllowed(req)) { res.status(403).json({ error: 'SECURE_ORIGIN_REQUIRED' }); return; }
    next(); return;
  }
  requireProtectedOwner(req, res, next);
}, (req, res) => {
  const action = req.params.action;
  if (!['stop', 'disconnect', 'delete'].includes(action)) { res.status(400).json({ error: 'UNSUPPORTED_ACTION' }); return; }
  try {
    const directory = getConfig().getConfigDir();
    setPluginCredentialState(directory, 'x', true, action);
    clearXApiTokens(directory);
    if (action === 'delete') clearXApiCredentials(directory);
    res.json({ success: true, remoteRevoked: false, message: 'Local use stopped. Re-enter app credentials to reconnect. Issuer revocation is separate.' });
  } catch { res.status(400).json({ error: 'CREDENTIAL_ACTION_FAILED' }); }
});

router.post('/api/protected-plugins/connection/:id/:action', (req, res, next) => {
  if (req.params.action === 'stop') {
    if (!secureInputTransportAllowed(req)) { res.status(403).json({ error: 'SECURE_ORIGIN_REQUIRED' }); return; }
    next(); return;
  }
  requireProtectedOwner(req, res, next);
}, async (req, res) => {
  if (!['stop', 'disconnect', 'delete'].includes(req.params.action)) { res.status(400).json({ error: 'UNSUPPORTED_ACTION' }); return; }
  try {
    const runtime = getConnectionRuntime();
    const connection = runtime.orchestrator.listConnections().find(item => item.id === req.params.id);
    if (!connection || !['api-key', 'setup-token'].includes(connection.adapterId || '')) { res.status(404).json({ error: 'UNSUPPORTED_PLUGIN' }); return; }
    const directory = getConfig().getConfigDir();
    setPluginCredentialState(directory, connection.serviceId, true, req.params.action);
    if (req.params.action !== 'stop') await runtime.orchestrator.disconnect(connection.id);
    if (req.params.action === 'delete') deleteBoundPluginCredential(directory, connection.serviceId);
    res.json({ success: true, remoteRevoked: false });
  } catch { res.status(400).json({ error: 'CREDENTIAL_ACTION_FAILED' }); }
});
