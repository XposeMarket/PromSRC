// src/integrations/oauth-base.ts
// Base class for all OAuth 2.0 connector flows.
// Each connector extends this with its own client ID, scopes, and endpoints.
// Follows the same PKCE + local callback server pattern as openai-oauth.ts.

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { getVault } from '../security/vault.js';

export interface OAuthConnectorConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  usePkce: boolean;
  callbackPort: number;
  callbackPath: string;
}

export interface ConnectorTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
  account_email?: string;
  account_id?: string;
}

export interface OAuthStartResult {
  success: false;
  authUrl: string;
  flowId: string;
}

export interface OAuthCallbackResult {
  success: boolean;
  account_email?: string;
  error?: string;
}

interface FlowState {
  verifier?: string;
  state: string;
  createdAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const activeFlows = new Map<string, FlowState>();

export abstract class OAuthConnector {
  protected cfg: OAuthConnectorConfig;
  protected configDir: string;

  constructor(cfg: OAuthConnectorConfig, configDir: string) {
    this.cfg = cfg;
    this.configDir = configDir;
  }

  get id() { return this.cfg.id; }

  private vaultKey(): string {
    return `integration.${this.cfg.id}.oauth_tokens`;
  }

  loadTokens(): ConnectorTokens | null {
    try {
      const secret = getVault(this.configDir).get(this.vaultKey(), `oauth:load:${this.cfg.id}`);
      if (!secret) return null;
      return JSON.parse(secret.expose()) as ConnectorTokens;
    } catch { return null; }
  }

  saveTokens(tokens: ConnectorTokens): void {
    getVault(this.configDir).set(this.vaultKey(), JSON.stringify(tokens), `oauth:save:${this.cfg.id}`);
    this.updateConnectionsFile(true, tokens.account_email);
  }

  clearTokens(): void {
    getVault(this.configDir).delete(this.vaultKey(), `oauth:clear:${this.cfg.id}`);
    this.updateConnectionsFile(false);
  }

  isConnected(): boolean {
    return this.loadTokens() !== null;
  }

  private updateConnectionsFile(connected: boolean, accountEmail?: string): void {
    try {
      const connectionsPath = path.join(this.configDir, 'connections.json');
      let data: Record<string, any> = {};
      if (fs.existsSync(connectionsPath)) {
        data = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
      }
      if (connected) {
        data[this.cfg.id] = { connected: true, connectedAt: Date.now(), authType: 'oauth', accountId: accountEmail };
      } else {
        delete data[this.cfg.id];
      }
      fs.mkdirSync(path.dirname(connectionsPath), { recursive: true });
      fs.writeFileSync(connectionsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn(`[oauth:${this.cfg.id}] Could not update connections.json:`, e.message);
    }
  }

  async getValidAccessToken(): Promise<string> {
    let tokens = this.loadTokens();
    if (!tokens) throw new Error(`${this.cfg.name} not connected. Connect via the Connections panel.`);
    if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
      tokens = await this.refreshTokens(tokens);
    }
    return tokens.access_token;
  }

  async refreshTokens(existing: ConnectorTokens): Promise<ConnectorTokens> {
    if (!existing.refresh_token) throw new Error(`No refresh token for ${this.cfg.name}.`);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: existing.refresh_token,
      client_id: this.cfg.clientId,
    });
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret);
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Token refresh failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const tokens: ConnectorTokens = {
      ...existing,
      access_token: data.access_token || existing.access_token,
      refresh_token: data.refresh_token || existing.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    this.saveTokens(tokens);
    return tokens;
  }

  private generateVerifier(): string { return crypto.randomBytes(32).toString('base64url'); }
  private generateChallenge(v: string): string {
    return crypto.createHash('sha256').update(v).digest('base64url');
  }

  startFlow(): OAuthStartResult {
    const state = crypto.randomBytes(16).toString('hex');
    const flowState: FlowState = { state, createdAt: Date.now() };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.callbackUrl(),
      scope: this.cfg.scopes.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    if (this.cfg.usePkce) {
      const verifier = this.generateVerifier();
      flowState.verifier = verifier;
      params.set('code_challenge', this.generateChallenge(verifier));
      params.set('code_challenge_method', 'S256');
    }

    activeFlows.set(this.cfg.id, flowState);
    const authUrl = `${this.cfg.authUrl}?${params.toString()}`;
    return { success: false, authUrl, flowId: this.cfg.id };
  }

  public async handleCallback(code: string, returnedState: string): Promise<OAuthCallbackResult> {
    const flow = activeFlows.get(this.cfg.id);
    if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
      return { success: false, error: 'OAuth session expired or not found. Click Connect again.' };
    }
    if (returnedState !== flow.state) {
      return { success: false, error: 'State mismatch — possible CSRF.' };
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl(),
      client_id: this.cfg.clientId,
    });
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret);
    if (flow.verifier) body.set('code_verifier', flow.verifier);

    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      activeFlows.delete(this.cfg.id);
      return { success: false, error: `Token exchange failed (${res.status}): ${txt.slice(0, 200)}` };
    }

    const data = await res.json() as any;
    activeFlows.delete(this.cfg.id);

    const tokens = await this.buildTokens(data);
    this.saveTokens(tokens);

    return { success: true, account_email: tokens.account_email };
  }

  listenForCallback(): Promise<OAuthCallbackResult> {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith(this.cfg.callbackPath)) {
          res.writeHead(404); res.end(); return;
        }
        const url = new URL(req.url, `http://localhost:${this.cfg.callbackPort}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        const done = (html: string, result: OAuthCallbackResult) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
          server.close();
          resolve(result);
        };

        if (error || !code) {
          return done(this.errorHtml(error || 'No code returned'),
            { success: false, error: error || 'No authorization code' });
        }

        try {
          const result = await this.handleCallback(code, state || '');
          if (result.success) {
            return done(this.successHtml(result.account_email), result);
          } else {
            return done(this.errorHtml(result.error || 'Unknown error'), result);
          }
        } catch (e: any) {
          return done(this.errorHtml(e.message), { success: false, error: e.message });
        }
      });

      server.on('error', (e: any) => resolve({ success: false, error: `Callback server error: ${e.message}` }));
      server.listen(this.cfg.callbackPort, 'localhost', () => {
        setTimeout(() => { server.close(); resolve({ success: false, error: 'Timed out waiting for OAuth callback.' }); }, 10 * 60 * 1000);
      });
    });
  }

  protected callbackUrl(): string {
    return `http://localhost:${this.cfg.callbackPort}${this.cfg.callbackPath}`;
  }

  protected abstract buildTokens(data: Record<string, any>): Promise<ConnectorTokens>;

  private successHtml(email?: string): string {
    return `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1a2e;color:#e8edf6">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h2 style="color:#31b884">${this.cfg.name} Connected!</h2>
      ${email ? `<p style="color:#aeb9cb">Signed in as <strong>${email}</strong></p>` : ''}
      <p style="color:#aeb9cb">You can close this window and return to Prometheus.</p>
    </body></html>`;
  }

  private errorHtml(error: string): string {
    return `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1a2e;color:#e8edf6">
      <div style="font-size:48px;margin-bottom:16px">❌</div>
      <h2 style="color:#e06d6d">Connection Failed</h2>
      <p style="color:#aeb9cb">${error}</p>
      <p style="color:#aeb9cb">You can close this window and try again.</p>
    </body></html>`;
  }
}
