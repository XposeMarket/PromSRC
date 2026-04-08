/**
 * Primary LLM provider + model for gateway features that previously used "secondary" orchestration.
 */

import { getConfig } from '../config/config';

export async function buildPrimaryLlm(): Promise<{ provider: any; model: string } | null> {
  const raw = getConfig().getConfig() as any;
  const providerId = String(raw.llm?.provider || 'ollama').trim();
  const model =
    String(raw.llm?.providers?.[providerId]?.model || '').trim()
    || String(raw.models?.primary || '').trim();
  if (!model) return null;
  try {
    const { buildProviderById } = await import('../providers/factory');
    return { provider: buildProviderById(providerId), model };
  } catch (err: any) {
    console.error('[llm-primary] Failed to build provider:', err.message);
    return null;
  }
}
