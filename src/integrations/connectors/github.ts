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

  private async ghGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async ghPost(path: string, body: any): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.github.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async getUser(): Promise<any> {
    return this.ghGet('/user');
  }

  async listRepos(perPage = 50): Promise<any[]> {
    return this.ghGet(`/user/repos?per_page=${perPage}&sort=updated`);
  }

  async getRepo(owner: string, repo: string): Promise<any> {
    return this.ghGet(`/repos/${owner}/${repo}`);
  }

  async listIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open', perPage = 30): Promise<any[]> {
    return this.ghGet(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated`);
  }

  async createIssue(owner: string, repo: string, title: string, body = '', labels: string[] = []): Promise<any> {
    return this.ghPost(`/repos/${owner}/${repo}/issues`, { title, body, labels });
  }

  async listPRs(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open', perPage = 30): Promise<any[]> {
    return this.ghGet(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated`);
  }

  async getPR(owner: string, repo: string, prNumber: number): Promise<any> {
    return this.ghGet(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  async listCommits(owner: string, repo: string, perPage = 20): Promise<any[]> {
    return this.ghGet(`/repos/${owner}/${repo}/commits?per_page=${perPage}`);
  }

  async searchCode(query: string, perPage = 20): Promise<any[]> {
    const params = new URLSearchParams({ q: query, per_page: String(perPage) });
    const data = await this.ghGet(`/search/code?${params}`);
    return data.items || [];
  }

  async searchRepos(query: string, perPage = 20): Promise<any[]> {
    const params = new URLSearchParams({ q: query, sort: 'stars', per_page: String(perPage) });
    const data = await this.ghGet(`/search/repositories?${params}`);
    return data.items || [];
  }

  async createRepo(name: string, options?: { description?: string; private?: boolean; autoInit?: boolean; homepage?: string }): Promise<any> {
    return this.ghPost('/user/repos', {
      name,
      description: options?.description || '',
      private: options?.private !== false,
      auto_init: options?.autoInit === true,
      homepage: options?.homepage || undefined,
    });
  }

  async getFileContents(owner: string, repo: string, path: string): Promise<{ content: string; sha: string }> {
    const data = await this.ghGet(`/repos/${owner}/${repo}/contents/${path}`);
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { content, sha: data.sha };
  }
}
