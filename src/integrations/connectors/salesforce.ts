// src/integrations/connectors/salesforce.ts
// Salesforce OAuth 2.0 connector (Connected App).
//
// SETUP REQUIRED:
//   1. Setup > App Manager → New Connected App
//   2. Enable OAuth Settings → Callback URL: http://localhost:19427/auth/callback/salesforce
//   3. Scopes: api, refresh_token, openid
//   4. Set env vars: SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET
//   5. Optionally set SALESFORCE_LOGIN_URL (default: https://login.salesforce.com)

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

const LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

export class SalesforceConnector extends OAuthConnector {
  // instance_url returned by Salesforce token endpoint — needed for API calls
  private instanceUrl = '';

  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'salesforce',
      name: 'Salesforce',
      authUrl: `${LOGIN_URL}/services/oauth2/authorize`,
      tokenUrl: `${LOGIN_URL}/services/oauth2/token`,
      clientId: process.env.SALESFORCE_CLIENT_ID || '',
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET || '',
      scopes: ['api', 'refresh_token', 'openid'],
      usePkce: false,
      callbackPort: 19427,
      callbackPath: '/auth/callback/salesforce',
    };
    super(cfg, configDir);
    // Restore instance URL from saved tokens
    const saved = this.loadTokens();
    if (saved && (saved as any).instance_url) this.instanceUrl = (saved as any).instance_url;
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    this.instanceUrl = data.instance_url || LOGIN_URL;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + 7200 * 1000,
      account_email: data.id ? await this.fetchUserEmail(data.access_token, data.id) : undefined,
      account_id: data.id,
      ...(data.instance_url ? { instance_url: data.instance_url } : {}),
    } as ConnectorTokens & { instance_url?: string };
  }

  private async fetchUserEmail(token: string, idUrl: string): Promise<string | undefined> {
    try {
      const res = await fetch(idUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json() as any; return d.email || d.username; }
    } catch {}
    return undefined;
  }

  private getInstanceUrl(): string {
    if (!this.instanceUrl) {
      const saved = this.loadTokens() as any;
      if (saved?.instance_url) this.instanceUrl = saved.instance_url;
    }
    return this.instanceUrl || LOGIN_URL;
  }

  private async apiGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const base = this.getInstanceUrl();
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Salesforce API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async apiPost(path: string, body: any): Promise<any> {
    const token = await this.getValidAccessToken();
    const base = this.getInstanceUrl();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Salesforce API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async query(soql: string): Promise<{ records: any[]; totalSize: number; done: boolean }> {
    const params = new URLSearchParams({ q: soql });
    return this.apiGet(`/services/data/v59.0/query?${params}`);
  }

  async search(sosl: string): Promise<any[]> {
    const params = new URLSearchParams({ q: sosl });
    const data = await this.apiGet(`/services/data/v59.0/search?${params}`);
    return data.searchRecords || [];
  }

  async createRecord(objectType: string, fields: Record<string, any>): Promise<{ id: string; success: boolean }> {
    return this.apiPost(`/services/data/v59.0/sobjects/${objectType}`, fields);
  }

  async describeObject(objectType: string): Promise<any> {
    return this.apiGet(`/services/data/v59.0/sobjects/${objectType}/describe`);
  }

  async getRecord(objectType: string, id: string): Promise<any> {
    return this.apiGet(`/services/data/v59.0/sobjects/${objectType}/${id}`);
  }
}
