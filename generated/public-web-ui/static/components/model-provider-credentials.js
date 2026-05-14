import { api } from '../api.js';

let _credentialedProviderIdsCache = null;
let _credentialedProviderIdsPromise = null;

const SENSITIVE_FIELD_RE = /api[_-]?key|apikey|token|secret|password|passwd|credential/i;

function normalizeProviderIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)));
}

function hasSavedCredentialConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return Object.entries(config).some(([key, value]) => {
    if (!SENSITIVE_FIELD_RE.test(key) || typeof value !== 'string') return false;
    const trimmed = value.trim();
    return !!trimmed && trimmed !== '••••••••';
  });
}

function hasMaskedCredentialConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return Object.entries(config).some(([key, value]) => {
    if (!SENSITIVE_FIELD_RE.test(key) || typeof value !== 'string') return false;
    const trimmed = value.trim();
    return trimmed === '••••••••' || /^[•]+$/.test(trimmed);
  });
}

async function fetchCredentialedModelProviderIdsFallback() {
  const ids = new Set();
  try {
    const data = await api('/api/settings/provider');
    const providers = data?.llm?.providers && typeof data.llm.providers === 'object'
      ? data.llm.providers
      : {};
    for (const [providerId, config] of Object.entries(providers)) {
      if (hasSavedCredentialConfig(config) || hasMaskedCredentialConfig(config)) ids.add(providerId);
    }
  } catch {}

  try {
    const status = await api('/api/auth/openai/status', { timeoutMs: 3000 });
    if (status?.connected || status?.success) ids.add('openai_codex');
  } catch {}

  try {
    const status = await api('/api/auth/anthropic/status', { timeoutMs: 3000 });
    if (status?.connected || status?.success) ids.add('anthropic');
  } catch {}

  return normalizeProviderIds([...ids]);
}

export async function fetchCredentialedModelProviderIds(force = false) {
  if (_credentialedProviderIdsCache && !force) return _credentialedProviderIdsCache;
  if (!_credentialedProviderIdsPromise || force) {
    _credentialedProviderIdsPromise = api('/api/settings/credentialed-model-providers')
      .then((data) => {
        const ids = normalizeProviderIds(data?.providers);
        return ids;
      })
      .then(async (ids) => {
        const merged = normalizeProviderIds([...ids, ...await fetchCredentialedModelProviderIdsFallback()]);
        _credentialedProviderIdsCache = merged;
        return _credentialedProviderIdsCache;
      })
      .catch(async (err) => {
        console.warn('Failed to load credentialed model providers:', err);
        _credentialedProviderIdsCache = await fetchCredentialedModelProviderIdsFallback();
        return _credentialedProviderIdsCache;
      });
  }
  return _credentialedProviderIdsPromise;
}

export function getCachedCredentialedModelProviderIds() {
  return Array.isArray(_credentialedProviderIdsCache) ? _credentialedProviderIdsCache : [];
}

export function hasLoadedCredentialedModelProviderIds() {
  return Array.isArray(_credentialedProviderIdsCache);
}

export function isCredentialedModelProviderId(providerId) {
  return getCachedCredentialedModelProviderIds().includes(String(providerId || '').trim());
}

export function filterCredentialedProviderCatalogItems(items) {
  const ids = new Set(getCachedCredentialedModelProviderIds());
  if (!ids.size) return [];
  return (Array.isArray(items) ? items : []).filter(item => ids.has(String(item?.id || '')));
}
