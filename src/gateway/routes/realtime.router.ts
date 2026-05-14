import express from 'express';
import { getConfig } from '../../config/config.js';
import { getValidToken, loadTokens } from '../../auth/openai-oauth.js';
import { buildSystemPrompt, loadSkills } from '../../config/soul-loader.js';

export const router = express.Router();

const DEFAULT_REALTIME_MODEL = 'gpt-realtime';
const DEFAULT_REALTIME_VOICE = 'marin';
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
const REALTIME_CLIENT_SECRETS_ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';
const REALTIME_INSTRUCTIONS_MAX_CHARS = Number(process.env.OPENAI_REALTIME_INSTRUCTIONS_MAX_CHARS || 18000);

function getRealtimeApiKey(): string {
  return String(
    process.env.OPENAI_REALTIME_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VOICE_TOOLS_OPENAI_KEY
    || ''
  ).trim();
}

function getConfigDir(): string {
  return getConfig().getConfigDir();
}

type RealtimeAuthCandidate = {
  token: string;
  auth: 'api_key' | 'openai_codex_oauth';
};

function hasOpenAICodexOAuth(): boolean {
  return loadTokens(getConfigDir()) !== null;
}

async function getRealtimeAuthCandidates(): Promise<RealtimeAuthCandidate[]> {
  const candidates: RealtimeAuthCandidate[] = [];
  const apiKey = getRealtimeApiKey();
  if (apiKey) {
    candidates.push({ token: apiKey, auth: 'api_key' });
  }

  if (hasOpenAICodexOAuth()) {
    try {
      const token = await getValidToken(getConfigDir());
      if (token) candidates.push({ token, auth: 'openai_codex_oauth' });
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
  const canonicalRuntime = buildSystemPrompt({
    workspacePath,
    promptMode: 'full',
    includeSoul: true,
    includeMemory: true,
  });

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
    '- Preserve Prometheus tone: warm, direct, technically sharp, playful when natural, and deeply aligned with Raul.',
  ].join('\n');

  return [
    '# Prometheus Realtime Context Pack',
    bridgeContract,
    voicePresenceRules,
    '## Canonical Prometheus Runtime Context',
    clampText(canonicalRuntime, 10000),
    '## Skill Catalog Digest',
    buildSkillCatalogDigest(),
    '## Current Project',
    `Workspace: ${workspacePath}`,
  ].filter(Boolean).join('\n\n---\n\n');
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
  const instructions = sanitizeRealtimeInstructions(req.body?.instructions);
  const body: any = {
    session: {
      type: 'realtime',
      model,
      audio: {
        output: { voice },
      },
    },
  };
  if (instructions) body.session.instructions = instructions;
  return body;
}

router.post('/api/realtime/client-secret', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const authCandidates = await getRealtimeAuthCandidates();
  if (!authCandidates.length) {
    res.status(400).json({
      success: false,
      requiresApiKey: true,
      requiresOAuth: true,
      error: 'OpenAI Realtime requires OPENAI_REALTIME_API_KEY, OPENAI_API_KEY, VOICE_TOOLS_OPENAI_KEY, or a connected OpenAI Codex OAuth account.',
    });
    return;
  }

  const body = buildRealtimeClientSecretBody(req);

  try {
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
        res.json({ success: true, auth: candidate.auth, ...data });
        return;
      }

      lastFailure = { status: upstream.status, data, auth: candidate.auth };
      const shouldTryNextAuth = upstream.status === 401 || upstream.status === 403;
      if (!shouldTryNextAuth) break;
    }

    if (lastFailure) {
      const data = lastFailure.data;
      res.status(lastFailure.status).json({
        success: false,
        auth: lastFailure.auth,
        error: data?.error?.message || data?.error || `OpenAI Realtime request failed (${lastFailure.status})`,
        details: data,
      });
      return;
    }
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: `OpenAI Realtime request failed: ${err?.message || err}`,
    });
  }
});
