// src/integrations/connectors/google-drive.ts
// Google Drive OAuth connector — shares Google OAuth infrastructure with Gmail.
//
// SETUP REQUIRED:
//   Same Google Cloud project as Gmail.
//   Enable "Google Drive API".
//   Add scope: https://www.googleapis.com/auth/drive.readonly (or .file for write access)
//   Reuse same GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET env vars,
//   OR set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET for a separate app.

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class GoogleDriveConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'google_drive',
      name: 'Google Drive',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env.GDRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GDRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || '',
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ],
      usePkce: false,
      callbackPort: 19425,
      callbackPath: '/auth/callback/google-drive',
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

  async listFiles(query = '', pageSize = 20): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const params = new URLSearchParams({ pageSize: String(pageSize), fields: 'files(id,name,mimeType,modifiedTime,size)' });
    if (query) params.set('q', query);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as any;
    return data.files || [];
  }
}
