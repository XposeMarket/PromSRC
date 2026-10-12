export const DESKTOP_VOICE_SETTINGS_KEY = 'pm_voice_settings_v1';
const DESKTOP_VOICE_MODES = new Set(['canonical', 'openai_realtime', 'xai']);

export function normalizeDesktopVoiceMode(value) {
  const mode = String(value || '').trim();
  return DESKTOP_VOICE_MODES.has(mode) ? mode : 'canonical';
}

export function loadDesktopVoiceSettings(getStoredVoiceSetting) {
  try {
    const saved = JSON.parse(localStorage.getItem(DESKTOP_VOICE_SETTINGS_KEY) || '{}');
    // Old saved defaults were realtime reasoning sessions, not opt-ins.
    const legacyMode = saved.legacyRealtime === true ? saved.voiceMode : 'canonical';
    return {
      voiceMode: normalizeDesktopVoiceMode(legacyMode),
      legacyRealtime: saved.legacyRealtime === true,
      sttProvider: ['browser', 'openai', 'xai'].includes(saved.sttProvider) ? saved.sttProvider : 'browser',
      ttsProvider: legacyMode === 'canonical' ? (saved.ttsProvider === 'realtime' ? 'browser' : saved.ttsProvider || 'browser') : 'realtime',
      realtimeVoice: saved.realtimeVoice || getStoredVoiceSetting('realtime_voice', 'marin'),
      realtimeSpeed: Number(saved.realtimeSpeed || getStoredVoiceSetting('realtime_voice_speed', '1.1') || 1.1),
      serverVoice: saved.serverVoice || getStoredVoiceSetting('voice_xai_voice', 'eve'),
      xaiSpeed: Number(saved.xaiSpeed || saved.realtimeSpeed || 1.0),
      dictation: saved.dictation || 'quiet',
      sttProviderLocked: saved.sttProviderLocked === true,
      autoProviderDefault: saved.autoProviderDefault || '',
      voiceAgentXaiRealtime: saved.voiceAgentXaiRealtime === true,
    };
  } catch {
    return {
      voiceMode: 'canonical',
      sttProvider: 'browser',
      ttsProvider: 'browser',
      realtimeVoice: 'marin',
      realtimeSpeed: 1.1,
      serverVoice: 'eve',
      xaiSpeed: 1.0,
      dictation: 'quiet',
      sttProviderLocked: false,
      autoProviderDefault: '',
      voiceAgentXaiRealtime: false,
    };
  }
}

export function desktopVoiceParticipantKey(participant = {}) {
  if (String(participant?.kind || '').trim() === 'subagent') {
    const agentId = String(participant.agentId || participant.id || '').trim();
    return agentId ? `subagent:${agentId}` : '';
  }
  return 'main';
}

export function desktopVoiceParticipantLabel(participant = {}) {
  if (String(participant?.kind || '').trim() !== 'subagent') return 'Prometheus';
  return String(participant.label || participant.name || participant.alias || participant.agentId || participant.id || 'Subagent')
    .replace(/\s+/g, ' ').trim() || 'Subagent';
}

export function normalizeDesktopVoiceParticipant(participant = {}) {
  const kind = String(participant?.kind || '').trim() === 'subagent' ? 'subagent' : 'main';
  const agentId = kind === 'subagent' ? String(participant.agentId || participant.id || '').trim() : '';
  const key = kind === 'subagent' ? (agentId ? `subagent:${agentId}` : '') : 'main';
  if (!key) return null;
  return {
    key,
    kind,
    ...(agentId ? { agentId } : {}),
    label: kind === 'main' ? 'Prometheus' : desktopVoiceParticipantLabel({ ...participant, kind, agentId }),
    aliases: Array.from(new Set([
      desktopVoiceParticipantLabel({ ...participant, kind, agentId }),
      participant.alias,
      participant.name,
      agentId,
      ...(kind === 'main' ? ['Prom', 'main agent', 'main chat'] : []),
    ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))),
  };
}

export function normalizeDesktopVoiceRoomState(source = {}) {
  const rawParticipants = Array.isArray(source?.participants) ? source.participants : [];
  const seen = new Set();
  const participants = rawParticipants
    .map(normalizeDesktopVoiceParticipant)
    .filter((participant) => participant && !seen.has(participant.key) && seen.add(participant.key))
    .slice(0, 12);
  const enabled = source?.enabled === true && participants.length > 1;
  const activeKey = String(source?.activeKey || '').trim();
  return {
    version: 1,
    enabled,
    sessionId: enabled && String(source?.sessionId || '').startsWith('voice_room_') ? String(source.sessionId) : '',
    rosterKey: String(source?.rosterKey || '').trim(),
    participants,
    activeKey: enabled && participants.some((participant) => participant.key === activeKey)
      ? activeKey
      : (participants[0]?.key || ''),
    focusUntil: Number(source?.focusUntil || 0) || 0,
    quiet: source?.quiet && typeof source.quiet === 'object' ? { ...source.quiet } : {},
  };
}


export function getStoredVoiceProvider(kind, fallback) {
  try {
    const value = localStorage.getItem(`prometheus_voice_${kind}_provider`);
    return value ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

export function storeVoiceProvider(kind, provider) {
  try { localStorage.setItem(`prometheus_voice_${kind}_provider`, provider); } catch {}
}

export function getStoredVoiceSetting(key, fallback = '') {
  try {
    const value = localStorage.getItem(`prometheus_${key}`);
    return value ? String(value) : fallback;
  } catch {
    return fallback;
  }
}

export function storeVoiceSetting(key, value) {
  try { localStorage.setItem(`prometheus_${key}`, String(value || '')); } catch {}
}


export function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export const OPENAI_PUBLIC_REALTIME_VOICE_IDS = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
export const CODEX_AVAS_REALTIME_VOICE_IDS = ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'];
