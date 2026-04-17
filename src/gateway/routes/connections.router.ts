/**
 * connections.router.ts — B1 Refactor
 *
 * CIS Phase 4: Connections API
 * Extracted verbatim from server-v2.ts (was L5554-L5720).
 *
 * GET  /api/connections                  — list all connection states
 * POST /api/connections/save             — mark a connector as connected
 * POST /api/connections/disconnect       — remove a connector
 * POST /api/connections/oauth/start      — initiate OAuth via connector registry
 * GET  /api/connections/oauth/poll       — check if in-flight OAuth completed
 * POST /api/connections/browser-open    — open Prometheus Chrome to login page
 * POST /api/connections/browser-verify  — verify login state in Prometheus Chrome
 * GET  /api/connections/activity        — fetch activity log for a connector
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getConfig } from '../../config/config.js';

export const router = Router();

// ─── File paths ───────────────────────────────────────────────────────────────

function getConnectionsFile(): string {
  return path.join(getConfig().getConfigDir(), 'connections.json');
}

function getConnectionsActivityFile(): string {
  return path.join(getConfig().getConfigDir(), 'connections-activity.jsonl');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConnections(): Record<string, any> {
  try {
    const connectionsFile = getConnectionsFile();
    if (!fs.existsSync(connectionsFile)) return {};
    return JSON.parse(fs.readFileSync(connectionsFile, 'utf-8'));
  } catch { return {}; }
}

function saveConnections(data: Record<string, any>): void {
  const connectionsFile = getConnectionsFile();
  fs.mkdirSync(path.dirname(connectionsFile), { recursive: true });
  fs.writeFileSync(connectionsFile, JSON.stringify(data, null, 2), 'utf-8');
}

function appendConnectionActivity(id: string, entry: any): void {
  try {
    const activityFile = getConnectionsActivityFile();
    fs.mkdirSync(path.dirname(activityFile), { recursive: true });
    fs.appendFileSync(activityFile, JSON.stringify({ ...entry, connectorId: id }) + '\n', 'utf-8');
  } catch {}
}

function readConnectionActivity(id: string, limit = 50): any[] {
  try {
    const activityFile = getConnectionsActivityFile();
    if (!fs.existsSync(activityFile)) return [];
    const lines = fs.readFileSync(activityFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.connectorId === id)
      .slice(-limit)
      .reverse();
  } catch { return []; }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/connections — list all connection states + credential/setup status per connector
router.get('/api/connections', (_req: any, res: any) => {
  try {
    const { getConnectorStatuses } = require('../integrations/connector-registry.js') as any;
    const statuses = getConnectorStatuses();
    res.json({ connections: loadConnections(), statuses });
  } catch {
    res.json({ connections: loadConnections(), statuses: {} });
  }
});

// POST /api/connections/credentials — save OAuth client credentials (or API key) to vault
router.post('/api/connections/credentials', async (req: any, res: any) => {
  const { id, clientId, clientSecret, apiKey } = req.body || {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const credKey = apiKey || clientId; // apiKey for Stripe, clientId for OAuth connectors
  if (!credKey) { res.status(400).json({ error: 'clientId or apiKey required' }); return; }
  try {
    const { saveConnectorCredentials } = require('../integrations/connector-registry.js') as any;
    saveConnectorCredentials(id, credKey, clientSecret || '');
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/connections/save — mark a connector as connected (browser-login flow)
router.post('/api/connections/save', (req: any, res: any) => {
  const { id, authType, verified } = req.body || {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const conns = loadConnections();
  conns[id] = { connected: !!verified, connectedAt: Date.now(), authType: authType || 'browser' };
  saveConnections(conns);
  res.json({ success: true });
});

// POST /api/connections/disconnect
router.post('/api/connections/disconnect', (req: any, res: any) => {
  const { id } = req.body || {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const conns = loadConnections();
  delete conns[id];
  saveConnections(conns);
  res.json({ success: true });
});

// POST /api/connections/oauth/start — initiate OAuth via connector registry
router.post('/api/connections/oauth/start', async (req: any, res: any) => {
  const { id } = req.body || {};
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  try {
    const { startOAuthFlowForConnector, getConnector } = require('../integrations/connector-registry.js') as any;
    const result = startOAuthFlowForConnector(id);
    if ('error' in result) {
      res.json({ url: null, needsSetup: true, needsCredentials: true, message: result.error });
      return;
    }
    // Check if clientId is blank (no env var and no vault credentials saved)
    if (!result.authUrl || result.authUrl.includes('client_id=&')) {
      res.json({ url: null, needsCredentials: true, message: `${id} OAuth credentials are not configured. Enter your Client ID and Client Secret.` });
      return;
    }
    res.json({ url: result.authUrl });
  } catch (e: any) {
    res.json({ url: null, error: e.message });
  }
});

// GET /api/connections/oauth/poll — check if in-flight OAuth completed
router.get('/api/connections/oauth/poll', async (req: any, res: any) => {
  const id = String(req.query?.id || '').trim();
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  try {
    const { pollOAuthResult } = require('../integrations/connector-registry.js') as any;
    const result = await pollOAuthResult(id);
    if (result === null) {
      res.json({ pending: true });
    } else {
      // Reload connections.json and return updated state
      const conns = loadConnections();
      res.json({ pending: false, success: result.success, account_email: result.account_email, error: result.error, connections: conns });
    }
  } catch (e: any) {
    res.json({ pending: false, success: false, error: e.message });
  }
});

// POST /api/connections/browser-open — open Prometheus Chrome (port 9222) to login page
router.post('/api/connections/browser-open', async (req: any, res: any) => {
  const { url } = req.body || {};
  if (!url) { res.status(400).json({ error: 'url required' }); return; }
  try {
    // Use browserOpen — the same function used by all Prometheus browser_* tools.
    // This opens the URL in the Playwright/CDP Chrome session on port 9222,
    // using the persistent Prometheus Chrome profile where logins are saved.
    const { browserOpen } = require('./browser-tools.js') as any;
    await browserOpen(url, 'connections_login');
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// POST /api/connections/browser-verify — verify login state in Prometheus Chrome session
router.post('/api/connections/browser-verify', async (req: any, res: any) => {
  const { id, checkUrl } = req.body || {};
  if (!checkUrl) { res.status(400).json({ error: 'checkUrl required' }); return; }
  try {
    // Navigate to the check URL in the same Prometheus Chrome session
    const { browserOpen, getBrowserSessionInfo } = require('./browser-tools.js') as any;
    await browserOpen(checkUrl, 'connections_login');
    // Give the page 2 seconds to settle after navigation
    await new Promise(r => setTimeout(r, 2000));
    // Read the current URL from the session — login detection is URL-based
    const info = typeof getBrowserSessionInfo === 'function'
      ? getBrowserSessionInfo('connections_login')
      : null;
    const currentUrl = String(info?.url || checkUrl).toLowerCase();

    // Platform-specific URL heuristics
    const loginSignals: Record<string, { loginPages: string[], loggedInSignals: string[] }> = {
      instagram: { loginPages: ['accounts/login', 'login'], loggedInSignals: ['direct', 'explore', 'reels', 'notifications', '/p/', '/?'] },
      tiktok:    { loginPages: ['login', 'signup'],          loggedInSignals: ['following', 'fyp', 'upload', 'inbox', 'profile'] },
      x:         { loginPages: ['i/flow/login', '/login'],   loggedInSignals: ['/home', '/compose', '/notifications', '/messages'] },
      linkedin:  { loginPages: ['/login', '/uas/login'],     loggedInSignals: ['/feed', '/mynetwork', '/jobs', '/messaging'] },
    };
    const signals = loginSignals[id as string] || { loginPages: ['login'], loggedInSignals: ['home', 'dashboard', 'feed', 'profile'] };

    const onLoginPage  = signals.loginPages.some(s => currentUrl.includes(s));
    const loggedIn     = signals.loggedInSignals.some(s => currentUrl.includes(s));

    if (loggedIn && !onLoginPage) {
      res.json({ verified: true });
    } else {
      res.json({ verified: false, message: `Not logged in yet (current page: ${currentUrl}). Complete login in the Prometheus browser window, then click Verify.` });
    }
  } catch (e: any) {
    res.json({ verified: false, message: 'Could not verify: ' + e.message });
  }
});

// GET /api/connections/activity — fetch activity log for a connector
router.get('/api/connections/activity', (req: any, res: any) => {
  const id = String(req.query?.id || '').trim();
  const limit = Math.min(100, parseInt(String(req.query?.limit || '50')));
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  res.json({ entries: readConnectionActivity(id, limit) });
});
