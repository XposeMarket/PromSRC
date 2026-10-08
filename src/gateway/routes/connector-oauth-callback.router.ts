import { Router } from 'express';
import { GATEWAY_OAUTH_CALLBACK_PREFIX, completeGatewayOAuthCallback } from '../../integrations/gateway-oauth-callback.js';
import { PUBLIC_MEDIA_PREFIX, resolvePublicMedia } from '../../integrations/public-media-share.js';

export const router = Router();

function escapeHtml(value: string): string {
  return String(value || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
}

function page(ok: boolean, title: string, detail: string): string {
  return `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1a2e;color:#e8edf6">
    <h2 style="color:${ok ? '#31b884' : '#e06d6d'}">${escapeHtml(title)}</h2>
    <p style="color:#aeb9cb">${escapeHtml(detail)}</p>
    <p style="color:#aeb9cb">You can close this window and return to Prometheus.</p>
  </body></html>`;
}

// Short-lived public media shares (Instagram/LinkedIn fetch media by URL).
// The 32-byte random token is the capability; each token maps to one file.
router.get(`${PUBLIC_MEDIA_PREFIX}:token/:name`, (req, res) => {
  const share = resolvePublicMedia(String(req.params.token || ''));
  if (!share) return res.status(404).end();
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Content-Type': share.mime });
  res.sendFile(share.filePath, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// OAuth state is the single-use authorization boundary (same model as
// /mcp-oauth/callback); only connectors with a pending flow are accepted.
router.get(`${GATEWAY_OAUTH_CALLBACK_PREFIX}:id`, async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const id = String(req.params.id || '').toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(id)) return res.status(404).type('html').send(page(false, 'Not found', 'Unknown connector.'));
  try {
    const result = await completeGatewayOAuthCallback(id, req.query as any);
    if (!result) return res.status(404).type('html').send(page(false, 'No authorization in progress', 'Start the connection again from Prometheus.'));
    if (result.success) return res.type('html').send(page(true, 'Connected!', result.account_email ? `Signed in as ${result.account_email}` : 'Authorization complete.'));
    return res.status(400).type('html').send(page(false, 'Connection failed', result.error || 'Unknown error'));
  } catch {
    return res.status(500).type('html').send(page(false, 'Connection failed', 'OAuth callback failed. Try again.'));
  }
});
