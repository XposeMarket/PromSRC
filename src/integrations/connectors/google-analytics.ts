// src/integrations/connectors/google-analytics.ts
// Google Analytics 4 (GA4) OAuth connector.
//
// SETUP REQUIRED:
//   1. Google Cloud Console → Enable "Google Analytics Data API"
//   2. OAuth credentials → Desktop app (or reuse GMAIL_CLIENT_ID)
//   3. Scopes: analytics.readonly
//   4. Set env vars: GA4_CLIENT_ID and GA4_CLIENT_SECRET (or reuse GMAIL_CLIENT_ID/SECRET)
//   5. Set GA4_PROPERTY_ID (find in GA4 → Admin → Property Settings)

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class GoogleAnalyticsConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'ga4',
      name: 'Google Analytics',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env.GA4_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GA4_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || '',
      scopes: [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ],
      usePkce: false,
      callbackPort: 19429,
      callbackPath: '/auth/callback/ga4',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope,
    };
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

  private getPropertyId(override?: string): string {
    const pid = override || process.env.GA4_PROPERTY_ID || '';
    if (!pid) throw new Error('GA4_PROPERTY_ID environment variable is not set. Find it in GA4 → Admin → Property Settings.');
    return pid;
  }

  async runReport(options: {
    metrics: string[];
    dimensions?: string[];
    startDate?: string;
    endDate?: string;
    propertyId?: string;
    limit?: number;
  }): Promise<any> {
    const token = await this.getValidAccessToken();
    const propertyId = this.getPropertyId(options.propertyId);
    const body = {
      dateRanges: [{ startDate: options.startDate || '30daysAgo', endDate: options.endDate || 'today' }],
      metrics: options.metrics.map(name => ({ name })),
      dimensions: (options.dimensions || []).map(name => ({ name })),
      limit: options.limit || 100,
    };
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA4 API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async getRealtimeUsers(propertyId?: string): Promise<{ activeUsers: number; breakdown?: any[] }> {
    const token = await this.getValidAccessToken();
    const pid = this.getPropertyId(propertyId);
    const body = {
      metrics: [{ name: 'activeUsers' }],
      dimensions: [{ name: 'unifiedScreenName' }],
    };
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runRealtimeReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA4 realtime error ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json() as any;
    const active = parseInt(data?.rows?.[0]?.metricValues?.[0]?.value || '0', 10);
    return { activeUsers: active, breakdown: data.rows };
  }

  async listProperties(): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/-', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.properties || [];
  }
}
