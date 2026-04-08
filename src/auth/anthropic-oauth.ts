/**
 * anthropic-oauth.ts
 * Handles Anthropic Claude subscription auth via the setup-token flow.
 *
 * Mirrors how OpenClaw handles Anthropic auth:
 *   - User runs `claude setup-token` from Claude Code CLI
 *   - Pastes the resulting token into Prometheus (Settings → Models → Anthropic)
 *   - Token is stored AES-256-GCM encrypted via SecretVault
 *   - Token is used as Bearer auth for api.anthropic.com/v1/messages
 *
 * The setup-token produces a long-lived OAuth token (sk-ant-oat-*)
 * that authenticates against the user's Claude Pro/Max subscription.
 *
 * Flow (same as OpenClaw):
 *   1. Run `claude setup-token` on any machine with Claude Code CLI
 *   2. Paste the token into Prometheus
 *   3. Stored as a token auth profile (no refresh needed — long-lived)
 *   4. If token expires/revoked, re-run `claude setup-token` and paste again
 *
 * Note: Anthropic setup-token auth is technical compatibility.
 * Anthropic has restricted subscription usage outside Claude Code in the past.
 * Use at your own discretion — see OpenClaw docs for current policy status.
 */

import fs from 'fs';
import path from 'path';
import { getVault } from '../security/vault';
import { log } from '../security/log-scrubber';

// ─── Constants ──────────────────────────────────────────────────────────────────

const VAULT_KEY = 'anthropic.oauth_tokens';

// Anthropic API endpoint
export const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
export const ANTHROPIC_API_VERSION = '2023-06-01';

// Beta headers needed for OAuth auth (same as Claude Code sends)
const OAUTH_BETA_HEADERS = 'oauth-2025-04-20';

// ─── Token Storage ──────────────────────────────────────────────────────────────

export interface AnthropicTokens {
  /** The setup-token (sk-ant-oat-*) — used as Bearer token */
  access_token: string;
  /** When the token was stored (Unix ms) */
  stored_at: number;
  /** Optional: account email or identifier */
  account_id?: string;
  /** Auth type: 'setup_token' or 'api_key' */
  auth_type: 'setup_token' | 'api_key';
}

// ─── Credential storage (vault-backed) ──────────────────────────────────────────

/**
 * Load Anthropic tokens from the encrypted vault.
 */
export function loadTokens(configDir: string): AnthropicTokens | null {
  const vault  = getVault(configDir);
  const secret = vault.get(VAULT_KEY, 'anthropic:load');
  if (!secret) return null;
  try {
    return JSON.parse(secret.expose()) as AnthropicTokens;
  } catch {
    return null;
  }
}

/**
 * Save Anthropic tokens to the encrypted vault.
 */
export function saveTokens(configDir: string, tokens: AnthropicTokens): void {
  const vault = getVault(configDir);
  vault.set(VAULT_KEY, JSON.stringify(tokens), 'anthropic:save');
  log.security('[anthropic-auth] Tokens saved to vault (type:', tokens.auth_type, ')');
}

/**
 * Clear Anthropic tokens from the vault.
 */
export function clearTokens(configDir: string): void {
  getVault(configDir).delete(VAULT_KEY, 'anthropic:clear');
  log.security('[anthropic-auth] Tokens cleared from vault');
}

/**
 * Check if Anthropic is connected (has valid tokens).
 */
export function isConnected(configDir: string): boolean {
  return loadTokens(configDir) !== null;
}

/**
 * Get the valid access token for API calls.
 * For setup-tokens, these are long-lived — no refresh needed.
 * If the token is invalid/expired, the API will return 401 and the user
 * needs to re-run `claude setup-token` and paste a new one.
 */
export function getValidToken(configDir: string): string {
  const tokens = loadTokens(configDir);
  if (!tokens) {
    throw new Error(
      'Not connected to Anthropic. Go to Settings → Models → Anthropic and paste your setup-token.\n' +
      'Run `claude setup-token` in your terminal to generate one.'
    );
  }
  return tokens.access_token;
}

/**
 * Store a setup-token from the user.
 * Validates format and saves to vault.
 */
export function storeSetupToken(configDir: string, token: string): { success: boolean; error?: string } {
  const trimmed = token.trim();

  if (!trimmed) {
    return { success: false, error: 'Token is empty.' };
  }

  // Setup tokens start with sk-ant-oat- (OAuth) or sk-ant-api- (API key)
  const isOAuthToken = trimmed.startsWith('sk-ant-oat');
  const isApiKey     = trimmed.startsWith('sk-ant-api');

  if (!isOAuthToken && !isApiKey) {
    return {
      success: false,
      error: 'Invalid token format. Expected a token starting with "sk-ant-oat" (setup-token) or "sk-ant-api" (API key).',
    };
  }

  const tokens: AnthropicTokens = {
    access_token: trimmed,
    stored_at:    Date.now(),
    auth_type:    isOAuthToken ? 'setup_token' : 'api_key',
  };

  saveTokens(configDir, tokens);
  return { success: true };
}

/**
 * Build the required headers for Anthropic API requests.
 * Handles the difference between OAuth tokens and API keys.
 */
export function buildAuthHeaders(configDir: string): Record<string, string> {
  const tokens = loadTokens(configDir);
  if (!tokens) throw new Error('No Anthropic credentials configured.');

  const headers: Record<string, string> = {
    'Content-Type':      'application/json',
    'anthropic-version': ANTHROPIC_API_VERSION,
  };

  if (tokens.auth_type === 'setup_token') {
    // OAuth tokens use Bearer auth + OAuth beta header
    headers['Authorization'] = `Bearer ${tokens.access_token}`;
    headers['anthropic-beta'] = OAUTH_BETA_HEADERS;
  } else {
    // API keys use x-api-key header
    headers['x-api-key'] = tokens.access_token;
  }

  return headers;
}
