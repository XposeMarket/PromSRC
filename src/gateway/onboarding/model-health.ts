// Reports whether the user has at least one working model brain configured.
// Reuses the canonical provider.testConnection() so onboarding stays in lockstep
// with the rest of the gateway.

import { getProvider } from '../../providers/factory';
import { getConfig } from '../../config/config';

export interface ModelHealth {
  healthy: boolean;
  provider: string | null;
  model: string | null;
  reason?: string;
}

export async function checkModelHealth(timeoutMs = 6000): Promise<ModelHealth> {
  let provider: string | null = null;
  let model: string | null = null;
  try {
    const cfg: any = getConfig().getConfig();
    provider = cfg?.llm?.provider || null;
    if (provider) model = cfg?.llm?.providers?.[provider]?.model || null;
  } catch (e: any) {
    return { healthy: false, provider: null, model: null, reason: 'config_unreadable: ' + (e?.message || e) };
  }

  if (!provider) return { healthy: false, provider: null, model: null, reason: 'no_provider_configured' };

  try {
    const llm = getProvider();
    const ok = await Promise.race<boolean>([
      llm.testConnection().catch(() => false),
      new Promise<boolean>(res => setTimeout(() => res(false), timeoutMs)),
    ]);
    return { healthy: !!ok, provider, model, reason: ok ? undefined : 'test_connection_failed' };
  } catch (e: any) {
    return { healthy: false, provider, model, reason: 'test_connection_error: ' + (e?.message || e) };
  }
}
