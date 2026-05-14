/**
 * Primary-model vision helpers (moved out of orchestration).
 */

import { getConfig } from '../config/config';

export type ModelCapabilities = {
  provider: string;
  model: string;
  hasVision: boolean;
  source: 'model_metadata' | 'provider_flag' | 'known_model' | 'provider_default' | 'unknown';
};

type CapabilityHint = {
  providerId?: string;
  model?: string;
};

const NON_VISION_MODEL_RE = /\b(?:spark|codex-spark)\b/i;
const OLLAMA_VISION_MODEL_RE = /llava|bakllava|moondream|minicpm.?v|qwen.*vl|internvl|phi.*vision|pixtral|cogvlm|granite.*vision|vision/i;

function readConfiguredProviderAndModel(): { provider: string; model: string; providerCfg: any } {
  const cfg = getConfig().getConfig() as any;
  const provider = String(cfg?.llm?.provider || 'ollama').trim() || 'ollama';
  const providerCfg = cfg?.llm?.providers?.[provider] || {};
  const model = String(providerCfg?.model || cfg?.models?.primary || '').trim();
  return { provider, model, providerCfg };
}

function metadataHasVision(raw: any, model: string): boolean | null {
  if (!raw || typeof raw !== 'object') return null;
  const direct = raw?.[model] || raw?.models?.[model] || raw?.modelCapabilities?.[model] || raw?.capabilities?.[model];
  if (direct && typeof direct === 'object') {
    const nested = metadataHasVision(direct, model);
    if (nested != null) return nested;
  }
  const modalities = [
    raw.modalities,
    raw.input_modalities,
    raw.inputModalities,
    raw.inputs,
    raw.input,
    raw.capabilities,
  ].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
  const joined = modalities.map((value) => String(value || '').toLowerCase()).join(' ');
  if (/\b(image|vision|visual|multimodal)\b/.test(joined)) return true;
  if (raw.vision === true || raw.hasVision === true || raw.supportsVision === true) return true;
  if (raw.vision === false || raw.hasVision === false || raw.supportsVision === false) return false;
  return null;
}

export function resolvePrimaryModelCapabilities(hint?: CapabilityHint): ModelCapabilities {
  try {
    const configured = readConfiguredProviderAndModel();
    const provider = String(hint?.providerId || configured.provider || 'ollama').trim() || 'ollama';
    const cfg = getConfig().getConfig() as any;
    const providerCfg = cfg?.llm?.providers?.[provider] || configured.providerCfg || {};
    const model = String(hint?.model || providerCfg?.model || configured.model || '').trim();

    if (model && NON_VISION_MODEL_RE.test(model)) {
      return { provider, model, hasVision: false, source: 'known_model' };
    }

    const metadataVision = metadataHasVision(providerCfg, model);
    if (metadataVision != null) {
      return { provider, model, hasVision: metadataVision, source: 'model_metadata' };
    }

    if (providerCfg?.vision === true) return { provider, model, hasVision: true, source: 'provider_flag' };
    if (providerCfg?.vision === false) return { provider, model, hasVision: false, source: 'provider_flag' };

    if (provider === 'ollama') {
      return { provider, model, hasVision: OLLAMA_VISION_MODEL_RE.test(model), source: 'known_model' };
    }

    if (provider === 'anthropic' || provider === 'openai' || provider === 'openai_codex' || provider === 'gemini') {
      return { provider, model, hasVision: true, source: 'provider_default' };
    }

    return { provider, model, hasVision: false, source: 'unknown' };
  } catch {
    return { provider: 'unknown', model: '', hasVision: false, source: 'unknown' };
  }
}

export function primarySupportsVision(): boolean {
  return resolvePrimaryModelCapabilities().hasVision;
}

export function getPrimaryProvider(): string {
  try {
    const cfg = getConfig().getConfig() as any;
    return cfg?.llm?.provider || 'ollama';
  } catch {
    return 'ollama';
  }
}

export function buildVisionImagePart(base64: string, mimeType: string = 'image/png'): any {
  const provider = getPrimaryProvider();
  if (provider === 'anthropic') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: base64,
      },
    };
  }
  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${base64}`,
      detail: 'high',
    },
  };
}
