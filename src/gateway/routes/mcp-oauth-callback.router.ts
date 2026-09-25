import { Router } from 'express';
import { handleMcpOAuthCallback } from '../mcp-oauth.js';
import { getMCPManager } from '../mcp-manager.js';

export const router = Router();

// OAuth state is the single-use authorization boundary; do not require a phone session here.
router.get('/mcp-oauth/callback', async (req, res) => {
  try {
    const query = new URL(req.originalUrl, 'http://localhost').searchParams;
    const result = await handleMcpOAuthCallback(query);
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.type('html').send(result.html);
    if (result.ok && result.serverId) {
      void Promise.resolve().then(() => getMCPManager().connect(result.serverId!)).catch(() => {});
    }
  } catch {
    res.status(500).type('html').send('OAuth callback failed. Return to Prometheus and try again.');
  }
});
