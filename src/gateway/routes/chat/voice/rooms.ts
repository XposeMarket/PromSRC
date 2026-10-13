import type { Router, RequestHandler } from 'express';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import crypto from 'crypto';
import { router, requireSafeSessionParam } from './dependencies';


export function normalizeVoiceRoomParticipants(raw: any): VoiceRoomParticipant[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .map((item: any) => {
      const kind = String(item?.kind || '') === 'subagent' ? 'subagent' : 'main';
      const agentId = kind === 'subagent' ? String(item?.agentId || item?.id || '').trim() : '';
      const key = kind === 'subagent' ? (agentId ? `subagent:${agentId}` : '') : 'main';
      const label = String(item?.label || item?.name || (kind === 'main' ? 'Prometheus' : agentId))
        .replace(/\s+/g, ' ').trim().slice(0, 80);
      return key && label
        ? { key, kind, ...(agentId ? { agentId } : {}), label } as VoiceRoomParticipant
        : null;
    })
    .filter((item: VoiceRoomParticipant | null): item is VoiceRoomParticipant => {
      if (!item || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
export function registerRoomsVoiceRoutes(router: Router, requireSafeSessionParam: RequestHandler) {

router.post('/api/voice-rooms/resolve', (req, res) => {
  try {
    const participants = normalizeVoiceRoomParticipants(req.body?.participants);
    if (participants.length < 2) {
      res.status(400).json({ success: false, error: 'A Voice Room requires at least two agents.' });
      return;
    }
    const rosterKey = participants.map((participant) => participant.key).join('|');
    const id = `voice_room_${crypto.createHash('sha256').update(rosterKey).digest('hex').slice(0, 20)}`;
    const existing = getSession(id);
    const created = !existing.voiceRoom;
    const now = Date.now();
    const voiceRoom: VoiceRoomMetadata = {
      version: 1,
      rosterKey,
      participants,
      createdAt: Number(existing.voiceRoom?.createdAt || existing.createdAt || now),
      updatedAt: now,
    };
    const title = `Voice Room Â· ${participants.map((participant) => participant.label).join(' + ')}`.slice(0, 80);
    const session = touchSession(id, { channel: 'voice_room', title, voiceRoom });
    session.autoTitleLocked = true;
    flushSession(id);
    res.json({
      success: true,
      created,
      session: {
        id: session.id,
        channel: session.channel,
        title: getSessionDisplayTitle(session),
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        voiceRoom: session.voiceRoom,
      },
    });
  } catch (error: any) {
    console.error('[/api/voice-rooms/resolve] Error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to resolve Voice Room' });
  }
});

router.post('/api/voice-rooms/:id/transcript', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const session = getSession(sessionId);
    if (session.channel !== 'voice_room' || !session.voiceRoom) {
      res.status(409).json({ success: false, error: 'Session is not a Voice Room.' });
      return;
    }
    const role = String(req.body?.role || '') === 'assistant' ? 'assistant' : 'user';
    const content = String(req.body?.text || req.body?.content || '').replace(/\s+/g, ' ').trim().slice(0, 20_000);
    const voiceSpeaker = String(req.body?.speaker || (role === 'user' ? 'You' : 'Agent'))
      .replace(/\s+/g, ' ').trim().slice(0, 120);
    const voiceTargetKey = String(req.body?.targetKey || '').trim().slice(0, 180);
    const messageId = String(req.body?.messageId || '').trim().slice(0, 180)
      || `voice-room-${crypto.randomUUID()}`;
    if (!content) {
      res.status(400).json({ success: false, error: 'Transcript text is required.' });
      return;
    }
    const duplicate = session.history.slice(-24).some((message) => String(message.messageId || '') === messageId);
    if (!duplicate) {
      const timestamp = Number(req.body?.timestamp || Date.now()) || Date.now();
      addMessage(sessionId, {
        messageId,
        role,
        content,
        timestamp,
        ...(role === 'assistant' ? {
          workStartedAt: timestamp,
          workEndedAt: timestamp,
          workDurationMs: 0,
        } : {}),
        channel: 'voice_room',
        channelLabel: 'Voice Room',
        source: 'voice_room_transcript',
        voiceSpeaker,
        voiceTargetKey,
      }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      session.voiceRoom.updatedAt = Date.now();
      flushSession(sessionId);
    }
    res.json({ success: true, duplicate, messageId });
  } catch (error: any) {
    console.error('[/api/voice-rooms/:id/transcript] Error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to append Voice Room transcript' });
  }
});
}
