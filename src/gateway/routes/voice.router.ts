import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { getConfig } from '../../config/config.js';
import { loadTokens } from '../../auth/openai-oauth.js';
import { getValidXAIToken, isXAIConnected } from '../../auth/xai-oauth.js';

export const router = express.Router();

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const voiceAudioCache = new Map<string, { buffer: Buffer; mimeType: string; createdAt: number }>();
const VOICE_AUDIO_TTL_MS = 5 * 60 * 1000;

function pruneVoiceAudioCache() {
  const cutoff = Date.now() - VOICE_AUDIO_TTL_MS;
  for (const [id, entry] of voiceAudioCache.entries()) {
    if (!entry || entry.createdAt < cutoff) voiceAudioCache.delete(id);
  }
}

function storeVoiceAudio(mimeType: string, buffer: Buffer): string {
  pruneVoiceAudioCache();
  const id = randomUUID();
  voiceAudioCache.set(id, { buffer, mimeType, createdAt: Date.now() });
  return `/api/voice/audio/${encodeURIComponent(id)}`;
}

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
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';
const ELEVENLABS_TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5';
const ELEVENLABS_STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const XAI_BASE_URL = (process.env.XAI_TTS_ENDPOINT || process.env.XAI_STT_ENDPOINT || process.env.XAI_ENDPOINT || 'https://api.x.ai/v1').replace(/\/+$/, '');
const XAI_STT_MODEL = process.env.XAI_STT_MODEL || 'grok-stt';
const XAI_TTS_MODEL = process.env.XAI_TTS_MODEL || 'grok-2-tts';
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
  { id: 'ara', label: 'Ara', provider: 'xai' },
  { id: 'rex', label: 'Rex', provider: 'xai' },
  { id: 'sal', label: 'Sal', provider: 'xai' },
  { id: 'leo', label: 'Leo', provider: 'xai' },
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
  const key = await xaiAuthToken();
  if (!key) return XAI_TTS_VOICES;
  try {
    const response = await fetch(`${xaiBaseUrl()}/tts/voices`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0',
      },
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

function providerConfig(providerId: string): any {
  const raw = getConfig().getConfig() as any;
  const providers = raw?.llm?.providers && typeof raw.llm.providers === 'object' ? raw.llm.providers : {};
  const cfg = providers?.[providerId];
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function providerSecret(providerId: string, field = 'api_key'): string {
  const value = providerConfig(providerId)?.[field];
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('env:')) {
    return String(process.env[trimmed.slice(4)] || '').trim();
  }
  try {
    return String(getConfig().resolveSecret(trimmed) || '').trim();
  } catch {
    return '';
  }
}

function providerApiKey(providerId: string, envNames: string[]): string {
  for (const envName of envNames) {
    const key = apiKey(envName);
    if (key) return key;
  }
  return providerSecret(providerId, 'api_key');
}

function openAiKey(): string {
  return providerApiKey('openai', ['OPENAI_REALTIME_API_KEY', 'OPENAI_API_KEY', 'VOICE_TOOLS_OPENAI_KEY']);
}

function hasOpenAICodexOAuth(): boolean {
  return loadTokens(getConfig().getConfigDir()) !== null;
}

function hasXaiOAuth(): boolean {
  return isXAIConnected(getConfig().getConfigDir());
}

function looksLikeXaiApiKey(value: string): boolean {
  return /^xai-[A-Za-z0-9_-]+/.test(String(value || '').trim());
}

function xaiApiKey(): string {
  const key = providerApiKey('xai', ['XAI_API_KEY']);
  return looksLikeXaiApiKey(key) ? key : '';
}

async function xaiAuthToken(): Promise<string> {
  const key = xaiApiKey();
  if (key) return key;
  if (!hasXaiOAuth()) return '';
  return getValidXAIToken(getConfig().getConfigDir());
}

function xaiBaseUrl(): string {
  const configured = String(providerConfig('xai')?.endpoint || XAI_BASE_URL || '').trim();
  return (configured || 'https://api.x.ai/v1').replace(/\/+$/, '');
}

function groqApiKey(): string {
  return providerApiKey('groq', ['GROQ_API_KEY']);
}

function elevenLabsApiKey(): string {
  return providerApiKey('elevenlabs', ['ELEVENLABS_API_KEY']);
}

function getStatus() {
  const openAiConfigured = !!openAiKey();
  const openAiRealtimeConfigured = openAiConfigured || hasOpenAICodexOAuth();
  const xaiConfigured = !!xaiApiKey() || hasXaiOAuth();
  const xaiNote = xaiConfigured
    ? (hasXaiOAuth() && !xaiApiKey() ? 'Connected with xAI OAuth' : undefined)
    : undefined;
  const groqConfigured = !!groqApiKey();
  const elevenLabsConfigured = !!elevenLabsApiKey();
  const ttsProviders: VoiceProviderStatus[] = [
    { id: 'browser', label: 'Browser voice', configured: true, free: true, note: 'Free local browser speechSynthesis' },
    { id: 'windows_sapi', label: 'Windows voice', configured: process.platform === 'win32', free: true, note: 'Free local Windows SAPI voice' },
    { id: 'openai', label: 'OpenAI TTS', configured: openAiConfigured },
    { id: 'openai_realtime', label: 'OpenAI Realtime', configured: openAiRealtimeConfigured, realtime: true },
    { id: 'elevenlabs', label: 'ElevenLabs', configured: elevenLabsConfigured },
    { id: 'xai', label: 'Grok / xAI voice', configured: xaiConfigured, note: xaiNote },
    { id: 'groq', label: 'Groq Orpheus', configured: groqConfigured, note: 'Best for short chunks' },
  ];
  const sttProviders: VoiceProviderStatus[] = [
    { id: 'browser', label: 'Browser dictation', configured: true, free: true, realtime: true },
    { id: 'groq', label: 'Groq Whisper', configured: groqConfigured },
    { id: 'openai', label: 'OpenAI Whisper/transcribe', configured: openAiConfigured },
    { id: 'elevenlabs', label: 'ElevenLabs Scribe', configured: elevenLabsConfigured },
    { id: 'xai', label: 'Grok / xAI STT', configured: xaiConfigured, realtime: true, note: xaiNote },
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

function isIosSafariUserAgent(userAgent: string): boolean {
  const ua = String(userAgent || '');
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua);
  return isIOS || isSafari;
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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = String(ffmpegInstaller?.path || process.env.FFMPEG_PATH || 'ffmpeg');
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function transcodeAudioToWav(buffer: Buffer, inputExt = 'mp3'): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prom-voice-transcode-'));
  const inputPath = path.join(dir, `input.${inputExt.replace(/[^a-z0-9]/gi, '') || 'audio'}`);
  const outputPath = path.join(dir, 'output.wav');
  try {
    await fs.writeFile(inputPath, buffer);
    await runFfmpeg([
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '24000',
      '-sample_fmt', 's16',
      '-f', 'wav',
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
  const key = elevenLabsApiKey();
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

async function synthesizeXai(text: string, voiceId?: string, language?: string, speed?: unknown) {
  const key = await xaiAuthToken();
  if (!key) throw new Error('xAI speech is not configured. Connect xAI OAuth or add an xAI API key in Settings -> Models.');
  const normalizedSpeed = Number(speed);
  const voice = voiceId || XAI_TTS_VOICE;
  // Match Hermes-Agent's exact wire format: POST /v1/tts with { text, voice_id, language }.
  // xAI gates TTS by User-Agent allow-list, so we send the Hermes-Agent UA — Prometheus's
  // xAI OAuth flow is forked from Hermes and shares the same allow-list entry.
  const body: Record<string, unknown> = {
    text,
    voice_id: voice,
    language: language || process.env.XAI_TTS_LANGUAGE || 'en',
  };
  if (Number.isFinite(normalizedSpeed)) body.speed = Math.max(0.7, Math.min(1.5, normalizedSpeed));
  const url = `${xaiBaseUrl()}/tts`;
  const userAgent = process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0';
  const result = await fetchBinary(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(body),
  });
  const logLine = `[${new Date().toISOString()}] [voice] xAI TTS ${url} model=${XAI_TTS_MODEL} voice=${voice} status=${result.status} bytes=${result.buffer.length} mime=${result.mimeType}${!result.ok ? ` body=${(result.text || '').slice(0, 800).replace(/\n/g, ' ')}` : ''}\n`;
  console.log(logLine.trim());
  try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', logLine); } catch {}
  if (!result.ok) throw new Error(result.text || `xAI TTS failed (${result.status})`);
  if (!result.buffer.length) throw new Error('xAI TTS returned empty audio.');
  // Mobile Safari + Chromium both decode MP3 natively. The legacy WAV transcode
  // step was producing zero-length / malformed WAVs on some setups, causing the
  // orb to flash for a split second and audio to play nothing. Only transcode
  // when explicitly opted-in via XAI_TTS_FORCE_WAV=1.
  if (process.env.XAI_TTS_FORCE_WAV === '1') {
    try {
      const wav = await transcodeAudioToWav(result.buffer, result.mimeType.includes('wav') ? 'wav' : 'mp3');
      const outLine = `[${new Date().toISOString()}] [voice] xAI TTS transcoded to wav bytes=${wav.length}\n`;
      try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', outLine); } catch {}
      return audioResponse('xai', 'audio/wav', wav);
    } catch (err) {
      console.warn('[voice] xAI TTS wav transcode failed; returning raw audio', err);
      try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI TTS wav transcode FAILED: ${(err as any)?.message || err}\n`); } catch {}
    }
  }
  const finalMime = result.mimeType.includes('audio/') ? result.mimeType : 'audio/mpeg';
  try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI TTS delivering RAW mime=${finalMime} bytes=${result.buffer.length}\n`); } catch {}
  return audioResponse('xai', finalMime, result.buffer);
}

async function synthesizeGroq(text: string, voice?: string) {
  const key = groqApiKey();
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
  const key = groqApiKey();
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
  const key = elevenLabsApiKey();
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
  const key = await xaiAuthToken();
  if (!key) throw new Error('xAI speech is not configured. Connect xAI OAuth or add an xAI API key in Settings -> Models.');
  let uploadAudio = audio;
  let uploadMimeType = mimeType || 'audio/webm';
  let uploadFilename = filename || `speech-${randomUUID()}.webm`;
  const xaiRejectsContainer = /webm|ogg/i.test(`${uploadMimeType} ${uploadFilename}`);
  if (xaiRejectsContainer && audio.length) {
    try {
      const wav = await transcodeAudioToWav(audio, uploadMimeType.includes('ogg') ? 'ogg' : 'webm');
      uploadAudio = wav;
      uploadMimeType = 'audio/wav';
      uploadFilename = uploadFilename.replace(/\.[^.]+$/, '') + '.wav';
      try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI STT transcoded ${mimeType || 'unknown'} -> wav bytes=${wav.length}\n`); } catch {}
    } catch (err) {
      try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI STT transcode failed: ${(err as any)?.message || err}\n`); } catch {}
    }
  }
  const form = new (globalThis as any).FormData();
  form.append('file', new (globalThis as any).Blob([uploadAudio], { type: uploadMimeType }), uploadFilename);
  form.append('model', XAI_STT_MODEL);
  if (language) form.append('language', language);
  const response = await fetch(`${xaiBaseUrl()}/stt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Hermes-Agent/0.14.0',
    },
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

router.get('/api/voice/audio/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  pruneVoiceAudioCache();
  const id = String(req.params?.id || '').trim();
  const entry = voiceAudioCache.get(id);
  if (!entry) {
    res.status(404).json({ success: false, error: 'Voice audio expired.' });
    return;
  }
  const total = entry.buffer.length;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', entry.mimeType || 'audio/wav');
  const range = String(req.headers.range || '');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        res.send(entry.buffer.subarray(start, end + 1));
        return;
      }
    }
    res.status(416).setHeader('Content-Range', `bytes */${total}`);
    res.end();
    return;
  }
  res.setHeader('Content-Length', String(total));
  res.send(entry.buffer);
});

router.post('/api/voice/tts', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const provider = safeProvider(req.body?.provider || 'browser');
  const requestUserAgent = String(req.headers['user-agent'] || '');
  try {
    const ua = requestUserAgent.slice(0, 160);
    const hitLine = `[${new Date().toISOString()}] [voice] /api/voice/tts hit provider=${provider} voiceId=${req.body?.voiceId || req.body?.voice || ''} delivery=${req.body?.delivery || ''} textLen=${String(req.body?.text || '').length} ua="${ua}"\n`;
    console.log(hitLine.trim());
    await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', hitLine);
  } catch {}
  const text = safeText(req.body?.text, provider === 'groq' ? 240 : 6000);
  if (!text) {
    res.status(400).json({ success: false, error: 'Text is required.' });
    return;
  }
  try {
    const result =
      provider === 'openai' ? await synthesizeOpenAi(text, safeVoiceId(req.body?.voice))
      : provider === 'elevenlabs' ? await synthesizeElevenLabs(text, req.body?.voiceId)
      : provider === 'xai' ? await synthesizeXai(text, safeVoiceId(req.body?.voiceId), req.body?.language, req.body?.speed)
      : provider === 'groq' ? await synthesizeGroq(text, req.body?.voice)
      : provider === 'windows_sapi' ? await synthesizeWindowsSapi(text, safeVoiceId(req.body?.voice))
      : null;
    if (!result) {
      res.status(400).json({ success: false, error: `Unsupported server TTS provider: ${provider}` });
      return;
    }
    if (provider === 'xai' && String(req.body?.delivery || '').trim().toLowerCase() !== 'url' && isIosSafariUserAgent(requestUserAgent)) {
      const audioBuffer = Buffer.from(String((result as any).audioBase64 || ''), 'base64');
      if (audioBuffer.length && !String((result as any).mimeType || '').toLowerCase().includes('wav')) {
        try {
          const wav = await transcodeAudioToWav(audioBuffer, String((result as any).mimeType || '').includes('mpeg') ? 'mp3' : 'audio');
          try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI iOS/Safari base64 fallback transcoded wav bytes=${wav.length}\n`); } catch {}
          res.json(audioResponse('xai', 'audio/wav', wav));
          return;
        } catch (err) {
          try { await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] xAI iOS/Safari base64 wav fallback failed: ${(err as any)?.message || err}\n`); } catch {}
        }
      }
    }
    if (String(req.body?.delivery || '').trim().toLowerCase() === 'url') {
      const audioBuffer = Buffer.from(String((result as any).audioBase64 || ''), 'base64');
      const audioUrl = audioBuffer.length ? storeVoiceAudio((result as any).mimeType || 'audio/wav', audioBuffer) : '';
      res.json({ ...(result as any), audioBase64: undefined, audioUrl });
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
    await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] /api/voice/stt provider=${provider} mime=${mimeType} filename=${filename} bytes=${audio.length}\n`);
  } catch {}
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
    try {
      await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] /api/voice/stt ok provider=${provider} textLen=${String((result as any)?.text || '').length}\n`);
    } catch {}
    res.json(result);
  } catch (err: any) {
    try {
      await fs.appendFile('D:\\Prometheus\\voice-xai-debug.log', `[${new Date().toISOString()}] [voice] /api/voice/stt error provider=${provider} message=${String(err?.message || err).slice(0, 500)}\n`);
    } catch {}
    res.status(502).json({ success: false, provider, error: err?.message || String(err) });
  }
});
