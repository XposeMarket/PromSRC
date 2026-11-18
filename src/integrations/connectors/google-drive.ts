// src/integrations/connectors/google-drive.ts
// Google Drive OAuth connector with a constrained provider-native API transport.
// Auth remains vault-backed in OAuthConnector; this class never accepts caller tokens.

import crypto from 'node:crypto';
import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';
import type { GoogleDriveRequestBody, GoogleDriveRequestValidationResult } from '../../gateway/tools/google-drive-request-policy.js';

export interface GoogleDriveApiRequest extends GoogleDriveRequestValidationResult {}

export interface GoogleDriveApiResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface GoogleDriveUploadRequest extends GoogleDriveApiRequest {
  uploadType: 'media' | 'multipart' | 'resumable';
  contentType: string;
}

function decodeUploadBody(body: GoogleDriveRequestBody): { content: Buffer; metadata?: Record<string, unknown> } {
  if (typeof body === 'string') return { content: Buffer.from(body, 'utf8') };
  const contentBase64 = body.content_base64;
  if (contentBase64 !== undefined) {
    if (typeof contentBase64 !== 'string') throw new Error('content_base64 must be a string.');
    return { content: Buffer.from(contentBase64, 'base64'), metadata: body.metadata as Record<string, unknown> | undefined };
  }
  if (typeof body.content !== 'string') throw new Error('content must be a string.');
  return { content: Buffer.from(body.content, 'utf8'), metadata: body.metadata as Record<string, unknown> | undefined };
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return headers;
}

async function readResponseData(response: Response, responseMode?: GoogleDriveApiRequest['responseMode']): Promise<unknown> {
  if (responseMode === 'base64') return Buffer.from(await response.arrayBuffer()).toString('base64');
  if (responseMode === 'text') return response.text();
  const responseType = response.headers.get('content-type') || '';
  if (responseType.includes('json') || responseMode === 'json') return response.json().catch(() => null);
  return response.text();
}

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
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ],
      usePkce: false,
      useNonce: true,
      callbackPort: 19425,
      callbackPath: '/auth/callback/google-drive',
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

  private buildUrl(path: string, query?: Record<string, string>): string {
    const params = new URLSearchParams(query || {}).toString();
    return `https://www.googleapis.com${path}${params ? '?' + params : ''}`;
  }

  private async driveRequest(request: GoogleDriveApiRequest): Promise<GoogleDriveApiResponse> {
    const token = await this.getValidAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    let body: BodyInit | undefined;
    if (request.body !== undefined) {
      if (request.uploadType === 'media' || request.uploadType === 'multipart') {
        const upload = decodeUploadBody(request.body);
        if (request.uploadType === 'media') {
          body = upload.content;
          headers['Content-Type'] = request.contentType || 'application/octet-stream';
        } else {
          if (!upload.metadata) throw new Error('multipart upload requires metadata.');
          const boundary = `prometheus-drive-${crypto.randomUUID()}`;
          const metadata = Buffer.from(JSON.stringify(upload.metadata), 'utf8');
          const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`);
          const middle = Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${request.contentType || 'application/octet-stream'}\r\n\r\n`);
          const suffix = Buffer.from(`\r\n--${boundary}--`);
          body = Buffer.concat([prefix, metadata, middle, upload.content, suffix]);
          headers['Content-Type'] = `multipart/related; boundary=${boundary}`;
        }
      } else if (typeof request.body === 'string') {
        body = request.body;
        headers['Content-Type'] = request.contentType || 'text/plain; charset=utf-8';
      } else {
        body = JSON.stringify(request.body);
        headers['Content-Type'] = request.contentType || 'application/json';
      }
    }
    const response = await fetch(this.buildUrl(request.path, request.query), { method: request.method, headers, body });
    const data = await readResponseData(response, request.responseMode);
    if (!response.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(`Google Drive API error ${response.status}: ${detail}`);
    }
    return { status: response.status, headers: responseHeaders(response), data };
  }

  private async resumableUpload(request: GoogleDriveUploadRequest): Promise<GoogleDriveApiResponse> {
    const token = await this.getValidAccessToken();
    if (!request.body || typeof request.body === 'string' || Array.isArray(request.body)) {
      throw new Error('resumable uploads require an object body with metadata and content.');
    }
    const upload = decodeUploadBody(request.body);
    if (!upload.metadata) throw new Error('resumable uploads require metadata.');
    const initiationHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': request.contentType || 'application/octet-stream',
      'X-Upload-Content-Length': String(upload.content.byteLength),
    };
    const initiationQuery = { ...(request.query || {}), uploadType: 'resumable' };
    const initiation = await fetch(this.buildUrl(request.path, initiationQuery), {
      method: 'POST',
      headers: initiationHeaders,
      body: JSON.stringify(upload.metadata),
    });
    if (!initiation.ok) {
      const detail = await initiation.text().catch(() => '');
      throw new Error(`Google Drive resumable upload initiation failed: ${initiation.status}: ${detail}`);
    }
    const sessionUrl = initiation.headers.get('location');
    if (!sessionUrl) throw new Error('Google Drive resumable upload did not return a session location.');
    const chunk = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': request.contentType || 'application/octet-stream',
        'Content-Length': String(upload.content.byteLength),
        'Content-Range': `bytes 0-${Math.max(upload.content.byteLength - 1, 0)}/${upload.content.byteLength}`,
      },
      body: upload.content,
    });
    const data = await readResponseData(chunk, request.responseMode);
    if (!chunk.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(`Google Drive resumable upload failed: ${chunk.status}: ${detail}`);
    }
    return { status: chunk.status, headers: responseHeaders(chunk), data };
  }

  async requestDriveApi(request: GoogleDriveApiRequest): Promise<GoogleDriveApiResponse> {
    if (request.uploadType === 'resumable') return this.resumableUpload(request as GoogleDriveUploadRequest);
    return this.driveRequest(request);
  }

  async uploadDriveContent(request: GoogleDriveUploadRequest): Promise<GoogleDriveApiResponse> {
    return this.requestDriveApi(request);
  }

  async listFiles(query = '', pageSize = 20, pageToken?: string): Promise<any[]> {
    const params: Record<string, string> = {
      pageSize: String(pageSize),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents)',
    };
    if (query) params.q = query;
    if (pageToken) params.pageToken = pageToken;
    const response = await this.driveRequest({ method: 'GET', path: '/drive/v3/files', query: params });
    return (response.data as any)?.files || [];
  }

  async getFile(fileId: string): Promise<any> {
    const response = await this.driveRequest({
      method: 'GET',
      path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
      query: { fields: 'id,name,mimeType,modifiedTime,size,webViewLink,description,parents,owners,capabilities,trashed' },
    });
    return response.data;
  }

  async readFileContent(fileId: string): Promise<string> {
    const token = await this.getValidAccessToken();
    const meta = await this.getFile(fileId);
    const mimeType = meta.mimeType || '';
    const path = mimeType.includes('google-apps.')
      ? `/drive/v3/files/${encodeURIComponent(fileId)}/export`
      : `/drive/v3/files/${encodeURIComponent(fileId)}`;
    const query = mimeType.includes('google-apps.') ? { mimeType: 'text/plain' } : { alt: 'media' };
    const response = await fetch(this.buildUrl(path, query), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Drive content read failed: ${response.status}`);
    return response.text();
  }

  async searchFiles(query: string, pageSize = 20): Promise<any[]> {
    return this.listFiles(query, pageSize);
  }

  async listSharedDrives(): Promise<any[]> {
    const response = await this.driveRequest({ method: 'GET', path: '/drive/v3/drives', query: { pageSize: '50', fields: 'drives(id,name)' } });
    return (response.data as any)?.drives || [];
  }
}
