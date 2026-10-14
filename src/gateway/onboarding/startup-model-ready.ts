import { getRecord, LOCAL_ONBOARDING_USER } from './onboarding-store';
import { checkModelHealth } from './model-health';
import { getConfig } from '../../config/config';
import { detectExistingInstall } from './existing-install';

/** Never turn factory defaults into an unsolicited inference on first launch. */
export async function startupModelReady(deps: {
  connected?: () => boolean;
  healthy?: () => Promise<boolean>;
} = {}): Promise<boolean> {
  try {
    const connected = deps.connected || (() => {
      const record = getRecord(LOCAL_ONBOARDING_USER, { detectExisting: detectExistingInstall });
      const cfg: any = getConfig().getConfig();
      const provider = cfg.llm?.providers?.[cfg.llm?.provider];
      return !!record.model.firstConnectedAt
        || record.firstStart?.source === 'existing_install'
        || !!(provider?.api_key || provider?.apiKey);
    });
    if (!connected()) return false;
    return await (deps.healthy || (async () => (await checkModelHealth()).healthy))();
  } catch { return false; }
}
