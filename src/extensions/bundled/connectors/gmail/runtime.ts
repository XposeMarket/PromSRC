// Native Gmail connector runtime. See §23B. Auth stays in GmailConnector.
// The email-composer artifact helpers (previously in connector-handlers.ts) live
// here now since Gmail is their only consumer.
import type { GmailConnector } from '../../../../integrations/connectors/gmail.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'gmail';
const NAME = 'Gmail';
const tools = ['connector_gmail_list_emails', 'connector_gmail_get_email', 'connector_gmail_prepare_email', 'connector_gmail_send_email', 'connector_gmail_get_profile', 'connector_gmail_list_labels'];

async function withConn(fn: (c: GmailConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<GmailConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

function summarizeEmails(messages: any[]): string {
  if (!messages.length) return 'No emails found.';
  return messages.map((m: any) => `• [${m.id}] ${m.subject} | from: ${m.from} | ${m.date}\n  ${m.snippet}`).join('\n');
}

function splitEmailList(value: any): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeEmailAttachments(value: any): any[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const path = String(item.path || item.filePath || item.workspacePath || '').trim();
      const name = String(item.name || item.filename || (path ? path.split(/[\\/]/).pop() : '') || `Attachment ${index + 1}`).trim();
      if (!name && !path) return null;
      return {
        id: String(item.id || `att-${index + 1}`),
        name,
        path: path || undefined,
        mimeType: item.mimeType ? String(item.mimeType) : undefined,
        size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
      };
    })
    .filter(Boolean);
}

function getGmailAccountEmail(gmail: GmailConnector): string | undefined {
  try {
    const tokens = (gmail as any)?.loadTokens?.();
    return tokens?.account_email ? String(tokens.account_email) : undefined;
  } catch {
    return undefined;
  }
}

function buildEmailComposerArtifact(gmail: GmailConnector, args: any, state: { mode: 'draft' | 'sent'; status: 'draft' | 'sent' | 'failed'; sent?: { id?: string; threadId?: string }; error?: string }) {
  const now = new Date().toISOString();
  const subject = String(args.subject || '').trim();
  const to = splitEmailList(args.to);
  const cc = splitEmailList(args.cc);
  const bcc = splitEmailList(args.bcc);
  const body = String(args.body || '');
  const idSeed = [state.mode, to.join(','), cc.join(','), bcc.join(','), subject, body.slice(0, 80), Date.now()].join('|');
  const id = `email-${Math.abs(idSeed.split('').reduce((hash, ch) => ((hash << 5) - hash + ch.charCodeAt(0)) | 0, 0))}-${Date.now()}`;
  return {
    id, type: 'email_composer', provider: 'gmail', mode: state.mode, status: state.status,
    title: state.mode === 'sent' ? 'Email sent' : 'Email draft',
    subtitle: to.length ? `To ${to.join(', ')}` : 'Ready to address',
    source: 'Gmail', accountEmail: getGmailAccountEmail(gmail),
    to, cc, bcc, subject, body,
    htmlBody: args.html_body ? String(args.html_body) : undefined,
    attachments: normalizeEmailAttachments(args.attachments),
    messageId: state.sent?.id, threadId: state.sent?.threadId,
    createdAt: now, sentAt: state.mode === 'sent' ? now : undefined, error: state.error,
  };
}

function emailComposerResult(summary: string, artifact: any): PrometheusToolExecutionResult {
  return { result: summary, error: false, extra: { richArtifacts: [artifact] }, data: { richArtifacts: [artifact] } };
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['email'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
    });

    api.registerTool({
      name: 'connector_gmail_list_emails',
      description: '[Gmail] List emails from inbox. Supports Gmail search query syntax (e.g., "from:boss@acme.com", "is:unread", "subject:invoice", "after:2024/01/01").',
      parameters: { type: 'object', required: [], properties: { query: { type: 'string', description: 'Gmail search query (default: inbox). Examples: "is:unread", "from:example@gmail.com", "has:attachment", "label:work"' }, max_results: { type: 'number', description: 'Max emails to return (default: 20, max: 100)' } } },
      connectorId: ID, capability: 'email',
      execute: (args: any) => withConn(async (c) => {
        const maxResults = Math.min(100, args.max_results || 20);
        const ids = await c.listMessages(maxResults, args.query || '');
        if (!ids.length) return toolOk('No emails found.');
        const emails = await Promise.all(ids.slice(0, Math.min(20, ids.length)).map((m: any) => c.getMessageParsed(m.id)));
        return toolOk(summarizeEmails(emails));
      }),
    });

    api.registerTool({
      name: 'connector_gmail_get_email',
      description: '[Gmail] Fetch full content of a specific email including subject, from, date, and body text.',
      parameters: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string', description: 'Gmail message ID (from connector_gmail_list_emails)' } } },
      connectorId: ID, capability: 'email',
      execute: (args: any) => withConn(async (c) => {
        const msg = await c.getMessageParsed(args.message_id);
        return toolOk(`Subject: ${msg.subject}\nFrom: ${msg.from}\nDate: ${msg.date}\n\n${msg.body || msg.snippet}`);
      }),
    });

    api.registerTool({
      name: 'connector_gmail_prepare_email',
      description: '[Gmail] Prepare an editable email draft composer in chat. Use this by default when the user asks to draft, write, compose, or prepare an email, so they can review/edit and click Send.',
      parameters: { type: 'object', required: ['to', 'subject', 'body'], properties: { to: { type: 'string', description: 'Recipient email address (or comma-separated for multiple)' }, subject: { type: 'string', description: 'Email subject line' }, body: { type: 'string', description: 'Plain text email body' }, cc: { type: 'string', description: 'CC recipients (comma-separated)' }, bcc: { type: 'string', description: 'BCC recipients (comma-separated)' }, attachments: { type: 'array', items: { type: 'object' }, description: 'Optional attachment metadata. Sending attachments is not yet supported by Gmail delivery.' } } },
      connectorId: ID, capability: 'email',
      execute: (args: any) => withConn(async (c) => {
        const artifact = buildEmailComposerArtifact(c, args, { mode: 'draft', status: 'draft' });
        return emailComposerResult('Email draft prepared. Show the user the composer so they can edit or send it.', artifact);
      }),
    });

    api.registerTool({
      name: 'connector_gmail_send_email',
      description: '[Gmail] Send an email from the connected Gmail account. Use only when the user clearly asked to send now; otherwise use connector_gmail_prepare_email.',
      parameters: { type: 'object', required: ['to', 'subject', 'body'], properties: { to: { type: 'string', description: 'Recipient email address (or comma-separated for multiple)' }, subject: { type: 'string', description: 'Email subject line' }, body: { type: 'string', description: 'Plain text email body' }, cc: { type: 'string', description: 'CC recipients (comma-separated)' }, bcc: { type: 'string', description: 'BCC recipients (comma-separated)' } } },
      connectorId: ID, capability: 'email',
      execute: (args: any) => withConn(async (c) => {
        const sent = await c.sendEmail(args.to, args.subject, args.body, args.cc, args.bcc);
        const artifact = buildEmailComposerArtifact(c, args, { mode: 'sent', status: 'sent', sent });
        return emailComposerResult(`Email sent successfully. Message ID: ${sent.id}, Thread ID: ${sent.threadId}`, artifact);
      }),
    });

    api.registerTool({
      name: 'connector_gmail_get_profile',
      description: '[Gmail] Get the connected Gmail account profile (email address, total message count).',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: ID, capability: 'email',
      execute: () => withConn(async (c) => toolOk(await c.getProfile())),
    });

    api.registerTool({
      name: 'connector_gmail_list_labels',
      description: '[Gmail] List all Gmail labels/folders on the connected account.',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: ID, capability: 'email',
      execute: () => withConn(async (c) => {
        const labels = await c.listLabels();
        return toolOk(labels.map((l: any) => `${l.id}: ${l.name} (${l.type})`).join('\n'));
      }),
    });
  },
};

export default ext;
