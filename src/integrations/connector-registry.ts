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

/**
 * Start an OAuth flow for a connector.
 * Opens a local callback server in the background, then returns the auth URL.
 * The caller should open the auth URL in a browser.
 */
export function startOAuthFlowForConnector(id: string): OAuthStartResult | { success: false; error: string } {
  const connector = connectors.get(id);
  if (!connector) return { success: false, error: `Unknown connector: ${id}` };

  // Start the local callback listener (non-blocking)
  const callbackPromise = connector.listenForCallback();
  pendingCallbacks.set(id, callbackPromise);

  // Clean up after resolution
  callbackPromise.then(() => pendingCallbacks.delete(id)).catch(() => pendingCallbacks.delete(id));

  return connector.startFlow();
}

/**
 * Poll whether an in-flight OAuth flow has completed.
 * Returns null if still pending, or the result if done.
 */
export async function pollOAuthResult(id: string): Promise<OAuthCallbackResult | null> {
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

/**
 * Get a valid access token for a connected connector.
 * Throws if not connected or if refresh fails.
 */
export async function getConnectorToken(id: string): Promise<string> {
  const connector = connectors.get(id);
  if (!connector) throw new Error(`Unknown connector: ${id}`);
  return connector.getValidAccessToken();
}
