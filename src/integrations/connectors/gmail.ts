// src/integrations/connectors/gmail.ts
// Gmail OAuth connector.
// Uses Google OAuth2 with offline access to get a refresh token.
//
// SETUP REQUIRED (one-time per deployment):
//   1. Go to https://console.cloud.google.com/
//   2. Create a project → Enable "Gmail API"
//   3. OAuth consent screen → External → Add scopes (gmail.readonly, gmail.send, gmail.modify)
//   4. Credentials → Create OAuth 2.0 Client ID → Desktop app
//   5. Set env vars: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET
//   OR add to .prometheus/config.json under integrations.gmail

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

const CALLBACK_PORT = 19420;

export class GmailConnector extends OAuthConnector {
  constructor(configDir: string) {
    const clientId = process.env.GMAIL_CLIENT_ID || '';
    const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';

    const cfg: OAuthConnectorConfig = {
      id: 'gmail',
      name: 'Gmail',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId,
      clientSecret,
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ],
      usePkce: false, // Google uses client_secret instead of PKCE for desktop apps
      callbackPort: CALLBACK_PORT,
      callbackPath: '/auth/callback/gmail',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope,
      token_type: data.token_type,
    };

    // Fetch account email from Google userinfo
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (res.ok) {
        const info = await res.json() as any;
        tokens.account_email = info.email;
        tokens.account_id = info.sub;
      }
    } catch {}

    return tokens;
  }

  // ── Gmail API helpers (used by future integration sync) ──────────────────

  async listMessages(maxResults = 20, query = ''): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (query) params.set('q', query);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
    const data = await res.json() as any;
    return data.messages || [];
  }

  async getMessage(id: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Gmail get message failed: ${res.status}`);
    return res.json();
  }

  async getProfile(): Promise<{ email: string; messagesTotal: number }> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Gmail profile failed: ${res.status}`);
    return res.json() as any;
  }
}
