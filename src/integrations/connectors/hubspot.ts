// src/integrations/connectors/hubspot.ts
// HubSpot OAuth 2.0 connector.
//
// SETUP REQUIRED:
//   1. https://developers.hubspot.com/docs/api/creating-an-app
//   2. Create a public app → OAuth → Add scopes: crm.objects.contacts.read/write,
//      crm.objects.companies.read, crm.objects.deals.read
//   3. Redirect URL: http://localhost:19426/auth/callback/hubspot
//   4. Set env vars: HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class HubSpotConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'hubspot',
      name: 'HubSpot',
      authUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      clientId: process.env.HUBSPOT_CLIENT_ID || '',
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
      scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.companies.read', 'crm.objects.deals.read'],
      usePkce: false,
      callbackPort: 19426,
      callbackPath: '/auth/callback/hubspot',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 1800) * 1000,
    };
    try {
      const res = await fetch('https://api.hubapi.com/oauth/v1/access-tokens/' + data.access_token);
      if (res.ok) {
        const info = await res.json() as any;
        tokens.account_email = info.user;
        tokens.account_id = String(info.user_id || '');
      }
    } catch {}
    return tokens;
  }

  private async apiGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.hubapi.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async apiPost(path: string, body: any): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.hubapi.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async listContacts(limit = 20, after?: string): Promise<{ results: any[]; next?: string }> {
    const params = new URLSearchParams({ limit: String(limit), properties: 'email,firstname,lastname,phone,company,jobtitle' });
    if (after) params.set('after', after);
    const data = await this.apiGet(`/crm/v3/objects/contacts?${params}`);
    return { results: data.results || [], next: data.paging?.next?.after };
  }

  async getContact(contactId: string): Promise<any> {
    return this.apiGet(`/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,jobtitle,lifecyclestage`);
  }

  async createContact(properties: Record<string, string>): Promise<any> {
    return this.apiPost('/crm/v3/objects/contacts', { properties });
  }

  async searchContacts(query: string, limit = 20): Promise<any[]> {
    const data = await this.apiPost('/crm/v3/objects/contacts/search', {
      query,
      limit,
      properties: ['email', 'firstname', 'lastname', 'phone', 'company', 'jobtitle'],
    });
    return data.results || [];
  }

  async listDeals(limit = 20): Promise<any[]> {
    const params = new URLSearchParams({ limit: String(limit), properties: 'dealname,amount,dealstage,closedate,pipeline' });
    const data = await this.apiGet(`/crm/v3/objects/deals?${params}`);
    return data.results || [];
  }

  async listCompanies(limit = 20): Promise<any[]> {
    const params = new URLSearchParams({ limit: String(limit), properties: 'name,domain,industry,city,country' });
    const data = await this.apiGet(`/crm/v3/objects/companies?${params}`);
    return data.results || [];
  }
}
