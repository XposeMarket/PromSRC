import type { Router, RequestHandler } from 'express';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { getConnector, isConnectorConnected } from '../../../integrations/connector-registry.js';
import type { GmailConnector } from '../../../integrations/connectors/gmail.js';
import { gmailSendOptionsFromArgs } from '../../../extensions/bundled/connectors/gmail/runtime.js';
import { assertSafeStorageId, isStorageBoundaryError } from '../../storage/storage-paths.js';

export function splitComposerEmailList(value: any): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function findStoredEmailComposerArtifact(sessionId: unknown, artifactId: unknown): any | null {
  const sid = String(sessionId || '').trim();
  const aid = String(artifactId || '').trim();
  if (!sid || !aid) return null;
  try {
    const history = getSession(assertSafeStorageId(sid, 'session id'))?.history || [];
    for (let i = history.length - 1; i >= 0; i--) {
      const artifacts = Array.isArray((history[i] as any)?.richArtifacts) ? (history[i] as any).richArtifacts : [];
      const hit = artifacts.find((a: any) => a && a.type === 'email_composer' && String(a.id || '') === aid);
      if (hit) return hit;
    }
  } catch {}
  return null;
}

export function buildSentEmailComposerArtifact(args: any, sent: { id?: string; threadId?: string }, gmail: GmailConnector) {
  const now = new Date().toISOString();
  let accountEmail = '';
  try {
    const tokens = (gmail as any)?.loadTokens?.();
    accountEmail = tokens?.account_email ? String(tokens.account_email) : '';
  } catch {}
  const recipients = splitComposerEmailList(args.to);
  return {
    id: String(args.artifactId || args.id || `email-sent-${Date.now()}`),
    type: 'email_composer',
    provider: 'gmail',
    mode: 'sent',
    status: 'sent',
    title: 'Email sent',
    subtitle: recipients.length ? `To ${recipients.join(', ')}` : 'Sent',
    source: 'Gmail',
    accountEmail,
    to: recipients,
    cc: splitComposerEmailList(args.cc),
    bcc: splitComposerEmailList(args.bcc),
    subject: String(args.subject || '').trim(),
    body: String(args.body || ''),
    attachments: Array.isArray(args.attachments) ? args.attachments : [],
    messageId: sent.id,
    threadId: sent.threadId,
    createdAt: String(args.createdAt || now),
    sentAt: now,
  };
}

export function registerEmailComposerRoutes(router: Router): void {
router.post('/api/connectors/gmail/send-composer', async (req, res) => {
  try {
    if (!isConnectorConnected('gmail')) {
      res.status(400).json({ success: false, error: 'Gmail is not connected.' });
      return;
    }
    const body = req.body || {};
    const to = splitComposerEmailList(body.to).join(', ');
    const subject = String(body.subject || '').trim();
    const emailBody = String(body.body || '');
    if (!to) {
      res.status(400).json({ success: false, error: 'Recipient required.' });
      return;
    }
    if (!subject) {
      res.status(400).json({ success: false, error: 'Subject required.' });
      return;
    }
    const gmail = getConnector('gmail') as unknown as GmailConnector;
    // The composer card only posts the editable text fields. Attachments, HTML body and
    // reply threading come from the server-stored draft artifact so they are not dropped.
    const draft = findStoredEmailComposerArtifact(body.sessionId, body.artifactId);
    const draftArgs = {
      html_body: draft?.htmlBody,
      attachments: Array.isArray(draft?.attachments) ? draft.attachments.filter((a: any) => a?.path) : [],
      reply_to_message_id: draft?.replyToMessageId,
      thread_id: draft?.replyThreadId,
    };
    const sent = await gmail.sendEmail(
      to,
      subject,
      emailBody,
      splitComposerEmailList(body.cc).join(', ') || undefined,
      splitComposerEmailList(body.bcc).join(', ') || undefined,
      gmailSendOptionsFromArgs(draftArgs),
    );
    res.json({
      success: true,
      messageId: sent.id,
      threadId: sent.threadId,
      artifact: buildSentEmailComposerArtifact({ ...body, attachments: draft?.attachments || body.attachments }, sent, gmail),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err || 'Failed to send email.') });
  }
});
}

