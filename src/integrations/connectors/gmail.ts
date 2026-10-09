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
import { buildGmailRaw, type GmailMimeAttachment } from './gmail-mime.js';

export interface GmailSendOptions {
  /** Optional HTML alternative; the plain body stays as the text/plain fallback. */
  html?: string;
  attachments?: GmailMimeAttachment[];
  /** Reply in an existing conversation. */
  threadId?: string;
  /** Gmail message id being replied to; fills In-Reply-To/References/threadId automatically. */
  replyToMessageId?: string;
  inReplyTo?: string;
  references?: string;
}

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
      useNonce: true,
      callbackPort: CALLBACK_PORT,
      callbackPath: '/auth/callback/gmail',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
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

  // ── Gmail API helpers ────────────────────────────────────────────────────

  private async gmailError(res: Response, action: string): Promise<Error> {
    const body = await res.text().catch(() => '');
    return new Error(`Gmail ${action} failed: ${res.status}${body ? ` ${body.slice(0, 500)}` : ''}`);
  }

  async listMessages(maxResults = 20, query = ''): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (query) params.set('q', query);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'list');
    const data = await res.json() as any;
    return data.messages || [];
  }

  async getMessage(id: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'get message');
    return res.json();
  }

  async getProfile(): Promise<{ email: string; messagesTotal: number }> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'profile');
    return res.json() as any;
  }

  // Fetch message + extract human-readable fields (subject, from, snippet, body)
  async getMessageParsed(id: string): Promise<{ id: string; subject: string; from: string; date: string; snippet: string; body: string }> {
    const msg = await this.getMessage(id);
    const headers = (msg.payload?.headers || []) as Array<{ name: string; value: string }>;
    const h = (name: string) => headers.find(x => x.name.toLowerCase() === name.toLowerCase())?.value || '';
    const body = this.extractBody(msg.payload);
    return { id, subject: h('subject'), from: h('from'), date: h('date'), snippet: msg.snippet || '', body };
  }

  private extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      for (const part of payload.parts) {
        const nested = this.extractBody(part);
        if (nested) return nested;
      }
    }
    return '';
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string,
    options: GmailSendOptions = {},
  ): Promise<{ id: string; threadId: string }> {
    const token = await this.getValidAccessToken();
    const profile = await this.getProfile();

    let inReplyTo = options.inReplyTo;
    let references = options.references;
    let threadId = options.threadId;
    if (options.replyToMessageId) {
      const meta = await this.getMessageHeaders(options.replyToMessageId, ['Message-Id', 'References']);
      inReplyTo = inReplyTo || meta.headers['message-id'];
      references = references || [meta.headers['references'], meta.headers['message-id']].filter(Boolean).join(' ');
      threadId = threadId || meta.threadId;
    }

    const raw = buildGmailRaw({
      to,
      from: profile.email,
      cc,
      bcc,
      subject,
      text: body || '',
      html: options.html,
      attachments: options.attachments,
      inReplyTo,
      references,
    });
    const payload: Record<string, string> = { raw };
    if (threadId) payload.threadId = threadId;
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.gmailError(res, 'send');
    return res.json() as any;
  }

  async getMessageHeaders(messageId: string, names: string[]): Promise<{ threadId?: string; headers: Record<string, string> }> {
    const token = await this.getValidAccessToken();
    const params = new URLSearchParams({ format: 'metadata' });
    for (const n of names) params.append('metadataHeaders', n);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'get message headers');
    const data = await res.json() as any;
    const headers: Record<string, string> = {};
    for (const h of data.payload?.headers || []) headers[String(h.name).toLowerCase()] = String(h.value);
    return { threadId: data.threadId, headers };
  }

  async getThread(threadId: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'get thread');
    return res.json();
  }

  async listLabels(): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.gmailError(res, 'list labels');
    const data = await res.json() as any;
    return data.labels || [];
  }
}
