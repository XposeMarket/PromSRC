import { Router } from 'express';
import { getConfig } from '../../config/config';
import { getVault } from '../../security/vault';
import { getVoiceProviderRegistry, normalizeCustomVoiceProvider } from '../voice/voice-provider-registry';

export const router = Router();

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

router.get('/api/voice/providers', (_req, res) => {
  try { res.json(getVoiceProviderRegistry(getConfig().getConfig())); }
  catch (error: any) { res.status(500).json({ error: error?.message || 'Unable to list voice providers' }); }
});

router.put('/api/voice/defaults', (req, res) => {
  try {
    const manager = getConfig();
    const current = manager.getConfig() as any;
    const registry = getVoiceProviderRegistry(current);
    const body = record(req.body);
    const providerId = String(body.provider || body.providerId || '').trim();
    const provider = registry.providers.find((candidate) => candidate.id === providerId && candidate.connected);
    if (!provider) { res.status(400).json({ error: 'provider must identify a connected voice provider' }); return; }
    const model = body.model === undefined ? provider.defaultModel : String(body.model).trim().slice(0, 160);
    if (!provider.models.some((candidate: any) => candidate.id === model)) { res.status(400).json({ error: 'model is not offered by the selected provider' }); return; }
    const voice = body.voice === undefined || body.voice === null ? provider.defaultVoice : String(body.voice).trim().slice(0, 80);
    if (voice && !provider.voices.includes(voice)) { res.status(400).json({ error: 'voice is not offered by the selected provider' }); return; }
    const listenMode = body.listenMode === undefined ? registry.defaults.listenMode : String(body.listenMode).trim().slice(0, 40);
    if (!['push_to_talk', 'always_listening'].includes(listenMode)) { res.status(400).json({ error: 'listenMode must be push_to_talk or always_listening' }); return; }
    manager.updateConfig({ voice: { ...record(current.voice), defaults: { provider: providerId, model, voice, listenMode } } } as any);
    res.json(getVoiceProviderRegistry(manager.getConfig()));
  } catch (error: any) { res.status(400).json({ error: error?.message || 'Unable to save voice defaults' }); }
});

router.post('/api/voice/providers/custom', (req, res) => {
  try {
    const manager = getConfig();
    const current = manager.getConfig() as any;
    const incoming = record(req.body);
    const requestedId = `custom:${String(incoming.slug || incoming.id || String(incoming.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).trim().replace(/^custom:/, '').toLowerCase()}`;
    const existing = record(record(current.voice).providers)[requestedId];
    const normalized = normalizeCustomVoiceProvider({ ...incoming, apiKeyRef: existing?.apiKeyRef });
    const vaultKey = `voice.providers.${normalized.id.slice(7)}.apiKey`;
    const apiKeyRef = normalized.apiKey ? `vault:${vaultKey}` : String(normalized.value.apiKeyRef);
    if (normalized.apiKey) getVault().set(vaultKey, normalized.apiKey, 'voice:custom-provider');
    if (!apiKeyRef.startsWith('vault:')) throw new Error('apiKeyRef must be a vault reference');
    const providers = { ...record(record(current.voice).providers), [normalized.id]: { ...normalized.value, apiKeyRef } };
    manager.updateConfig({ voice: { ...record(current.voice), providers } } as any);
    res.status(existing ? 200 : 201).json({ provider: getVoiceProviderRegistry(manager.getConfig()).providers.find((provider) => provider.id === normalized.id) });
  } catch (error: any) { res.status(400).json({ error: error?.message || 'Unable to save custom voice provider' }); }
});

router.delete('/api/voice/providers/custom/:id', (req, res) => {
  try {
    const id = `custom:${String(req.params.id || '').trim().replace(/^custom:/, '')}`;
    const manager = getConfig();
    const current = manager.getConfig() as any;
    const providers = { ...record(record(current.voice).providers) };
    const existing = record(providers[id]);
    if (!Object.keys(existing).length) { res.status(404).json({ error: 'Custom voice provider not found' }); return; }
    const ref = String(existing.apiKeyRef || '');
    if (ref.startsWith('vault:')) getVault().delete(ref.slice(6), 'voice:custom-provider');
    delete providers[id];
    // updateConfig deep-merges records, so remove from the live record first.
    if (current.voice?.providers) delete current.voice.providers[id];
    manager.updateConfig({ voice: { ...record(current.voice), providers } } as any);
    res.json({ success: true, id });
  } catch (error: any) { res.status(400).json({ error: error?.message || 'Unable to delete custom voice provider' }); }
});
