/**
 * connections.router.ts
 *
 * Connections API for connector status, credential setup, OAuth, and
 * browser-session login flows.
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config.js';
import { getVault } from '../../security/vault.js';
import {
  disconnectConnector,
  getConnectorStatuses,
  pollOAuthResult,
  saveConnectorCredentials,
  startOAuthFlowForConnector,
} from '../../integrations/connector-registry.js';
import {
  getVercelCredentials,
  loadSavedConnections,
  saveSavedConnections,
} from '../../integrations/connection-state.js';
import {
  loadObsidianBridgeState,
  removeObsidianVault,
} from '../obsidian/bridge.js';
import { browserOpen, getBrowserSessionInfo } from '../browser-tools.js';

export const router = Router();

function getConnectionsActivityFile(): string {
  return path.join(getConfig().getConfigDir(), 'connections-activity.jsonl');
}

function appendConnectionActivity(id: string, entry: any): void {
  try {
    const activityFile = getConnectionsActivityFile();
    fs.mkdirSync(path.dirname(activityFile), { recursive: true });
    fs.appendFileSync(activityFile, JSON.stringify({ ...entry, connectorId: id }) + '\n', 'utf-8');
  } catch {
    // best effort
  }
}

function readConnectionActivity(id: string, limit = 50): any[] {
  try {
    const activityFile = getConnectionsActivityFile();
    if (!fs.existsSync(activityFile)) return [];
    const lines = fs.readFileSync(activityFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.connectorId === id)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

router.get('/api/connections', (_req: any, res: any) => {
  try {
    const statuses = getConnectorStatuses();
    const vercelCreds = getVercelCredentials();
    statuses.vercel = {
      connected: !!vercelCreds?.apiKey,
      hasCredentials: !!vercelCreds?.apiKey,
      authType: 'api_key',
    };
    const obsidianVaults = loadObsidianBridgeState().vaults;
    statuses.obsidian = {
      connected: obsidianVaults.some((vault) => vault.enabled !== false),
      hasCredentials: obsidianVaults.length > 0,
      authType: 'none',
    };
    res.json({ connections: loadSavedConnections(), statuses });
  } catch {
    const vercelCreds = getVercelCredentials();
    res.json({
      connections: loadSavedConnections(),
      statuses: {
        vercel: {
          connected: !!vercelCreds?.apiKey,
          hasCredentials: !!vercelCreds?.apiKey,
          authType: 'api_key',
        },
        obsidian: {
          connected: loadObsidianBridgeState().vaults.some((vault) => vault.enabled !== false),
          hasCredentials: loadObsidianBridgeState().vaults.length > 0,
          authType: 'none',
        },
      },
    });
  }
});

router.post('/api/connections/credentials', async (req: any, res: any) => {
  const { id, clientId, clientSecret, apiKey } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const credentialValue = apiKey || clientId;
  if (!credentialValue) {
    res.status(400).json({ error: 'clientId or apiKey required' });
    return;
  }

  try {
    if (id === 'vercel') {
      const projectId = String(req.body?.projectId || '').trim();
      const teamId = String(req.body?.teamId || '').trim();
      getVault(getConfig().getConfigDir()).set(
        'integration.vercel.credentials',
        JSON.stringify({ apiKey: credentialValue, projectId, teamId }),
        'connections:vercel:save',
      );
      res.json({ success: true });
      return;
    }

    saveConnectorCredentials(id, credentialValue, clientSecret || '');
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/api/connections/save', (req: any, res: any) => {
  const { id, authType, verified } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const connections = loadSavedConnections();
  connections[id] = {
    connected: !!verified,
    connectedAt: Date.now(),
    authType: authType || 'browser_session',
  };
  saveSavedConnections(connections);
  appendConnectionActivity(id, {
    timestamp: Date.now(),
    action: 'connected',
    direction: 'out',
    title: `Connected ${id}`,
    summary: `Connection saved using ${String(authType || 'browser_session')}`,
  });
  res.json({ success: true });
});

router.post('/api/connections/disconnect', (req: any, res: any) => {
  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  if (id === 'vercel') {
    try {
      getVault(getConfig().getConfigDir()).delete(
        'integration.vercel.credentials',
        'connections:vercel:disconnect',
      );
    } catch {
      // best effort
    }
  } else if (id === 'obsidian') {
    try {
      for (const vault of loadObsidianBridgeState().vaults) {
        removeObsidianVault(vault.id, { removeIndexedNotes: true });
      }
    } catch {
      // best effort
    }
  } else {
    try {
      disconnectConnector(id);
    } catch {
      // best effort
    }
  }

  const connections = loadSavedConnections();
  delete connections[id];
  saveSavedConnections(connections);
  appendConnectionActivity(id, {
    timestamp: Date.now(),
    action: 'disconnected',
    direction: 'out',
    title: `Disconnected ${id}`,
    summary: 'Connector access was removed',
  });
  res.json({ success: true });
});

router.post('/api/connections/oauth/start', async (req: any, res: any) => {
  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  try {
    const result = startOAuthFlowForConnector(id);
    if ('error' in result) {
      res.json({
        url: null,
        needsSetup: true,
        needsCredentials: true,
        message: result.error,
      });
      return;
    }

    if (!result.authUrl || result.authUrl.includes('client_id=&')) {
      res.json({
        url: null,
        needsCredentials: true,
        message: `${id} OAuth credentials are not configured. Enter your Client ID and Client Secret.`,
      });
      return;
    }

    res.json({ url: result.authUrl });
  } catch (e: any) {
    res.json({ url: null, error: e.message });
  }
});

router.get('/api/connections/oauth/poll', async (req: any, res: any) => {
  const id = String(req.query?.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  try {
    const result = await pollOAuthResult(id);
    if (result === null) {
      res.json({ pending: true });
      return;
    }

    res.json({
      pending: false,
      success: result.success,
      account_email: result.account_email,
      error: result.error,
      connections: loadSavedConnections(),
    });
  } catch (e: any) {
    res.json({ pending: false, success: false, error: e.message });
  }
});

router.post('/api/connections/browser-open', async (req: any, res: any) => {
  const { url } = req.body || {};
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  try {
    await browserOpen('connections_login', url);
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/api/connections/browser-verify', async (req: any, res: any) => {
  const { id, checkUrl } = req.body || {};
  if (!checkUrl) {
    res.status(400).json({ error: 'checkUrl required' });
    return;
  }

  try {
    await browserOpen('connections_login', checkUrl);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const info = getBrowserSessionInfo('connections_login');
    const currentUrl = String(info?.url || checkUrl).toLowerCase();

    const loginSignals: Record<string, { loginPages: string[]; loggedInSignals: string[] }> = {
      instagram: {
        loginPages: ['accounts/login', 'login'],
        loggedInSignals: ['direct', 'explore', 'reels', 'notifications', '/p/', '/?'],
      },
      tiktok: {
        loginPages: ['login', 'signup'],
        loggedInSignals: ['following', 'fyp', 'upload', 'inbox', 'profile'],
      },
      x: {
        loginPages: ['i/flow/login', '/login'],
        loggedInSignals: ['/home', '/compose', '/notifications', '/messages'],
      },
      linkedin: {
        loginPages: ['/login', '/uas/login'],
        loggedInSignals: ['/feed', '/mynetwork', '/jobs', '/messaging'],
      },
    };
    const signals = loginSignals[id as string] || {
      loginPages: ['login'],
      loggedInSignals: ['home', 'dashboard', 'feed', 'profile'],
    };

    const onLoginPage = signals.loginPages.some((signal) => currentUrl.includes(signal));
    const loggedIn = signals.loggedInSignals.some((signal) => currentUrl.includes(signal));

    if (loggedIn && !onLoginPage) {
      res.json({ verified: true });
      return;
    }

    res.json({
      verified: false,
      message: `Not logged in yet (current page: ${currentUrl}). Complete login in the Prometheus browser window, then click Verify.`,
    });
  } catch (e: any) {
    res.json({ verified: false, message: 'Could not verify: ' + e.message });
  }
});

router.get('/api/connections/activity', (req: any, res: any) => {
  const id = String(req.query?.id || '').trim();
  const limit = Math.min(100, parseInt(String(req.query?.limit || '50'), 10));
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  res.json({ entries: readConnectionActivity(id, limit) });
});
