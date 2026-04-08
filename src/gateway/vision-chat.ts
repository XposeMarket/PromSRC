/**
 * Primary-model vision helpers (moved out of orchestration).
 */

import { getConfig } from '../config/config';

export function primarySupportsVision(): boolean {
  try {
    const cfg = getConfig().getConfig() as any;
    const provider: string = cfg?.llm?.provider || 'ollama';
    if (provider === 'anthropic' || provider === 'openai' || provider === 'openai_codex') return true;
    // Ollama: detect vision-capable models by name
    if (provider === 'ollama') {
      const model: string = (cfg?.llm?.providers?.ollama?.model || cfg?.models?.primary || '').toLowerCase();
      return /llava|bakllava|moondream|minicpm.?v|qwen.*vl|internvl|phi.*vision|pixtral|cogvlm|granite.*vision|vision/i.test(model);
    }
    // LM Studio / llama.cpp: opt-in via config flag
    const providerCfg = cfg?.llm?.providers?.[provider] || {};
    return providerCfg.vision === true;
  } catch {
    return false;
  }
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
