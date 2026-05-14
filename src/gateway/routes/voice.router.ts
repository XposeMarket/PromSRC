import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { getConfig } from '../../config/config.js';
import { loadTokens } from '../../auth/openai-oauth.js';

export const router = express.Router();

type VoiceProviderStatus = {
  id: string;
  label: string;
  configured: boolean;
  free?: boolean;
  realtime?: boolean;
  note?: string;
};

type VoiceOption = {
  id: string;
  label: string;
  provider: string;
};

const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';
const ELEVENLABS_TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5';
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const XAI_TTS_VOICE = process.env.XAI_TTS_VOICE || 'eve';
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const GROQ_TTS_VOICE = process.env.GROQ_TTS_VOICE || 'hannah';
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

const OPENAI_TTS_VOICES: VoiceOption[] = [
  { id: 'alloy', label: 'Alloy', provider: 'openai' },
  { id: 'ash', label: 'Ash', provider: 'openai' },
  { id: 'ballad', label: 'Ballad', provider: 'openai' },
  { id: 'coral', label: 'Coral', provider: 'openai' },
  { id: 'echo', label: 'Echo', provider: 'openai' },
  { id: 'fable', label: 'Fable', provider: 'openai' },
  { id: 'marin', label: 'Marin', provider: 'openai' },
  { id: 'nova', label: 'Nova', provider: 'openai' },
  { id: 'onyx', label: 'Onyx', provider: 'openai' },
  { id: 'sage', label: 'Sage', provider: 'openai' },
  { id: 'shimmer', label: 'Shimmer', provider: 'openai' },
  { id: 'verse', label: 'Verse', provider: 'openai' },
];

const OPENAI_REALTIME_VOICES: VoiceOption[] = [
  { id: 'alloy', label: 'Alloy', provider: 'openai_realtime' },
  { id: 'ash', label: 'Ash', provider: 'openai_realtime' },
  { id: 'ballad', label: 'Ballad', provider: 'openai_realtime' },
  { id: 'coral', label: 'Coral', provider: 'openai_realtime' },
  { id: 'echo', label: 'Echo', provider: 'openai_realtime' },
  { id: 'sage', label: 'Sage', provider: 'openai_realtime' },
  { id: 'shimmer', label: 'Shimmer', provider: 'openai_realtime' },
  { id: 'verse', label: 'Verse', provider: 'openai_realtime' },
  { id: 'marin', label: 'Marin', provider: 'openai_realtime' },
  { id: 'cedar', label: 'Cedar', provider: 'openai_realtime' },
];

const XAI_TTS_VOICES: VoiceOption[] = [
  { id: 'eve', label: 'Eve', provider: 'xai' },
];

function titleCaseVoiceId(value: string): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function normalizeVoiceOption(raw: any, provider: string): VoiceOption | null {
  const id = String(raw?.id || raw?.voice_id || raw?.name || raw || '').trim();
  if (!id) return null;
  const label = String(raw?.label || raw?.display_name || raw?.name || titleCaseVoiceId(id) || id).trim();
  return { id, label, provider };
}

async function listXaiVoices(): Promise<VoiceOption[]> {
  const key = apiKey('XAI_API_KEY');
  if (!key) return XAI_TTS_VOICES;
  try {
    const response = await fetch('https://api.x.ai/v1/tts/voices', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) return XAI_TTS_VOICES;
    const rawVoices =
      Array.isArray(data?.voices) ? data.voices
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data) ? data
      : [];
    const voices = rawVoices
      .map((voice: any) => normalizeVoiceOption(voice, 'xai'))
      .filter(Boolean) as VoiceOption[];
    return voices.length ? voices : XAI_TTS_VOICES;
  } catch {
    return XAI_TTS_VOICES;
  }
}

function apiKey(name: string): string {
  return String(process.env[name] || '').trim();
}

function openAiKey(): string {
  return apiKey('OPENAI_REALTIME_API_KEY') || apiKey('OPENAI_API_KEY') || apiKey('VOICE_TOOLS_OPENAI_KEY');
}

function hasOpenAICodexOAuth(): boolean {
  return loadTokens(getConfig().getConfigDir()) !== null;
}

function getStatus() {
  const openAiConfigured = !!openAiKey();
  const openAiRealtimeConfigured = openAiConfigured || hasOpenAICodexOAuth();
  const ttsProviders: VoiceProviderStatus[] = [
    { id: 'browser', label: 'Browser voice', configured: true, free: true, note: 'Free local browser speechSynthesis' },
    { id: 'windows_sapi', label: 'Windows voice', configured: process.platform === 'win32', free: true, note: 'Free local Windows SAPI voice' },
    { id: 'openai', label: 'OpenAI TTS', configured: openAiConfigured },
    { id: 'openai_realtime', label: 'OpenAI Realtime', configured: openAiRealtimeConfigured, realtime: true },
    { id: 'elevenlabs', label: 'ElevenLabs', configured: !!apiKey('ELEVENLABS_API_KEY') },
    { id: 'xai', label: 'Grok / xAI voice', configured: !!apiKey('XAI_API_KEY') },
    { id: 'groq', label: 'Groq Orpheus', configured: !!apiKey('GROQ_API_KEY'), note: 'Best for short chunks' },
  ];
  const sttProviders: VoiceProviderStatus[] = [
    { id: 'browser', label: 'Browser dictation', configured: true, free: true, realtime: true },
    { id: 'groq', label: 'Groq Whisper', configured: !!apiKey('GROQ_API_KEY') },
    { id: 'openai', label: 'OpenAI Whisper/transcribe', configured: openAiConfigured },
    { id: 'elevenlabs', label: 'ElevenLabs Scribe', configured: !!apiKey('ELEVENLABS_API_KEY') },
    { id: 'xai', label: 'Grok / xAI STT', configured: !!apiKey('XAI_API_KEY') },
  ];
  return { ttsProviders, sttProviders };
}

function safeProvider(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function safeVoiceId(value: unknown): string {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '');
}

function safeText(value: unknown, max = 6000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function audioResponse(provider: string, mimeType: string, buffer: Buffer) {
  return {
    success: true,
    provider,
    mimeType,
    audioBase64: buffer.toString('base64'),
  };
}

async function fetchBinary(url: string, init: any): Promise<{ ok: boolean; status: number; buffer: Buffer; text: string; mimeType: string }> {
  const response = await fetch(url, init);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  let text = '';
  if (!response.ok) text = buffer.toString('utf8');
  return { ok: response.ok, status: response.status, buffer, text, mimeType };
}

async function synthesizeOpenAi(text: string, voice?: string) {
  const key = openAiKey();
  if (!key) throw new Error('OpenAI API key is not configured.');
  const result = await fetchBinary('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: voice || OPENAI_TTS_VOICE,
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!result.ok) throw new Error(result.text || `OpenAI TTS failed (${result.status})`);
  return audioResponse('openai', 'audio/mpeg', result.buffer);
}

async function synthesizeElevenLabs(text: string, voiceId?: string) {
  const key = apiKey('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured.');
  const id = String(voiceId || ELEVENLABS_VOICE_ID).trim();
  const result = await fetchBinary(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_TTS_MODEL,
    }),
  });
  if (!result.ok) throw new Error(result.text || `ElevenLabs TTS failed (${result.status})`);
  return audioResponse('elevenlabs', 'audio/mpeg', result.buffer);
}

async function synthesizeXai(text: string, voiceId?: string, language?: string) {
  const key = apiKey('XAI_API_KEY');
  if (!key) throw new Error('XAI_API_KEY is not configured.');
  const result = await fetchBinary('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId || XAI_TTS_VOICE,
      language: language || process.env.XAI_TTS_LANGUAGE || 'en',
    }),
  });
  if (!result.ok) throw new Error(result.text || `xAI TTS failed (${result.status})`);
  return audioResponse('xai', result.mimeType.includes('audio/') ? result.mimeType : 'audio/mpeg', result.buffer);
}

async function synthesizeGroq(text: string, voice?: string) {
  const key = apiKey('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY is not configured.');
  if (text.length > 220) throw new Error('Groq Orpheus currently works best with short chunks. Try a shorter reply or another TTS provider.');
  const result = await fetchBinary('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_TTS_MODEL,
      input: text,
      voice: voice || GROQ_TTS_VOICE,
      response_format: 'wav',
    }),
  });
  if (!result.ok) throw new Error(result.text || `Groq TTS failed (${result.status})`);
  return audioResponse('groq', 'audio/wav', result.buffer);
}

function runPowerShell(command: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      env,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

async function synthesizeWindowsSapi(text: string, voice?: string) {
  if (process.platform !== 'win32') throw new Error('Windows SAPI voice is only available on Windows.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prom-voice-'));
  const textPath = path.join(dir, 'input.txt');
  const wavPath = path.join(dir, 'speech.wav');
  await fs.writeFile(textPath, text, 'utf8');
  try {
    await runPowerShell(
      [
        'Add-Type -AssemblyName System.Speech;',
        '$text = Get-Content -LiteralPath $env:PROM_VOICE_TEXT_FILE -Raw;',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
        'if ($env:PROM_VOICE_NAME) { try { $s.SelectVoice($env:PROM_VOICE_NAME) } catch {} }',
        '$s.SetOutputToWaveFile($env:PROM_VOICE_WAV_FILE);',
        '$s.Speak($text);',
        '$s.Dispose();',
      ].join(' '),
      {
        ...process.env,
        PROM_VOICE_TEXT_FILE: textPath,
        PROM_VOICE_WAV_FILE: wavPath,
        PROM_VOICE_NAME: String(voice || process.env.WINDOWS_TTS_VOICE || '').trim(),
      },
    );
    const buffer = await fs.readFile(wavPath);
    return audioResponse('windows_sapi', 'audio/wav', buffer);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeOpenAi(audio: Buffer, mimeType: string, filename: string, language?: string) {
  const key = openAiKey();
  if (!key) throw new Error('OpenAI API key is not configured.');
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([audio], { type: mimeType || 'audio/webm' }), filename || `speech-${randomUUID()}.webm`);
  form.append('model', OPENAI_STT_MODEL);
  if (language) form.append('language', language);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form as any,
  });
  const data: any = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `OpenAI transcription failed (${response.status})`);
  return { success: true, provider: 'openai', text: String(data?.text || '').trim(), raw: data };
}

async function transcribeGroq(audio: Buffer, mimeType: string, filename: string, language?: string) {
  const key = apiKey('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY is not configured.');
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([audio], { type: mimeType || 'audio/webm' }), filename || `speech-${randomUUID()}.webm`);
  form.append('model', GROQ_STT_MODEL);
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form as any,
  });
  const data: any = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Groq transcription failed (${response.status})`);
  return { success: true, provider: 'groq', text: String(data?.text || '').trim(), raw: data };
}

async function transcribeElevenLabs(audio: Buffer, mimeType: string, filename: string, language?: string) {
  const key = apiKey('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured.');
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([audio], { type: mimeType || 'audio/webm' }), filename || `speech-${randomUUID()}.webm`);
  form.append('model_id', ELEVENLABS_STT_MODEL);
  if (language) form.append('language_code', language);
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form as any,
  });
  const data: any = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.detail?.message || data?.message || data?.error || `ElevenLabs transcription failed (${response.status})`);
  return { success: true, provider: 'elevenlabs', text: String(data?.text || '').trim(), raw: data };
}

async function transcribeXai(audio: Buffer, mimeType: string, filename: string, language?: string) {
  const key = apiKey('XAI_API_KEY');
  if (!key) throw new Error('XAI_API_KEY is not configured.');
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([audio], { type: mimeType || 'audio/webm' }), filename || `speech-${randomUUID()}.webm`);
  if (language) form.append('language', language);
  const response = await fetch('https://api.x.ai/v1/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form as any,
  });
  const data: any = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || `xAI transcription failed (${response.status})`);
  return { success: true, provider: 'xai', text: String(data?.text || data?.transcript || '').trim(), raw: data };
}

router.get('/api/voice/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, ...getStatus() });
});

router.get('/api/voice/voices', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const provider = safeProvider(req.query?.provider || '');
  const voices =
    provider === 'openai' ? OPENAI_TTS_VOICES
    : provider === 'openai_realtime' ? OPENAI_REALTIME_VOICES
    : provider === 'xai' ? await listXaiVoices()
    : [];
  res.json({ success: true, provider, voices });
});

router.post('/api/voice/tts', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const provider = safeProvider(req.body?.provider || 'browser');
  const text = safeText(req.body?.text, provider === 'groq' ? 240 : 6000);
  if (!text) {
    res.status(400).json({ success: false, error: 'Text is required.' });
    return;
  }
  try {
    const result =
      provider === 'openai' ? await synthesizeOpenAi(text, safeVoiceId(req.body?.voice))
      : provider === 'elevenlabs' ? await synthesizeElevenLabs(text, req.body?.voiceId)
      : provider === 'xai' ? await synthesizeXai(text, safeVoiceId(req.body?.voiceId), req.body?.language)
      : provider === 'groq' ? await synthesizeGroq(text, req.body?.voice)
      : provider === 'windows_sapi' ? await synthesizeWindowsSapi(text, safeVoiceId(req.body?.voice))
      : null;
    if (!result) {
      res.status(400).json({ success: false, error: `Unsupported server TTS provider: ${provider}` });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, provider, error: err?.message || String(err) });
  }
});

router.post('/api/voice/stt', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const provider = safeProvider(req.body?.provider || 'browser');
  const audioBase64 = String(req.body?.audioBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!audioBase64) {
    res.status(400).json({ success: false, error: 'audioBase64 is required.' });
    return;
  }
  const audio = Buffer.from(audioBase64, 'base64');
  const mimeType = String(req.body?.mimeType || 'audio/webm').trim();
  const filename = String(req.body?.filename || `speech-${randomUUID()}.webm`).trim();
  const language = String(req.body?.language || '').trim();
  try {
    const result =
      provider === 'openai' ? await transcribeOpenAi(audio, mimeType, filename, language || undefined)
      : provider === 'groq' ? await transcribeGroq(audio, mimeType, filename, language || undefined)
      : provider === 'elevenlabs' ? await transcribeElevenLabs(audio, mimeType, filename, language || undefined)
      : provider === 'xai' ? await transcribeXai(audio, mimeType, filename, language || undefined)
      : null;
    if (!result) {
      res.status(400).json({ success: false, error: `Unsupported server STT provider: ${provider}` });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, provider, error: err?.message || String(err) });
  }
});
