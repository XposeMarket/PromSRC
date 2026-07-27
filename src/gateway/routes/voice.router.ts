import express from 'express';
import { randomUUID } from 'crypto';
import { getConfig } from '../../config/config.js';
import { getXaiAuthCandidates, isXaiCredentialFailure } from '../../auth/xai-account-pool.js';

export const router = express.Router();

const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'gpt-4o-transcribe';
const XAI_STT_MODEL = process.env.XAI_STT_MODEL || 'grok-stt';

function providerConfig(providerId: string): any {
  const raw = getConfig().getConfig() as any;
  const providers = raw?.llm?.providers && typeof raw.llm.providers === 'object' ? raw.llm.providers : {};
  const cfg = providers?.[providerId];
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function providerSecret(providerId: string): string {
  const value = providerConfig(providerId)?.api_key;
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('env:')) return String(process.env[trimmed.slice(4)] || '').trim();
  try { return String(getConfig().resolveSecret(trimmed) || '').trim(); } catch { return ''; }
}

function openAiKey(): string {
  return String(
    process.env.OPENAI_REALTIME_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VOICE_TOOLS_OPENAI_KEY
    || providerSecret('openai')
    || '',
  ).trim();
}

function xaiBaseUrl(): string {
  const configured = String(providerConfig('xai')?.endpoint || process.env.XAI_STT_ENDPOINT || process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').trim();
  return configured.replace(/\/+$/, '');
}

function parseAudioBody(body: any): { audio: Buffer; mimeType: string; filename: string; language?: string } {
  const encoded = String(body?.audioBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!encoded) throw new Error('audioBase64 is required.');
  const audio = Buffer.from(encoded, 'base64');
  if (!audio.length) throw new Error('Audio payload is empty.');
  return {
    audio,
    mimeType: String(body?.mimeType || 'audio/webm').trim() || 'audio/webm',
    filename: String(body?.filename || `transcription-${randomUUID()}.webm`).trim(),
    language: String(body?.language || '').trim() || undefined,
  };
}

function transcriptionForm(input: { audio: Buffer; mimeType: string; filename: string; language?: string }, model: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([input.audio], { type: input.mimeType }), input.filename);
  form.append('model', model);
  if (input.language) form.append('language', input.language);
  return form;
}

async function transcribeOpenAi(input: { audio: Buffer; mimeType: string; filename: string; language?: string }) {
  const key = openAiKey();
  if (!key) throw new Error('OpenAI transcription is not configured.');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: transcriptionForm(input, OPENAI_STT_MODEL),
  });
  const data: any = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `OpenAI transcription failed (${response.status}).`);
  return { provider: 'openai', text: String(data?.text || '').trim() };
}

async function transcribeXai(input: { audio: Buffer; mimeType: string; filename: string; language?: string }) {
  const candidates = await getXaiAuthCandidates();
  if (!candidates.length) throw new Error('xAI transcription is not configured.');
  let lastError = 'xAI transcription failed.';
  for (const candidate of candidates) {
    const response = await fetch(`${xaiBaseUrl()}/stt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${candidate.token}`, 'User-Agent': 'Prometheus/realtime-transcription' },
      body: transcriptionForm(input, XAI_STT_MODEL),
    });
    const text = await response.text().catch(() => '');
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
    if (response.ok) return { provider: 'xai', text: String(data?.text || data?.transcript || '').trim() };
    lastError = String(data?.error?.message || data?.error || data?.message || `xAI transcription failed (${response.status}).`);
    if (!isXaiCredentialFailure(response.status, text)) break;
  }
  throw new Error(lastError);
}

// The normal mic path is transcription-only. Speech playback and the legacy
// provider/voice catalogue were deliberately removed; live spoken interaction
// is handled exclusively by the OpenAI or xAI realtime transports.
router.post('/api/voice/transcribe', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const input = parseAudioBody(req.body);
    const preferred = String(req.body?.provider || 'auto').trim().toLowerCase();
    const result = preferred === 'xai'
      ? await transcribeXai(input)
      : preferred === 'openai'
        ? await transcribeOpenAi(input)
        : await transcribeOpenAi(input).catch(() => transcribeXai(input));
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(502).json({ success: false, error: String(err?.message || err) });
  }
});
