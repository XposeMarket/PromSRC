import express from 'express';
import { getConfig } from '../../config/config.js';
import { buildCodexCloudflareHeaders, getValidToken, loadTokens, refreshTokens } from '../../auth/openai-oauth.js';
import { buildSystemPrompt, loadSkills } from '../../config/soul-loader.js';
import { loadVoiceAgentMemory } from '../prompt-context.js';

export const router = express.Router();

const DEFAULT_REALTIME_MODEL = 'gpt-realtime';
const DEFAULT_REALTIME_VOICE = 'marin';
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
const REALTIME_CLIENT_SECRETS_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
const REALTIME_INSTRUCTIONS_MAX_CHARS = Number(process.env.OPENAI_REALTIME_INSTRUCTIONS_MAX_CHARS || 18000);
const REALTIME_CONTEXT_PACK_CACHE_TTL_MS = Math.max(5_000, Number(process.env.OPENAI_REALTIME_CONTEXT_PACK_CACHE_TTL_MS || 60_000) || 60_000);
let realtimeContextPackCache: { instructions: string; builtAt: number; workspacePath: string } | null = null;

function resolveRealtimeSecret(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (raw.startsWith('env:')) return String(process.env[raw.slice(4)] || '').trim();
  return String(getConfig().resolveSecret(raw) || '').trim();
}

function getRealtimeApiKey(): string {
  const cfg = getConfig().getConfig() as any;
  const providers = cfg?.llm?.providers && typeof cfg.llm.providers === 'object' ? cfg.llm.providers : {};
  const openAiProviderKey = typeof providers?.openai?.api_key === 'string'
    ? resolveRealtimeSecret(providers.openai.api_key)
    : '';
  return String(
    process.env.OPENAI_REALTIME_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VOICE_TOOLS_OPENAI_KEY
    || openAiProviderKey
    || ''
  ).trim();
}

function getConfigDir(): string {
  return getConfig().getConfigDir();
}

type RealtimeAuthCandidate = {
  token: string;
  auth: 'api_key' | 'openai_codex_oauth_api_key' | 'openai_codex_oauth';
};

function getJwtExpiryMs(token: string): number {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function loadRealtimeOpenAiCodexTokens() {
  const configDir = getConfigDir();
  let tokens = loadTokens(configDir);
  if (!tokens) return null;
  const hasApiKey = !!String(tokens.api_key || '').trim();
  const idTokenExpiryMs = getJwtExpiryMs(String(tokens.id_token || ''));
  const idTokenExpired = !idTokenExpiryMs || Date.now() > idTokenExpiryMs - 60_000;
  if (!hasApiKey && idTokenExpired) {
    try {
      tokens = await refreshTokens(configDir);
      console.log('[realtime] refreshed Codex OAuth for realtime auth', {
        hasExchangedApiKey: !!String(tokens?.api_key || '').trim(),
      });
    } catch (err: any) {
      console.warn('[realtime] Codex OAuth refresh for realtime auth failed', {
        message: String(err?.message || err || ''),
      });
    }
  }
  return loadTokens(configDir) || tokens;
}

function hasOpenAICodexOAuth(): boolean {
  return loadTokens(getConfigDir()) !== null;
}

async function getRealtimeAuthCandidates(): Promise<RealtimeAuthCandidate[]> {
  const candidates: RealtimeAuthCandidate[] = [];
  const seen = new Set<string>();
  const push = (token: string, auth: RealtimeAuthCandidate['auth']) => {
    const value = String(token || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push({ token: value, auth });
  };
  const apiKey = getRealtimeApiKey();
  push(apiKey, 'api_key');

  if (hasOpenAICodexOAuth()) {
    try {
      const tokens = await loadRealtimeOpenAiCodexTokens();
      push(String(tokens?.api_key || '').trim(), 'openai_codex_oauth_api_key');
      const token = await getValidToken(getConfigDir());
      push(token, 'openai_codex_oauth');
    } catch {
      // Status/client-secret responses below will report that no usable auth was found.
    }
  }

  return candidates;
}

function sanitizeRealtimeModel(value: unknown): string {
  const model = String(value || process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_REALTIME_MODEL;
}

function sanitizeRealtimeVoice(value: unknown): string {
  const voice = String(value || process.env.OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(voice) ? voice : DEFAULT_REALTIME_VOICE;
}

function sanitizeRealtimeSpeed(value: unknown): number {
  const speed = Number(value || process.env.OPENAI_REALTIME_SPEED || 1);
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.25, Math.min(1.5, Math.round(speed * 100) / 100));
}

function sanitizeRealtimeTranscriptionModel(value: unknown): string {
  const model = String(value || process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || DEFAULT_REALTIME_TRANSCRIPTION_MODEL).trim();
  return /^[a-zA-Z0-9._:-]+$/.test(model) ? model : DEFAULT_REALTIME_TRANSCRIPTION_MODEL;
}

function sanitizeRealtimeLanguage(value: unknown): string {
  const language = String(value || process.env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE || '').trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language) ? language : '';
}

function clampText(text: string, maxChars: number): string {
  const value = String(text || '').trim();
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (!value || !limit) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 18)).trimEnd()}\n...[truncated]`;
}

function sanitizeRealtimeInstructions(value: unknown): string {
  return clampText(String(value || ''), Math.max(2000, REALTIME_INSTRUCTIONS_MAX_CHARS));
}

function buildSkillCatalogDigest(maxChars = 4500): string {
  const skills = loadSkills();
  if (!skills.length) return 'No reusable skills are currently installed.';
  const lines = skills.slice(0, 80).map((skill) => {
    const bits = [
      `- ${skill.slug}${skill.name && skill.name !== skill.slug ? ` (${skill.name})` : ''}`,
      skill.description ? `: ${String(skill.description).replace(/\s+/g, ' ').trim()}` : '',
      Array.isArray(skill.triggers) && skill.triggers.length ? ` Triggers: ${skill.triggers.slice(0, 5).join(', ')}.` : '',
      skill.riskLevel ? ` Risk: ${skill.riskLevel}.` : '',
    ];
    return bits.join('');
  });
  const suffix = skills.length > 80 ? `\n- ...and ${skills.length - 80} more skill(s).` : '';
  return clampText(`${lines.join('\n')}${suffix}`, maxChars);
}

function buildRealtimeContextPack(): string {
  const cfg = getConfig();
  const workspacePath = cfg.getWorkspacePath();
  const now = Date.now();
  if (
    realtimeContextPackCache
    && realtimeContextPackCache.workspacePath === workspacePath
    && now - realtimeContextPackCache.builtAt < REALTIME_CONTEXT_PACK_CACHE_TTL_MS
  ) {
    return realtimeContextPackCache.instructions;
  }
  const canonicalRuntime = buildSystemPrompt({
    workspacePath,
    promptMode: 'full',
    includeSoul: true,
    includeMemory: true,
  });
  const voiceAgentMemory = loadVoiceAgentMemory(workspacePath);

  const bridgeContract = [
    '## Realtime Authority Boundary',
    'You are Prometheus in live Realtime voice form. You may know Prometheus context deeply and speak with Prometheus identity, but you are not the executor.',
    'Treat the context below as read-only orientation. Do not claim you directly edited files, ran commands, used browser/computer tools, saved memory, or completed work unless the Prometheus worker reports it.',
    'For real work, route the user request to the Prometheus worker. The worker owns tools, skills, filesystem/browser/computer control, approvals, memory writes, and final execution decisions.',
    'You may directly handle voice-channel control: wake/silent mode, status questions, stopping current speech, and interrupts.',
    'If the user asks for a skill, memory action, file edit, coding task, browser action, app control, or anything requiring tools, package the request for Prometheus rather than performing it yourself.',
    'When speaking progress aloud, be selective: milestones, blockers, approvals, completion, and user-requested status only. Do not narrate every low-level tool call.',
  ].join('\n');

  const voicePresenceRules = [
    '## Realtime Presence Rules',
    '- Silent wake gate means: keep listening internally, suppress transcript display, suppress sendChat, and suppress voice replies until the wake phrase is heard.',
    '- If the user says "do not respond until I say X", remember X as the wake phrase for this Realtime session.',
    '- If the user asks "what are you doing?" or "status", answer from current worker/process status when available.',
    '- If the user says "stop" or "cancel that", interrupt the active worker only when the intent is cancellation; otherwise stop speaking only.',
    '- Preserve Prometheus tone: warm, direct, technically sharp, playful when natural, and deeply aligned with the user.',
  ].join('\n');

  const instructions = [
    '# Prometheus Realtime Context Pack',
    bridgeContract,
    voicePresenceRules,
    voiceAgentMemory ? '## Voice Agent Memory' : '',
    voiceAgentMemory,
    '## Canonical Prometheus Runtime Context',
    clampText(canonicalRuntime, 10000),
    '## Skill Catalog Digest',
    buildSkillCatalogDigest(),
    '## Current Project',
    `Workspace: ${workspacePath}`,
  ].filter(Boolean).join('\n\n---\n\n');
  realtimeContextPackCache = { instructions, builtAt: now, workspacePath };
  return instructions;
}

router.get('/api/realtime/status', (_req, res) => {
  const hasApiKey = !!getRealtimeApiKey();
  const hasOAuth = hasOpenAICodexOAuth();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    configured: hasApiKey || hasOAuth,
    model: sanitizeRealtimeModel(undefined),
    voice: sanitizeRealtimeVoice(undefined),
    auth: hasApiKey ? 'api_key' : (hasOAuth ? 'openai_codex_oauth' : 'none'),
    oauthConfigured: hasOAuth,
    apiKeyConfigured: hasApiKey,
  });
});

router.get('/api/realtime/context-pack', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const instructions = buildRealtimeContextPack();
    res.json({
      success: true,
      instructions,
      length: instructions.length,
      maxChars: Math.max(2000, REALTIME_INSTRUCTIONS_MAX_CHARS),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `Could not build Realtime context pack: ${err?.message || err}`,
    });
  }
});

function buildRealtimeClientSecretBody(req: express.Request): any {
  const mode = String(req.body?.mode || req.body?.type || '').trim().toLowerCase();
  if (mode === 'transcription') {
    const language = sanitizeRealtimeLanguage(req.body?.language);
    const transcription: any = {
      model: sanitizeRealtimeTranscriptionModel(req.body?.transcriptionModel),
    };
    if (language) transcription.language = language;
    return {
      session: {
        type: 'transcription',
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription,
          },
        },
      },
    };
  }

  const model = sanitizeRealtimeModel(req.body?.model);
  const voice = sanitizeRealtimeVoice(req.body?.voice);
  const speed = sanitizeRealtimeSpeed(req.body?.speed);
  const instructions = sanitizeRealtimeInstructions(req.body?.instructions);
  const body: any = {
    session: {
      type: 'realtime',
      model,
      audio: {
        output: { voice, speed },
      },
    },
  };
  if (instructions) body.session.instructions = instructions;
  return body;
}

async function createRealtimeClientSecret(req: express.Request): Promise<{ value: string; auth: RealtimeAuthCandidate['auth']; data: any; sourceToken: string }> {
  const authCandidates = await getRealtimeAuthCandidates();
  if (!authCandidates.length) {
    throw Object.assign(new Error('OpenAI Realtime requires OPENAI_REALTIME_API_KEY, OPENAI_API_KEY, VOICE_TOOLS_OPENAI_KEY, or a connected OpenAI Codex OAuth account.'), { status: 400 });
  }

  const body = buildRealtimeClientSecretBody(req);
  let lastFailure: { status: number; data: any; auth: RealtimeAuthCandidate['auth'] } | null = null;
  for (const candidate of authCandidates) {
    const upstream = await fetch(REALTIME_CLIENT_SECRETS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${candidate.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (upstream.ok) {
      const value = String(data?.client_secret?.value || data?.value || data?.client_secret || '').trim();
      if (!value) throw Object.assign(new Error('OpenAI Realtime client secret response did not include a token.'), { status: 502, details: data });
      return { value, auth: candidate.auth, data, sourceToken: candidate.token };
    }

    lastFailure = { status: upstream.status, data, auth: candidate.auth };
    const shouldTryNextAuth = upstream.status === 401 || upstream.status === 403;
    if (!shouldTryNextAuth) break;
  }

  const data = lastFailure?.data;
  throw Object.assign(new Error(data?.error?.message || data?.error || `OpenAI Realtime request failed (${lastFailure?.status || 502})`), {
    status: lastFailure?.status || 502,
    auth: lastFailure?.auth,
    details: data,
  });
}

router.post('/api/realtime/client-secret', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await createRealtimeClientSecret(req);
    const mode = String(req.body?.mode || req.body?.type || '').trim().toLowerCase();
    const resolvedModel = mode !== 'transcription' ? sanitizeRealtimeModel(req.body?.model) : '';
    res.json({ success: true, auth: result.auth, model: resolvedModel || undefined, ...result.data });
  } catch (err: any) {
    res.status(Number(err?.status || 502)).json({
      success: false,
      auth: err?.auth,
      error: err?.message || String(err),
      details: err?.details,
    });
  }
});

router.post('/api/realtime/call', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let sdp = String(req.body?.sdp || '');
  if (!sdp.endsWith('\r\n')) {
    sdp = `${sdp.replace(/\s+$/g, '')}\r\n`;
  }
  const sdpDiagnostics = {
    sdpLength: sdp.length,
    startsWithV: sdp.startsWith('v='),
    hasAudio: /\r?\nm=audio\s/i.test(sdp),
    firstLine: sdp.split(/\r?\n/, 1)[0] || '',
  };
  if (!sdpDiagnostics.startsWithV || !sdpDiagnostics.hasAudio) {
    res.status(400).json({
      success: false,
      error: `Valid Realtime SDP audio offer is required. Received ${sdp.length} bytes.`,
      ...sdpDiagnostics,
    });
    return;
  }
  try {
    const secret = await createRealtimeClientSecret(req);
    const callUrl = `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sanitizeRealtimeModel(req.body?.model))}`;
    const callRealtime = (token: string, auth?: RealtimeAuthCandidate['auth']) => fetch(callUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/sdp',
        ...(auth === 'openai_codex_oauth' ? buildCodexCloudflareHeaders(token) : {}),
      },
      body: sdp,
    });
    let upstream = await callRealtime(secret.value, secret.auth);
    const answer = await upstream.text();
    if (!upstream.ok) {
      // OpenAI occasionally returns a plain 500 when the SDP exchange uses the
      // minted client secret, especially with Codex OAuth-backed Realtime auth.
      // Retry with the source token on transient upstream failures.
      const shouldRetryWithSourceToken =
        secret.sourceToken
        && secret.sourceToken !== secret.value
        && (upstream.status === 500 || upstream.status === 502 || upstream.status === 503);
      if (shouldRetryWithSourceToken) {
        const retry = await callRealtime(secret.sourceToken, secret.auth);
        const retryAnswer = await retry.text();
        if (retry.ok) {
          console.warn('[Realtime] /api/realtime/call recovered via source auth token', {
            originalStatus: upstream.status,
            auth: secret.auth,
            ...sdpDiagnostics,
          });
          res.type('application/sdp').send(retryAnswer);
          return;
        }
        console.warn('[Realtime] /api/realtime/call source-token retry failed', {
          originalStatus: upstream.status,
          retryStatus: retry.status,
          auth: secret.auth,
          ...sdpDiagnostics,
          error: retryAnswer.slice(0, 500),
        });
      }
      console.warn('[Realtime] /api/realtime/call upstream failed', {
        status: upstream.status,
        auth: secret.auth,
        ...sdpDiagnostics,
        error: answer.slice(0, 500),
      });
      res.status(upstream.status).json({
        success: false,
        auth: secret.auth,
        error: answer || `Realtime call failed (${upstream.status})`,
        upstreamStatus: upstream.status,
        ...sdpDiagnostics,
      });
      return;
    }
    res.type('application/sdp').send(answer);
  } catch (err: any) {
    res.status(Number(err?.status || 502)).json({
      success: false,
      auth: err?.auth,
      error: err?.message || String(err),
      details: err?.details,
    });
  }
});

