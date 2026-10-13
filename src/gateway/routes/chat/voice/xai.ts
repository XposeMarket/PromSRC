import type { Router, RequestHandler } from 'express';
import { getConfiguredXaiCredentialSummary, getXaiAuthCandidates } from '../../../../auth/xai-account-pool.js';
import { assertSafeStorageId, isStorageBoundaryError } from '../../../storage/storage-paths.js';
import { VoiceAgentTargetContext, normalizeVoiceAgentTarget, voiceAgentTargetIdentity, loadVoiceAgentMemoryForTarget, voiceAgentWorkerHandoffSessions, findActiveMainChatRuntimeForSession, compactVoiceText, summarizeUnlockedToolCategories, buildVoiceConversationTranscript, buildVoiceCompactionSummaryBlock, buildVoiceRecentToolLog, buildVoiceWorkerContextPacket, getReusableVoiceContextPacket, getVoiceAgentContextBlock } from './context';
import { parseVoiceToolResult, voiceRuntimeContextText } from './fallback';
import { buildVoiceTimeContext, buildRealtimeSkillContextForTranscript, voiceRuntimeDirectiveFromToolResult, parseVoiceToolArgs, cleanVoiceWakePhrase } from './tool-helpers';
import { mobileCameraRuntimeContextText, buildRealtimeVoiceAgentInstructions, buildRealtimeVoiceAgentTools } from './realtime';
import { router, storageAwareStatus } from './dependencies';


// ============================================================================
// xAI / Grok Realtime Voice Agent
// ----------------------------------------------------------------------------
// xAI's realtime Voice Agent is the speech-to-speech sibling of OpenAI Realtime.
// Unlike OpenAI (WebRTC + server-side SDP), xAI's browser transport is a raw
// WebSocket authenticated with an ephemeral client-secret passed via the WS
// subprotocol (xai-client-secret.<token>). So this bootstrap mints the token and
// returns the instructions/tools/voice for the CLIENT to send over session.update
// after the socket opens. The instruction/tool/context builders are shared with
// the OpenAI agent so both providers behave identically once connected.
// ============================================================================

export const XAI_REALTIME_CLIENT_SECRETS_ENDPOINT = `${(process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').replace(/\/+$/, '')}/realtime/client_secrets`;
export const XAI_VOICE_CATALOG_ENDPOINT = `${(process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').replace(/\/+$/, '')}/tts/voices`;
export const XAI_REALTIME_WS_BASE = process.env.XAI_REALTIME_WS_URL || 'wss://api.x.ai/v1/realtime';
export const DEFAULT_XAI_REALTIME_MODEL = process.env.XAI_REALTIME_MODEL || 'grok-voice-latest';
export const DEFAULT_XAI_REALTIME_VOICE = process.env.XAI_REALTIME_VOICE || 'eve';
export const XAI_REALTIME_USER_AGENT = process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0';
// Built-in xAI voices. The API's /v1/tts/voices endpoint is the source of
// truth for custom/team voices; keep the current built-in roster here so the
// picker still works immediately for connected OAuth accounts.
export const XAI_REALTIME_VOICE_IDS = [
  'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith',
  'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa',
  'sirius', 'lumen', 'castor', 'naksh', 'atlas',
  'eve', 'ara', 'rex', 'sal', 'leo',
];

export type XaiRealtimeAuthCandidate = { token: string; auth: 'xai_oauth' | 'api_key'; accountId?: string; label: string };

// Resolve every usable xAI credential for the realtime client_secret mint. For
// voice mode, prefer the user's connected OAuth account so a stale env/config
// API key cannot silently override it; keep API key as a fallback candidate.
export async function getXaiRealtimeAuthCandidates(): Promise<XaiRealtimeAuthCandidate[]> {
  return getXaiAuthCandidates();
}

export async function getXaiRealtimeVoices(): Promise<string[]> {
  const fallback = [...XAI_REALTIME_VOICE_IDS];
  try {
    const candidates = await getXaiRealtimeAuthCandidates();
    for (const candidate of candidates) {
      const response = await fetch(XAI_VOICE_CATALOG_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${candidate.token}`,
          'User-Agent': XAI_REALTIME_USER_AGENT,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) continue;
      const data: any = await response.json().catch(() => ({}));
      const live = (Array.isArray(data?.voices) ? data.voices : [])
        .map((voice: any) => String(voice?.voice_id || voice?.id || voice?.name || voice || '').trim().toLowerCase())
        .filter(Boolean);
      if (live.length) return [...new Set([...live, ...fallback])];
    }
  } catch {}
  return fallback;
}

export function sanitizeXaiRealtimeModel(value: unknown): string {
  const model = String(value || DEFAULT_XAI_REALTIME_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_XAI_REALTIME_MODEL;
}

export function sanitizeXaiRealtimeVoice(value: unknown): string {
  const voice = String(value || DEFAULT_XAI_REALTIME_VOICE).trim().toLowerCase();
  return /^[a-zA-Z0-9._:-]+$/.test(voice) ? voice : DEFAULT_XAI_REALTIME_VOICE;
}

export function sanitizeXaiRealtimeSpeed(value: unknown): number {
  const speed = Number(value || 1);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.7, Math.min(1.5, Math.round(speed * 100) / 100));
}
export function registerXaiVoiceRoutes(router: Router, requireSafeSessionParam: RequestHandler) {

router.get('/api/realtime/xai/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const credentials = getConfiguredXaiCredentialSummary();
  const voices = credentials.configured ? await getXaiRealtimeVoices() : XAI_REALTIME_VOICE_IDS;
  res.json({
    success: true,
    configured: credentials.configured,
    model: DEFAULT_XAI_REALTIME_MODEL,
    voice: DEFAULT_XAI_REALTIME_VOICE,
    voices,
    auth: credentials.oauthConfigured ? 'xai_oauth' : (credentials.apiKeyConfigured ? 'api_key' : 'none'),
    oauthConfigured: credentials.oauthConfigured,
    apiKeyConfigured: credentials.apiKeyConfigured,
  });
});

router.post('/api/voice-agent/xai-realtime-bootstrap', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const authCandidates = await getXaiRealtimeAuthCandidates();
    if (!authCandidates.length) {
      res.status(400).json({ ok: false, success: false, error: 'xAI Realtime requires an xAI API key (XAI_API_KEY) or a connected xAI OAuth account. Add one in Settings -> Models.' });
      return;
    }

    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    const cameraRuntimeContext = mobileCameraRuntimeContextText(body.cameraRuntime || body.camera_runtime);
    if (voiceRuntimeContext) contextPacket.voiceRuntime = voiceRuntimeContext;
    const currentTime = buildVoiceTimeContext(body.deviceTime || body.device_time || body.clientTime || body.client_time);
    contextPacket.currentTime = currentTime;
    const originalPrompt = String(body.originalUserPrompt || '').trim();
    let contextBlockResult: { contextBlock: string; elapsedMs?: number; cacheHit?: boolean };
    try {
      contextBlockResult = await getVoiceAgentContextBlock(sessionId, originalPrompt, { voiceTarget });
    } catch (err: any) {
      console.warn('[xai-realtime] context block failed; starting with worker packet only:', err?.message || err);
      contextBlockResult = { contextBlock: '' };
    }
    const voiceAgentMemory = loadVoiceAgentMemoryForTarget(voiceTarget);
    const wakePhrase = cleanVoiceWakePhrase(body?.voiceRuntime?.wakePhrase || body?.voice_runtime?.wakePhrase || '');

    const instructions = buildRealtimeVoiceAgentInstructions({
      contextBlock: contextBlockResult.contextBlock,
      contextPacket,
      voiceAgentMemory,
      voiceRuntime: voiceRuntimeContext,
      cameraRuntime: cameraRuntimeContext,
      wakePhrase,
      conversationTranscript: buildVoiceConversationTranscript(sessionId, 24, 600, voiceTarget),
      conversationSummary: buildVoiceCompactionSummaryBlock(sessionId, 4000, voiceTarget),
      recentToolLog: buildVoiceRecentToolLog(sessionId, 8, voiceTarget),
      currentTime,
      voiceTarget,
    });
    const tools = buildRealtimeVoiceAgentTools(voiceTarget, null, sessionId);

    const model = sanitizeXaiRealtimeModel(body.model);
    const voice = sanitizeXaiRealtimeVoice(body.voice);
    const speed = sanitizeXaiRealtimeSpeed(body.speed);

    // Mint a short-lived ephemeral token. The browser cannot set WS headers, so it
    // connects with the token as a subprotocol (xai-client-secret.<token>) and sends
    // the session config (instructions/tools/voice) itself via session.update.
    let data: any = null;
    let usedAuth: XaiRealtimeAuthCandidate['auth'] | null = null;
    let lastFailure: { status: number; data: any; auth: XaiRealtimeAuthCandidate['auth'] } | null = null;
    const bodyJson = JSON.stringify({ expires_after: { seconds: 300 } });
    for (const candidate of authCandidates) {
      const upstream = await fetch(XAI_REALTIME_CLIENT_SECRETS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${candidate.token}`,
          'Content-Type': 'application/json',
          'User-Agent': XAI_REALTIME_USER_AGENT,
        },
        body: bodyJson,
      });
      const text = await upstream.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      console.log('[xai-realtime] client_secret mint', {
        endpoint: XAI_REALTIME_CLIENT_SECRETS_ENDPOINT,
        auth: candidate.auth,
        accountId: candidate.accountId || null,
        accountLabel: candidate.label,
        status: upstream.status,
        ok: upstream.ok,
        responseKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : typeof parsed,
        body: upstream.ok ? undefined : String(text || '').slice(0, 500),
      });
      if (upstream.ok) {
        data = parsed;
        usedAuth = candidate.auth;
        break;
      }
      lastFailure = { status: upstream.status, data: parsed, auth: candidate.auth };
    }
    if (!data) {
      res.status(lastFailure?.status || 502).json({
        ok: false,
        success: false,
        error: lastFailure?.data?.error?.message || lastFailure?.data?.error || `xAI Realtime client_secret mint failed (${lastFailure?.status || 502})`,
        details: lastFailure?.data,
        auth: lastFailure?.auth || null,
      });
      return;
    }
    const clientSecret = String(data?.client_secret?.value || data?.value || data?.client_secret || data?.secret || '').trim();
    if (!clientSecret) {
      res.status(502).json({ ok: false, success: false, error: 'xAI Realtime client_secret was not returned.', details: data });
      return;
    }

    res.json({
      ok: true,
      success: true,
      provider: 'xai',
      clientSecret,
      auth: usedAuth,
      wsUrl: `${XAI_REALTIME_WS_BASE}?model=${encodeURIComponent(model)}`,
      model,
      voice,
      speed,
      instructions,
      tools,
      contextPacket,
      instructionsLength: instructions.length,
      toolCount: tools.length,
      expiresAt: data?.client_secret?.expires_at || data?.expires_at || null,
      sessionConfig: { type: 'realtime', model, voice, speed },
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-skill-context', async (req, res) => {
  try {
    const body = req.body || {};
    const transcript = String(body.transcript || body.text || body.message || '').trim();
    const maxChars = Math.min(8000, Math.max(1000, Number(body.maxChars || body.max_chars || 4200) || 4200));
    const result = buildRealtimeSkillContextForTranscript(transcript, maxChars);
    res.json({
      ok: true,
      success: true,
      matched: result.skills.length > 0,
      context: result.context,
      skills: result.skills,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});
}
