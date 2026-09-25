/**
 * chatgpt-bridge-registry.ts
 *
 * State for the Prometheus MCP bridge that lets ChatGPT (running as a
 * Prometheus model through the web backend) call Prometheus tools.
 *
 *  - A random bridge secret is generated once and stored in
 *    <configDir>/chatgpt-bridge.json. The public MCP URL embeds it
 *    (/mcp/chatgpt/<secret>), so only a caller that knows the URL can reach
 *    the bridge; the gateway also refuses every call unless a ChatGPT turn is
 *    currently active (see chatgpt-bridge-sessions.ts).
 *  - The ChatGPT dev-mode connector id created for that URL is cached per
 *    Codex account so the adapter can attach it to messages
 *    (selected_mcp_sources) without re-registering.
 *
 * Registration uses the same Codex OAuth session: POST /backend-api/aip/connectors/mcp
 * with { name, mcp_url, auth_request:{ supported_auth:[{type:"NONE"}] } }, then
 * POST /aip/connectors/links/noauth to link it (shapes read from the
 * chatgpt.com dev-mode "Create app" flow, 2026-09-25).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getValidToken, loadTokens } from '../../auth/openai-oauth';
import { buildChatGPTWebHeaders, CHATGPT_WEB_ORIGIN } from './chatgpt-web-client';

export const CHATGPT_BRIDGE_CONNECTOR_NAME = 'Prometheus';
export const CHATGPT_BRIDGE_ROUTE_PREFIX = '/mcp/chatgpt/';
const REGISTRATION_RETRY_MS = 10 * 60_000;

interface BridgeAccountState {
  connectorId: string;
  linkId?: string;
  mcpUrl: string;
  /** Signature of the tool catalog ChatGPT last snapshotted for this connector. */
  catalogSignature?: string;
  registeredAt: string;
}

interface BridgeState {
  secret: string;
  accounts: Record<string, BridgeAccountState>;
  lastError?: { message: string; at: string };
}

function statePath(): string {
  return path.join(getConfig().getConfigDir(), 'chatgpt-bridge.json');
}

function readState(): BridgeState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (parsed && typeof parsed.secret === 'string' && parsed.secret.length >= 32) {
      return { secret: parsed.secret, accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {}, lastError: parsed.lastError };
    }
  } catch { /* first run */ }
  const fresh: BridgeState = { secret: crypto.randomBytes(24).toString('base64url'), accounts: {} };
  writeState(fresh);
  return fresh;
}

function writeState(state: BridgeState): void {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function getChatGPTBridgeSecret(): string {
  return readState().secret;
}

/** Never let the URL secret reach logs, stored errors, or the UI. */
export function redactBridgeSecret(text: string): string {
  return String(text || '').replace(/\/mcp\/chatgpt\/[A-Za-z0-9_-]+/g, '/mcp/chatgpt/[secret]');
}

/** Constant-time check of the secret embedded in the MCP URL. */
export function isValidChatGPTBridgeSecret(candidate: unknown): boolean {
  const expected = Buffer.from(getChatGPTBridgeSecret());
  const actual = Buffer.from(String(candidate || ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Public HTTPS origin ChatGPT's servers can reach (Tailscale Funnel / remote access). */
export function getChatGPTBridgePublicOrigin(): string {
  const cfg = getConfig().getConfig() as any;
  const explicit = String(cfg?.llm?.providers?.openai_codex?.chatgpt?.bridge_public_url || '').trim();
  const remote = String(cfg?.gateway?.remoteAccess?.publicUrl || cfg?.remoteAccess?.publicUrl || '').trim();
  const origin = explicit || remote;
  if (!/^https:\/\//i.test(origin)) return '';
  return origin.replace(/\/+$/, '');
}

export function getChatGPTBridgeMcpUrl(): string {
  const origin = getChatGPTBridgePublicOrigin();
  return origin ? `${origin}${CHATGPT_BRIDGE_ROUTE_PREFIX}${getChatGPTBridgeSecret()}` : '';
}

function bridgeEnabled(): boolean {
  const cfg = (getConfig().getConfig() as any)?.llm?.providers?.openai_codex?.chatgpt || {};
  // Experimental and opt-in: ChatGPT registers the connector and scopes it
  // into the turn, but does not yet surface its tools to the model (see PR).
  return cfg.tool_bridge === true;
}

function accountKey(accountId?: string): string {
  return String(accountId || '').trim() || 'default';
}

let registrationInFlight: Promise<{ id: string; name: string } | null> | null = null;

async function codexHeaders(accountId: string | undefined): Promise<Record<string, string>> {
  const configDir = getConfig().getConfigDir();
  const token = await getValidToken(configDir, accountId);
  const tokens = loadTokens(configDir, accountId);
  const chatgptAccountId = String(tokens?.account_id || '').trim();
  if (!chatgptAccountId) throw new Error('Codex session has no ChatGPT account id');
  return buildChatGPTWebHeaders({ accessToken: token, accountId: chatgptAccountId });
}

async function registerConnector(accountId: string | undefined, mcpUrl: string): Promise<{ id: string; name: string; linkId: string }> {
  const headers = await codexHeaders(accountId);
  const response = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/aip/connectors/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: CHATGPT_BRIDGE_CONNECTOR_NAME,
      mcp_url: mcpUrl,
      description: 'Tools on your own computer through Prometheus (files, shell, browser, memory, notes). Only active while ChatGPT runs inside Prometheus.',
      // Web client shape (hhi/Shi in chatgpt.com bundle): auth fields nest under auth_request.
      auth_request: { supported_auth: [{ type: 'NONE' }] },
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`ChatGPT connector registration failed (HTTP ${response.status}): ${text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300)}`);
  }
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* handled below */ }
  const connector = parsed?.connector || parsed;
  const id = String(connector?.id || '').trim();
  if (!id) throw new Error('ChatGPT connector registration returned no connector id');
  // No-auth connectors still need a link before ChatGPT will call them.
  let linkId = '';
  try {
    const linkRes = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/aip/connectors/links/noauth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ connector_id: id, name: CHATGPT_BRIDGE_CONNECTOR_NAME, action_names: [] }),
    });
    const linkText = await linkRes.text().catch(() => '');
    try {
      const link = JSON.parse(linkText);
      linkId = String(link?.id || link?.link?.id || link?.link_id || '').trim();
    } catch { /* link id is optional; refresh is skipped without it */ }
  } catch { /* linking best-effort */ }
  return { id, name: CHATGPT_BRIDGE_CONNECTOR_NAME, linkId };
}

/** Ask ChatGPT to re-snapshot the connector's tools (after the catalog changed). */
async function refreshConnectorActions(accountId: string | undefined, linkId: string): Promise<boolean> {
  if (!linkId) return false;
  const headers = await codexHeaders(accountId);
  const res = await fetch(`${CHATGPT_WEB_ORIGIN}/backend-api/aip/connectors/mcp/refresh_actions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ link_id: linkId }),
  });
  return res.ok;
}

/**
 * Connector to attach to the next ChatGPT message, registering it on first
 * use. Returns null (never throws) when the bridge is disabled, no public
 * HTTPS origin exists, or registration failed; the adapter then tells ChatGPT
 * that local tools are unavailable instead of failing the turn.
 *
 * catalogSignature identifies the tool surface the upcoming turn exposes;
 * when it differs from what ChatGPT last snapshotted, refresh_actions is
 * called so ChatGPT sees the current tools.
 */
export async function getChatGPTBridgeSource(accountId?: string, catalogSignature = ''): Promise<{ id: string; name: string } | null> {
  if (!bridgeEnabled()) return null;
  const mcpUrl = getChatGPTBridgeMcpUrl();
  if (!mcpUrl) return null;
  const state = readState();
  const key = accountKey(accountId);
  const cached = state.accounts[key];
  if (cached?.connectorId && cached.mcpUrl === mcpUrl) {
    if (catalogSignature && cached.catalogSignature !== catalogSignature && cached.linkId) {
      try {
        if (await refreshConnectorActions(accountId, cached.linkId)) {
          const next = readState();
          if (next.accounts[key]) next.accounts[key].catalogSignature = catalogSignature;
          writeState(next);
        }
      } catch (error: any) {
        console.warn(`[chatgpt-bridge] refresh_actions failed: ${redactBridgeSecret(String(error?.message || error)).slice(0, 200)}`);
      }
    }
    return { id: cached.connectorId, name: CHATGPT_BRIDGE_CONNECTOR_NAME };
  }
  // Back off after a failed registration so every ChatGPT turn doesn't
  // re-hit the connector API (and re-probe the tunnel) while it's down.
  const lastErrorAt = Date.parse(state.lastError?.at || '');
  if (Number.isFinite(lastErrorAt) && Date.now() - lastErrorAt < REGISTRATION_RETRY_MS) return null;
  if (!registrationInFlight) {
    registrationInFlight = (async () => {
      try {
        const created = await registerConnector(accountId, mcpUrl);
        const next = readState();
        next.accounts[key] = {
          connectorId: created.id,
          linkId: created.linkId || undefined,
          mcpUrl,
          // Registration snapshots the catalog served at that moment.
          catalogSignature: catalogSignature || undefined,
          registeredAt: new Date().toISOString(),
        };
        delete next.lastError;
        writeState(next);
        return { id: created.id, name: created.name };
      } catch (error: any) {
        const next = readState();
        next.lastError = { message: redactBridgeSecret(String(error?.message || error)).slice(0, 400), at: new Date().toISOString() };
        writeState(next);
        console.warn(`[chatgpt-bridge] ${next.lastError.message}`);
        return null;
      } finally {
        registrationInFlight = null;
      }
    })();
  }
  return registrationInFlight;
}

export function getChatGPTBridgeStatus(): { enabled: boolean; mcpUrlConfigured: boolean; registeredAccounts: string[]; lastError?: string } {
  const state = readState();
  return {
    enabled: bridgeEnabled(),
    mcpUrlConfigured: !!getChatGPTBridgePublicOrigin(),
    registeredAccounts: Object.keys(state.accounts),
    lastError: state.lastError?.message,
  };
}
