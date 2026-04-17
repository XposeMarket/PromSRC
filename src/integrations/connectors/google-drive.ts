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

  private async driveGet(path: string, params: Record<string, string> = {}): Promise<any> {
    const token = await this.getValidAccessToken();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://www.googleapis.com${path}${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google Drive API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async listFiles(query = '', pageSize = 20): Promise<any[]> {
    const params: Record<string, string> = { pageSize: String(pageSize), fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,parents)' };
    if (query) params.q = query;
    const data = await this.driveGet('/drive/v3/files', params);
    return data.files || [];
  }

  async getFile(fileId: string): Promise<any> {
    return this.driveGet(`/drive/v3/files/${fileId}`, { fields: 'id,name,mimeType,modifiedTime,size,webViewLink,description,parents,owners' });
  }

  async readFileContent(fileId: string): Promise<string> {
    const token = await this.getValidAccessToken();
    // For Google Docs/Sheets/Slides — export as plain text
    const meta = await this.getFile(fileId);
    const mimeType = meta.mimeType || '';

    if (mimeType.includes('google-apps.document')) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Drive export failed: ${res.status}`);
      return res.text();
    }

    // For regular files — download content directly (text-safe types only)
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
    return res.text();
  }

  async searchFiles(query: string, pageSize = 20): Promise<any[]> {
    return this.listFiles(query, pageSize);
  }

  async listSharedDrives(): Promise<any[]> {
    const data = await this.driveGet('/drive/v3/drives', { pageSize: '50', fields: 'drives(id,name)' });
    return data.drives || [];
  }
}
