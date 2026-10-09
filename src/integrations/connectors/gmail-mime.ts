// src/integrations/connectors/gmail-mime.ts
// Pure RFC 5322 / MIME builder for Gmail messages.send and drafts.create.
// - Non-ASCII header values (Subject, display names) are RFC 2047 B-encoded.
// - Bodies are base64 with charset=UTF-8 so emoji/accents survive.
// - Optional HTML alternative, attachments (multipart/mixed), and reply
//   threading headers (In-Reply-To / References).

import fs from 'fs';
import path from 'path';

export interface GmailMimeAttachment {
  filename: string;
  mimeType?: string;
  content: Buffer;
}

export interface GmailMimeInput {
  to: string;
  from?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: GmailMimeAttachment[];
  inReplyTo?: string;
  references?: string;
  boundarySeed?: string;
}

const CRLF = '\r\n';

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** RFC 2047 encoded-word, split so each encoded word stays under 75 chars. */
export function encodeHeaderValue(value: string): string {
  const clean = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (isAscii(clean)) return clean;
  const words: string[] = [];
  let chunk = '';
  for (const ch of Array.from(clean)) {
    // 45 UTF-8 bytes -> 60 base64 chars, + 12 for =?UTF-8?B??= = 72 chars.
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

/** Header-safe address list: strips CR/LF and encodes non-ASCII display names. */
export function encodeAddressList(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((addr) => {
      const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
      if (!m || !m[1] || isAscii(m[1])) return addr;
      return `${encodeHeaderValue(m[1])} <${m[2]}>`;
    })
    .join(', ');
}

function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) || ['']).join(CRLF);
}

function b64Body(content: string | Buffer): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return wrap76(buf.toString('base64'));
}

function quoteParam(value: string): string {
  const clean = String(value || 'attachment').replace(/[\r\n"\\]+/g, '_');
  if (isAscii(clean)) return `"${clean}"`;
  return `"${encodeHeaderValue(clean)}"`;
}

function rfc2231Filename(value: string): string {
  return `UTF-8''${encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const EXT_MIME: Record<string, string> = {
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json',
  pdf: 'application/pdf', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function guessMimeType(filename: string): string {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

function textPart(type: 'plain' | 'html', content: string): string {
  return [`Content-Type: text/${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', b64Body(content)].join(CRLF);
}

function attachmentPart(att: GmailMimeAttachment): string {
  const name = att.filename || 'attachment';
  const type = att.mimeType || guessMimeType(name);
  const disposition = isAscii(name)
    ? `attachment; filename=${quoteParam(name)}`
    : `attachment; filename=${quoteParam(name)}; filename*=${rfc2231Filename(name)}`;
  return [
    `Content-Type: ${type}; name=${quoteParam(name)}`,
    `Content-Disposition: ${disposition}`,
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(att.content),
  ].join(CRLF);
}

function multipart(subtype: string, boundary: string, parts: string[]): string {
  return [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    '',
    ...parts.map((p) => `--${boundary}${CRLF}${p}`),
    `--${boundary}--`,
  ].join(CRLF);
}

/** Build the full RFC 5322 message string. */
export function buildGmailMimeMessage(input: GmailMimeInput): string {
  const seed = input.boundarySeed || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const headers: string[] = [];
  headers.push(`To: ${encodeAddressList(input.to)}`);
  if (input.from) headers.push(`From: ${encodeAddressList(input.from)}`);
  if (input.cc) headers.push(`Cc: ${encodeAddressList(input.cc)}`);
  if (input.bcc) headers.push(`Bcc: ${encodeAddressList(input.bcc)}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject || '')}`);
  const inReplyTo = String(input.inReplyTo || '').replace(/[\r\n]+/g, ' ').trim();
  const references = String(input.references || '').replace(/[\r\n]+/g, ' ').trim();
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references || inReplyTo) headers.push(`References: ${references || inReplyTo}`);
  headers.push('MIME-Version: 1.0');

  const text = input.text ?? '';
  const html = input.html ? String(input.html) : '';
  const attachments = (input.attachments || []).filter((a) => a && Buffer.isBuffer(a.content));

  const bodyEntity = html
    ? multipart('alternative', `alt_${seed}`, [textPart('plain', text), textPart('html', html)])
    : textPart('plain', text);

  const entity = attachments.length
    ? multipart('mixed', `mix_${seed}`, [bodyEntity, ...attachments.map(attachmentPart)])
    : bodyEntity;

  return `${headers.join(CRLF)}${CRLF}${entity}${CRLF}`;
}

/** base64url-encoded `raw` value for Gmail messages.send / drafts.create. */
export function buildGmailRaw(input: GmailMimeInput): string {
  return Buffer.from(buildGmailMimeMessage(input), 'utf8').toString('base64url');
}

/** Gmail rejects messages over 25 MB of attachments. */
export const GMAIL_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Load attachment specs ({ path | filePath | workspacePath, name?, mimeType? } or a bare path string)
 * from disk. Relative paths resolve against workspaceRoot. Throws on missing files or size overflow.
 */
export function loadGmailAttachments(items: unknown, workspaceRoot: string): GmailMimeAttachment[] {
  if (!Array.isArray(items) || !items.length) return [];
  const out: GmailMimeAttachment[] = [];
  let total = 0;
  for (const item of items) {
    const spec: any = typeof item === 'string' ? { path: item } : item;
    if (!spec || typeof spec !== 'object') continue;
    const rel = String(spec.path || spec.filePath || spec.workspacePath || '').trim();
    if (!rel) throw new Error('Attachment is missing a file path.');
    const abs = path.isAbsolute(rel) ? rel : path.resolve(workspaceRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`Attachment not found: ${rel}`);
    const content = fs.readFileSync(abs);
    total += content.length;
    if (total > GMAIL_MAX_ATTACHMENT_BYTES) throw new Error('Attachments exceed Gmail\'s 25 MB limit.');
    const filename = String(spec.name || spec.filename || path.basename(abs));
    out.push({ filename, mimeType: spec.mimeType ? String(spec.mimeType) : guessMimeType(filename), content });
  }
  return out;
}
