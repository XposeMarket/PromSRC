/**
 * connections.router.ts
 *
 * Connections API for connector status, credential setup, OAuth, and
 * browser-session login flows.
 */

import { Router } from 'express';
import { execFile } from 'child_process';
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
const refreshXAITools = () => require('../../extensions/xai-extension-adapter').refreshXAITools();
const saveXApiCredentials = (...args: any[]) => require('../../auth/x-api-oauth').saveXApiCredentials(...args);
const loadXApiCredentials = (...args: any[]) => require('../../auth/x-api-oauth').loadXApiCredentials(...args);
const startXApiOAuthFlowBackground = (...args: any[]) => require('../../auth/x-api-oauth').startXApiOAuthFlowBackground(...args);
const pollXApiOAuthBackground = () => require('../../auth/x-api-oauth').pollXApiOAuthBackground();
const clearXApiTokens = (...args: any[]) => require('../../auth/x-api-oauth').clearXApiTokens(...args);
const clearXApiCredentials = (...args: any[]) => require('../../auth/x-api-oauth').clearXApiCredentials(...args);

export const router = Router();

type XurlSetupState =
  | { pending: true; startedAt: number; appName: string; step: string; output: string[] }
  | { pending: false; success: boolean; appName: string; error?: string; username?: string; output: string[] };

let xurlSetupState: XurlSetupState | null = null;

function xurlBin(): string {
  if (process.platform === 'win32') {
    // Prefer the local workspace binary if the global npm install is broken/missing.
    const localBin = path.join(getConfig().getWorkspacePath(), 'tools', 'xurl-local', 'node_modules', '@xdevplatform', 'xurl', 'binary', 'xurl.exe');
    if (fs.existsSync(localBin)) return localBin;
    return 'xurl.cmd';
  }
  return 'xurl';
}

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function compactOutput(text: string): string {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .join('\n')
    .slice(0, 2000);
}

function runFileBin(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin),
      windowsHide: true,
      timeout: timeoutMs,
      env,
      maxBuffer: 1024 * 1024,
    }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        const detail = compactOutput(`${stderr || ''}\n${stdout || ''}`) || error.message;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function runXurl(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return runFileBin(xurlBin(), args, env, timeoutMs);
}

async function repairXurlWindowsInstall(env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic xurl binary repair is only implemented for Windows npm installs.');
  }
  const prefixResult = await runFileBin(npmBin(), ['config', 'get', 'prefix'], env, 30_000);
  const prefix = String(prefixResult.stdout || '').trim().split(/\r?\n/).pop()?.trim();
  if (!prefix) throw new Error('Could not resolve npm global prefix for xurl repair.');
  const script = `
$ErrorActionPreference = 'Stop'
$pkg = Join-Path ${JSON.stringify(prefix)} 'node_modules\\@xdevplatform\\xurl'
if (!(Test-Path $pkg)) { throw "xurl npm package not found at $pkg" }
$version = (Get-Content (Join-Path $pkg 'package.json') -Raw | ConvertFrom-Json).version
$zipUrl = "https://github.com/xdevplatform/xurl/releases/download/v$version/xurl_Windows_x86_64.zip"
$tmp = Join-Path $env:TEMP "xurl-repair-$version"
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp 'xurl.zip'
Invoke-WebRequest -Uri $zipUrl -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
New-Item -ItemType Directory -Path (Join-Path $pkg 'binary') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $tmp 'xurl.exe') -Destination (Join-Path $pkg 'binary\\xurl.exe') -Force
Write-Output "xurl.exe repaired at $(Join-Path $pkg 'binary\\xurl.exe')"
`;
  return runFileBin('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], env, 2 * 60_000);
}

async function runXurlSetup(configDir: string, appName: string, username?: string): Promise<void> {
  const credentials = loadXApiCredentials(configDir);
  if (!credentials?.client_id) throw new Error('Save X OAuth 2.0 Client ID/Secret before running xurl setup.');
  const redirectUri = String(credentials.redirect_uri || 'http://localhost:8080/callback');
  const env = { ...process.env, REDIRECT_URI: redirectUri };
  const output: string[] = [];
  const setStep = (step: string) => {
    xurlSetupState = { pending: true, startedAt: Date.now(), appName, step, output: output.slice(-12) };
  };
  const record = (label: string, result: { stdout: string; stderr: string }) => {
    const text = compactOutput(`${result.stdout}\n${result.stderr}`);
    output.push(text ? `${label}: ${text}` : `${label}: ok`);
  };

  try {
    setStep('Checking xurl');
    try {
      record('xurl --help', await runXurl(['--help'], env, 20_000));
    } catch (err: any) {
      output.push(`xurl --help: ${String(err?.message || err)}`);
      setStep('Installing or repairing xurl');
      record('npm install -g @xdevplatform/xurl', await runFileBin(npmBin(), ['install', '-g', '@xdevplatform/xurl'], env, 2 * 60_000));
      try {
        record('xurl --help', await runXurl(['--help'], env, 20_000));
      } catch (postInstallErr: any) {
        output.push(`xurl --help after npm install: ${String(postInstallErr?.message || postInstallErr)}`);
        record('repair xurl Windows binary', await repairXurlWindowsInstall(env));
        record('xurl --help', await runXurl(['--help'], env, 20_000));
      }
    }

    const addArgs = ['auth', 'apps', 'add', appName, '--client-id', credentials.client_id];
    if (credentials.client_secret) addArgs.push('--client-secret', credentials.client_secret);
    setStep('Registering xurl app profile');
    try {
      record('xurl auth apps add', await runXurl(addArgs, env, 30_000));
    } catch (err: any) {
      const updateArgs = ['auth', 'apps', 'update', appName, '--client-id', credentials.client_id];
      if (credentials.client_secret) updateArgs.push('--client-secret', credentials.client_secret);
      record('xurl auth apps update', await runXurl(updateArgs, env, 30_000));
    }

    setStep('Saving xurl redirect URI');
    record('xurl redirect-uri set', await runXurl(['auth', 'apps', 'redirect-uri', 'set', appName, redirectUri], env, 30_000));

    const oauthArgs = ['auth', 'oauth2', '--app', appName];
    if (username) oauthArgs.push(username);
    setStep('Waiting for xurl OAuth browser flow');
    record('xurl auth oauth2', await runXurl(oauthArgs, env, 5 * 60_000));

    setStep('Setting xurl default app');
    record('xurl auth default', await runXurl(['auth', 'default', appName], env, 30_000));

    setStep('Verifying xurl whoami');
    const whoami = await runXurl(['whoami'], env, 30_000);
    record('xurl whoami', whoami);
    const usernameMatch = /@?([A-Za-z0-9_]{1,20})/.exec(`${whoami.stdout}\n${whoami.stderr}`);
    const connections = loadSavedConnections();
    connections.x = { connected: true, connectedAt: Date.now(), authType: 'xurl' };
    saveSavedConnections(connections);
    appendConnectionActivity('x', {
      timestamp: Date.now(),
      action: 'connected',
      direction: 'out',
      title: 'Connected X via xurl',
      summary: 'xurl app profile, OAuth user context, default app, and whoami verification completed',
    });
    refreshXAITools();
    xurlSetupState = {
      pending: false,
      success: true,
      appName,
      username: usernameMatch?.[1],
      output: output.slice(-12),
    };
  } catch (err: any) {
    const message = String(err?.message || err);
    output.push(`error: ${message}`);
    xurlSetupState = {
      pending: false,
      success: false,
      appName,
      error: message,
      output: output.slice(-12),
    };
  }
}

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

router.post('/api/connections/xurl/setup', async (req: any, res: any) => {
  const id = String(req.body?.id || '').trim();
  if (id !== 'x') {
    res.status(400).json({ error: 'xurl setup is only available for the X connector.' });
    return;
  }
  if (xurlSetupState?.pending) {
    res.json({ pending: true, state: xurlSetupState });
    return;
  }

  const appName = String(req.body?.appName || 'prometheus').trim().replace(/[^A-Za-z0-9_.-]/g, '-') || 'prometheus';
  const username = String(req.body?.username || '').trim().replace(/^@+/, '') || undefined;
  xurlSetupState = {
    pending: true,
    startedAt: Date.now(),
    appName,
    step: 'Starting xurl setup',
    output: [],
  };
  runXurlSetup(getConfig().getConfigDir(), appName, username).catch((err: any) => {
    xurlSetupState = {
      pending: false,
      success: false,
      appName,
      error: String(err?.message || err),
      output: [],
    };
  });
  res.json({ pending: true, state: xurlSetupState });
});

router.get('/api/connections/xurl/poll', (_req: any, res: any) => {
  res.json(xurlSetupState || { pending: false, success: false, error: 'No xurl setup has been started yet.', output: [] });
});

router.post('/api/connections/credentials', async (req: any, res: any) => {
  const { id, clientId, clientSecret, apiKey, consumerKey, secretKey, bearerToken, redirectUri, scopes } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const credentialValue = apiKey || clientId || consumerKey;
  if (!credentialValue) {
    res.status(400).json({ error: 'clientId or apiKey required' });
    return;
  }

  try {
    if (id === 'x') {
      const xClientId = String(clientId || consumerKey || apiKey || '').trim();
      const xClientSecret = String(clientSecret || secretKey || '').trim();
      saveXApiCredentials(getConfig().getConfigDir(), {
        clientId: xClientId,
        clientSecret: xClientSecret,
        bearerToken: String(bearerToken || '').trim(),
        redirectUri: String(redirectUri || '').trim() || undefined,
        scopes,
      });
      const connections = loadSavedConnections();
      connections.x = {
        connected: false,
        connectedAt: Date.now(),
        authType: 'oauth',
      };
      saveSavedConnections(connections);
      appendConnectionActivity('x', {
        timestamp: Date.now(),
        action: 'credentials_saved',
        direction: 'out',
        title: 'Saved X Developer app credentials',
        summary: 'Authorize X OAuth user context to enable X API tools',
      });
      res.json({ success: true });
      return;
    }

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

router.post('/api/connections/disconnect', async (req: any, res: any) => {
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
      if (id === 'x') {
        clearXApiTokens(getConfig().getConfigDir());
        clearXApiCredentials(getConfig().getConfigDir());
        await runXurl(['auth', 'apps', 'remove', 'prometheus'], process.env, 30_000).catch(() => null);
        refreshXAITools();
      }
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
    if (id === 'x') {
      const result = await startXApiOAuthFlowBackground(getConfig().getConfigDir());
      res.json((result as any)?.authUrl
        ? { url: (result as any).authUrl }
        : {
            url: null,
            needsCredentials: !!(result as any)?.needsCredentials,
            message: (result as any)?.error || 'Could not start X API OAuth.',
            error: (result as any)?.error || 'Could not start X API OAuth.',
            redirectUri: (result as any)?.redirectUri,
          });
      return;
    }

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
    if (id === 'x') {
      const result = pollXApiOAuthBackground();
      if (!(result as any)?.done) {
        res.json({ pending: true });
        return;
      }
      if ((result as any)?.success) {
        const connections = loadSavedConnections();
        connections.x = {
          connected: true,
          connectedAt: Date.now(),
          authType: 'oauth',
        };
        saveSavedConnections(connections);
        appendConnectionActivity('x', {
          timestamp: Date.now(),
          action: 'connected',
          direction: 'out',
          title: 'Connected X API OAuth',
          summary: 'X connector authorized with OAuth 2.0 user context',
        });
        refreshXAITools();
      }
      res.json({
        pending: false,
        success: !!(result as any)?.success,
        error: (result as any)?.error,
        connections: loadSavedConnections(),
      });
      return;
    }

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
