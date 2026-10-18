import { getConfig } from '../../config/config';
import { getVault } from '../../security/vault';
import { getConfiguredXaiCredentialSummary } from '../../auth/xai-account-pool';
import { isConnected as hasOpenAICodexOAuth } from '../../auth/openai-oauth';
// Static fallback mirrors XAI_REALTIME_VOICE_IDS; never load routes or fetch voices in status.
const XAI_REALTIME_VOICE_IDS = ['carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith', 'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa', 'sirius', 'lumen', 'castor', 'naksh', 'atlas', 'eve', 'ara', 'rex', 'sal', 'leo'];

export type VoiceProviderId = 'openai' | 'xai' | `custom:${string}`;
export type VoiceProviderConfig = {
  id: VoiceProviderId;
  kind?: 'openai_realtime_compatible';
  label?: string;
  baseUrl: string;
  model?: string;
  voices?: string[];
  apiKeyRef?: string;
};

export type ResolvedCustomVoiceProvider = {
  id: VoiceProviderId;
  label: string;
  baseUrl: string;
  model: string;
  voices: string[];
  apiKey: string;
  apiKeyRef: string;
  kind: 'openai_realtime_compatible';
};

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const CUSTOM_ID_RE = /^custom:([a-z0-9][a-z0-9-]{0,63})$/;

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(value: unknown, max = 240): string {
  return String(value || '').trim().slice(0, max);
}

function customId(value: unknown): VoiceProviderId | null {
  const match = CUSTOM_ID_RE.exec(text(value, 80));
  return match ? `custom:${match[1]}` : null;
}

export function isSafeVoiceProviderBaseUrl(value: unknown): boolean {
  const raw = text(value, 2048);
  if (!raw || /[\s\\]/.test(raw)) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host) || host === '::1') return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b, c, d] = ipv4.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function normalizedBaseUrl(value: unknown): string {
  const url = new URL(text(value, 2048));
  return url.toString().replace(/\/$/, '');
}

function openAiCredentialSummary(config: any): { configured: boolean; authSource?: string } {
  const provider = record(config?.llm?.providers?.openai);
  const stored = text(provider.api_key, 500);
  const resolved = text(getConfig().resolveSecret(stored) || process.env.OPENAI_REALTIME_API_KEY || process.env.OPENAI_API_KEY || process.env.VOICE_TOOLS_OPENAI_KEY, 500);
  if (resolved) return { configured: true, authSource: stored.startsWith('env:') ? 'env' : stored.startsWith('vault:') ? 'vault' : 'api_key' };
  try {
    if (hasOpenAICodexOAuth(getConfig().getConfigDir())) return { configured: true, authSource: 'oauth' };
  } catch {}
  return { configured: false };
}

export function getVoiceProviderRegistry(config: any = getConfig().getConfig()): { providers: any[]; catalog: any[]; defaults: { provider: VoiceProviderId; model: string; voice: string; listenMode: string } } {
  const voice = record(config?.voice);
  const defaults = record(voice.defaults);
  const legacy = record(voice.agent);
  const openai = openAiCredentialSummary(config);
  const xai = getConfiguredXaiCredentialSummary();
  const custom = record(voice.providers);
  const providers = [
    {
      id: 'openai', label: 'OpenAI Realtime', protocol: 'openai_realtime', builtIn: true, connected: openai.configured,
      models: [{ id: 'gpt-realtime-2', label: 'GPT Realtime 2' }], voices: OPENAI_VOICES, defaultModel: 'gpt-realtime-2', defaultVoice: 'marin',
      authSource: 'chat:openai', connectionLabel: openai.configured ? `OpenAI (${openai.authSource})` : 'OpenAI not connected',
    },
    {
      id: 'xai', label: 'xAI Voice', protocol: 'xai_realtime', builtIn: true, connected: xai.configured,
      models: [{ id: process.env.XAI_REALTIME_MODEL || 'grok-voice-latest', label: 'Grok Voice' }], voices: XAI_REALTIME_VOICE_IDS, defaultModel: process.env.XAI_REALTIME_MODEL || 'grok-voice-latest', defaultVoice: process.env.XAI_REALTIME_VOICE || 'eve',
      authSource: 'chat:xai', connectionLabel: xai.configured ? `xAI (${xai.oauthConfigured ? 'OAuth' : 'API key'})` : 'xAI not connected',
    },
    ...Object.entries(custom).flatMap(([key, candidate]) => {
      const item = record(candidate);
      const id = customId(key);
      const apiKeyRef = text(item.apiKeyRef, 160);
      const connected = apiKeyRef.startsWith('vault:') && getVault().has(apiKeyRef.slice(6));
      if (!id || item.enabled === false || !isSafeVoiceProviderBaseUrl(item.baseUrl) || !apiKeyRef) return [];
      const model = text(item.model, 160) || 'gpt-realtime-2';
      const voices = Array.isArray(item.voices) ? item.voices.map((v: unknown) => text(v, 80)).filter(Boolean).slice(0, 40) : [];
      return [{ id, label: text(item.label, 120) || id.slice(7), protocol: 'openai_realtime_compatible', builtIn: false, connected, models: [{ id: model, label: model }], voices, defaultModel: model, defaultVoice: voices[0] || '', authSource: 'voice_key', connectionLabel: connected ? 'Custom OpenAI-compatible realtime' : 'Custom voice key unavailable' }];
    }),
  ];
  let provider = text(defaults.provider || defaults.providerId || legacy.provider, 80);
  if (provider === 'openai_realtime' || provider === 'openai_codex') provider = 'openai';
  if (!providers.some((candidate) => candidate.id === provider && candidate.connected)) provider = (providers.find((candidate) => candidate.id === 'openai' && candidate.connected)?.id || providers.find((candidate) => candidate.id === 'xai' && candidate.connected)?.id || providers.find((candidate) => !candidate.builtIn && candidate.connected)?.id || 'openai') as VoiceProviderId;
  const selected = providers.find((candidate) => candidate.id === provider) || providers[0];
  return { providers, catalog: [
    { id: 'elevenlabs', label: 'ElevenLabs', available: false, adapter: 'unavailable', reason: 'adapter not implemented yet' },
    { id: 'gemini', label: 'Google Gemini Live', available: false, adapter: 'unavailable', reason: 'adapter not implemented yet' },
  ], defaults: { provider: provider as VoiceProviderId, model: selected.models.some((model: any) => model.id === defaults.model) ? defaults.model : selected.defaultModel, voice: selected.voices.includes(text(defaults.voice || legacy.voice, 80)) ? text(defaults.voice || legacy.voice, 80) : selected.defaultVoice, listenMode: defaults.listenMode === 'always_listening' ? 'always_listening' : 'push_to_talk' } };
}

/** Resolve a configured custom provider for a realtime relay. Signature: getCustomVoiceProvider(config: unknown, id: string): Promise<ResolvedCustomVoiceProvider | null>. */
export async function getCustomVoiceProvider(config: unknown, id: string): Promise<ResolvedCustomVoiceProvider | null> {
  const providerId = customId(id);
  if (!providerId) return null;
  const item = record(record(record(record(config).voice).providers)[providerId]);
  if (item.enabled === false || !isSafeVoiceProviderBaseUrl(item.baseUrl)) return null;
  const apiKeyRef = text(item.apiKeyRef, 160);
  if (!apiKeyRef.startsWith('vault:')) return null;
  const apiKey = getVault().get(apiKeyRef.slice(6), 'voice:custom-provider')?.expose() || '';
  if (!apiKey) return null;
  return { id: providerId, label: text(item.label, 120) || providerId.slice(7), baseUrl: normalizedBaseUrl(item.baseUrl), model: text(item.model, 160) || 'gpt-4o-realtime-preview', voices: Array.isArray(item.voices) ? item.voices.map((v: unknown) => text(v, 80)).filter(Boolean).slice(0, 40) : [], apiKey, apiKeyRef, kind: 'openai_realtime_compatible' };
}

export function normalizeCustomVoiceProvider(input: unknown): { id: VoiceProviderId; value: VoiceProviderConfig; apiKey?: string } {
  const body = record(input);
  const slug = text(body.slug || String(body.id || '').replace(/^custom:/, '') || text(body.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 64).toLowerCase();
  const id = customId(`custom:${slug}`);
  if (!id) throw new Error('slug must use lowercase letters, numbers, and hyphens');
  if (!isSafeVoiceProviderBaseUrl(body.baseUrl)) throw new Error('baseUrl must be HTTPS, localhost HTTP, or private-LAN HTTP');
  const apiKey = text(body.apiKey, 2048);
  const apiKeyRef = text(body.apiKeyRef, 160);
  if (!apiKey && !apiKeyRef) throw new Error('apiKey is required when creating a provider');
  return { id, apiKey, value: { id, kind: 'openai_realtime_compatible', label: text(body.label, 120) || slug, baseUrl: normalizedBaseUrl(body.baseUrl), model: text(body.model, 160) || 'gpt-4o-realtime-preview', voices: Array.isArray(body.voices) ? body.voices.map((voice: unknown) => text(voice, 80)).filter(Boolean).slice(0, 40) : [], apiKeyRef } };
}
