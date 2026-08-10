// src/integrations/connector-registry.ts
// Loads all OAuth connector modules and routes OAuth start/callback/disconnect.
// Server-v2.ts imports this and delegates all /api/connections/oauth/* routes here.

import path from 'path';
import { OAuthConnector, OAuthStartResult, OAuthCallbackResult } from './oauth-base.js';
import { GmailConnector } from './connectors/gmail.js';
import { SlackConnector } from './connectors/slack.js';
import { GitHubConnector } from './connectors/github.js';
import { NotionConnector } from './connectors/notion.js';
import { RedditConnector } from './connectors/reddit.js';
import { GoogleDriveConnector } from './connectors/google-drive.js';
import { HubSpotConnector } from './connectors/hubspot.js';
import { SalesforceConnector } from './connectors/salesforce.js';
import { StripeConnector } from './connectors/stripe.js';
import { GoogleAnalyticsConnector } from './connectors/google-analytics.js';

// ─── Registry ─────────────────────────────────────────────────────────────────

const connectors = new Map<string, OAuthConnector>();

export function initConnectorRegistry(configDir: string): void {
  const registry: OAuthConnector[] = [
    new GmailConnector(configDir),
    new SlackConnector(configDir),
    new GitHubConnector(configDir),
    new NotionConnector(configDir),
    new RedditConnector(configDir),
    new GoogleDriveConnector(configDir),
    new HubSpotConnector(configDir),
    new SalesforceConnector(configDir),
    new StripeConnector(configDir),
    new GoogleAnalyticsConnector(configDir),
  ];
  for (const c of registry) connectors.set(c.id, c);
  console.log(`[Connectors] Registry loaded: ${[...connectors.keys()].join(', ')}`);
}

export function getConnector(id: string): OAuthConnector | undefined {
  return connectors.get(id);
}

export function listConnectors(): string[] {
  return [...connectors.keys()];
}

// ─── OAuth flow management ────────────────────────────────────────────────────

// Tracks in-flight callback listener promises keyed by connector ID
const pendingCallbacks = new Map<string, Promise<OAuthCallbackResult>>();
const completedCallbacks = new Map<string, { result: OAuthCallbackResult; expiresAt: number }>();
const COMPLETED_CALLBACK_TTL_MS = 10 * 60 * 1000;

/**
 * Start an OAuth flow for a connector.
 * Opens a local callback server in the background, then returns the auth URL.
 * The caller should open the auth URL in a browser.
 */
export function startOAuthFlowForConnector(id: string, expectedAccountId?: string, requestedScopes?: string[]): OAuthStartResult | { success: false; error: string } {
  const connector = connectors.get(id);
  if (!connector) return { success: false, error: `Unknown connector: ${id}` };
  if (pendingCallbacks.has(id)) return { success: false, error: `${id} authorization is already in progress.` };
  completedCallbacks.delete(id);

  // Generate and validate the provider URL before binding a local callback
  // listener. This avoids leaving a port listener behind when an app is not
  // configured, and startFlow never returns a blank-client authorization URL.
  const started = connector.startFlow(expectedAccountId, requestedScopes);
  if (started.error || !started.authUrl) return started;

  // Start the local callback listener (non-blocking)
  const callbackPromise = connector.listenForCallback();
  pendingCallbacks.set(id, callbackPromise);

  // Keep the completed result briefly so the UI cannot miss it between polls.
  callbackPromise
    .then((result) => {
      pendingCallbacks.delete(id);
      completedCallbacks.set(id, {
        result,
        expiresAt: Date.now() + COMPLETED_CALLBACK_TTL_MS,
      });
    })
    .catch((err: any) => {
      pendingCallbacks.delete(id);
      completedCallbacks.set(id, {
        result: { success: false, error: err?.message || String(err) },
        expiresAt: Date.now() + COMPLETED_CALLBACK_TTL_MS,
      });
    });

  return started;
}

/**
 * Poll whether an in-flight OAuth flow has completed.
 * Returns null if still pending, or the result if done.
 */
export async function pollOAuthResult(id: string): Promise<OAuthCallbackResult | null> {
  const completed = completedCallbacks.get(id);
  if (completed) {
    completedCallbacks.delete(id);
    if (Date.now() <= completed.expiresAt) return completed.result;
  }

  const pending = pendingCallbacks.get(id);
  if (!pending) return null;

  // Check if resolved without blocking
  let resolved = false;
  let result: OAuthCallbackResult | null = null;

  await Promise.race([
    pending.then(r => { resolved = true; result = r; }),
    new Promise(r => setTimeout(r, 50)), // 50ms non-blocking poll
  ]);

  return resolved ? result : null;
}

/**
 * Check if a connector is currently connected (has valid tokens).
 */
export function isConnectorConnected(id: string): boolean {
  return connectors.get(id)?.isConnected() ?? false;
}

/**
 * Disconnect a connector (clear tokens + connections.json).
 */
export function disconnectConnector(id: string): void {
  connectors.get(id)?.clearTokens();
}

/** Provider-side revoke is optional; local clearing remains the compatibility
 * fallback for providers without a revocation endpoint. */
export async function revokeConnectorAccess(id: string): Promise<{ supported: boolean }> {
  const connector = connectors.get(id) as (OAuthConnector & { revokeAccess?: () => Promise<void> }) | undefined;
  if (!connector?.revokeAccess) return { supported: false };
  await connector.revokeAccess();
  return { supported: true };
}

export function getConnectorOAuthMetadata(id: string): ReturnType<OAuthConnector['getOAuthMetadata']> | undefined {
  const connector = connectors.get(id);
  if (!connector) return undefined;
  try { return connector.getOAuthMetadata(); } catch { return undefined; }
}

/**
 * Get a valid access token for a connected connector.
 * Throws if not connected or if refresh fails.
 */
export async function getConnectorToken(id: string): Promise<string> {
  const connector = connectors.get(id);
  if (!connector) throw new Error(`Unknown connector: ${id}`);
  return connector.getValidAccessToken();
}

/**
 * Save OAuth client credentials (clientId + clientSecret) to the vault for a connector.
 * Called when the user enters credentials in the UI before starting OAuth.
 */
export function saveConnectorCredentials(id: string, clientId: string, clientSecret?: string): void {
  const connector = connectors.get(id);
  if (!connector) throw new Error(`Unknown connector: ${id}`);
  connector.saveCredentials(clientId, clientSecret || '');
}

/**
 * Return credential and connection status for all connectors — used by the UI.
 */
export function getConnectorStatuses(): Record<string, {
  connected: boolean;
  hasCredentials: boolean;
  authType: string;
  account?: ReturnType<OAuthConnector['getOAuthMetadata']>['account'];
  grantedScopes?: string[];
  expiresAt?: number;
  refreshAvailable?: boolean;
}> {
  const result: Record<string, {
    connected: boolean;
    hasCredentials: boolean;
    authType: string;
    account?: ReturnType<OAuthConnector['getOAuthMetadata']>['account'];
    grantedScopes?: string[];
    expiresAt?: number;
    refreshAvailable?: boolean;
  }> = {};
  for (const [id, c] of connectors.entries()) {
    const metadata = c.getOAuthMetadata();
    result[id] = {
      connected: c.isConnected(),
      hasCredentials: c.hasCredentials(),
      authType: 'oauth',
      account: metadata.account,
      grantedScopes: metadata.grantedScopes,
      expiresAt: metadata.expiresAt,
      refreshAvailable: metadata.refreshAvailable,
    };
  }
  return result;
}
