// src/integrations/connectors/github.ts
// GitHub OAuth connector.
//
// SETUP REQUIRED:
//   1. https://github.com/settings/applications/new
//   2. Homepage URL: http://localhost:18789
//   3. Callback URL: http://localhost:19422/auth/callback/github
//   4. Set env vars: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class GitHubConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'github',
      name: 'GitHub',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      scopes: ['repo', 'read:user', 'user:email', 'read:org'],
      usePkce: false,
      callbackPort: 19422,
      callbackPath: '/auth/callback/github',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000,
      scope: data.scope,
    };
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'Prometheus-CIS' },
      });
      if (res.ok) {
        const user = await res.json() as any;
        tokens.account_email = user.email || user.login;
        tokens.account_id = String(user.id);
      }
    } catch {}
    return tokens;
  }

  // GitHub returns tokens in application/x-www-form-urlencoded unless Accept: application/json.
  // Must be public to match the base class signature.
  public async handleCallback(code: string, state: string): Promise<any> {
    const origFetch = global.fetch;
    const patchedFetch = async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('github.com/login/oauth/access_token')) {
        init = { ...init, headers: { ...(init?.headers as any), Accept: 'application/json' } };
      }
      return origFetch(url as any, init);
    };
    (global as any).fetch = patchedFetch;
    try {
      return await super.handleCallback(code, state);
    } finally {
      global.fetch = origFetch;
    }
  }

  async getUser(): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS' },
    });
    return res.json();
  }

  async listRepos(): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS' },
    });
    return res.json() as any;
  }
}
