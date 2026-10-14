

export const shouldUseLeanWriteNoteSwitchTools = (generationOverride: any): boolean => {
    if (generationOverride?.source !== 'turn_override') return false;
    if (String(generationOverride?.tier || '').trim().toLowerCase() !== 'low') return false;
    const reason = String(generationOverride?.reason || '').trim().toLowerCase();
    if (!/(^|[^a-z])write[_\s-]?note([^a-z]|$)|(^|[^a-z])note([^a-z]|$)|remember|memory/.test(reason)) return false;
    if (/(command|shell|terminal|browser|desktop|file|search|lookup|read|analy[sz]e|creative|video|export|deliver)/.test(reason)) return false;
    return true;
  };

export const providerToolLimit = (providerId: string): number | null => {
    const provider = String(providerId || '').trim().toLowerCase();
    if (provider === 'xai') return 200;
    return null;
  };

export const parseSupervisionControlPayload = (toolResult: any): any | null => {
    if (!toolResult || toolResult.error) return null;
    try {
      const parsed = typeof toolResult.result === 'string' ? JSON.parse(toolResult.result) : toolResult.result;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

export const supervisionTerminalStatus = (payload: any): boolean => {
    const status = String(payload?.supervision?.status || '').trim().toLowerCase();
    return ['complete', 'blocked', 'failed', 'cancelled'].includes(status);
  };

