// Browser mirror of src/providers/reasoning-capabilities.ts.
export function reasoningCapability(provider, model) {
  const id = String(provider || '').trim().toLowerCase();
  const raw = String(model || '').trim().toLowerCase();
  const name = raw.includes('/') ? raw.split('/').filter(Boolean).pop() : raw;
  if (id === 'openai' || id === 'openai_codex') {
    if (/^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-|$)/.test(name)) return { efforts: id === 'openai_codex' ? ['none','low','medium','high','xhigh','max','ultra'] : ['none','low','medium','high','xhigh','max'], defaultEffort: 'medium' };
    if (/^gpt-5\.5(?:-|$)/.test(name)) return { efforts: ['none','low','medium','high','xhigh'], defaultEffort: 'medium' };
    if (/^gpt-5\.(?:[234])(?:-|$)/.test(name)) return { efforts: ['none','low','medium','high','xhigh'], defaultEffort: 'none' };
    if (/^gpt-5(?:-(?:mini|nano|pro))?(?:-|$)/.test(name)) return { efforts: ['minimal','low','medium','high'], defaultEffort: 'medium' };
    if (/^o(?:1|3|4-mini)(?:-|$)/.test(name)) return { efforts: ['low','medium','high'], defaultEffort: 'medium' };
    return { efforts: [] };
  }
  if (id === 'anthropic') {
    if (!/^claude-(?:fable-5|mythos-(?:5|preview)|opus-4-(?:5|6|7|8)|sonnet-(?:5|4-6))(?:-|$)/.test(name)) {
      const manual = /^claude-(?:haiku-4-5|sonnet-4-5|opus-4-[01])(?:-|$)/.test(name);
      return { efforts: [], thinkingMode: manual ? 'manual' : undefined };
    }
    const efforts = ['low','medium','high'];
    if (/^claude-(?:fable-5|mythos-5|opus-4-(?:7|8)|sonnet-5)(?:-|$)/.test(name)) efforts.push('xhigh');
    if (!/^claude-opus-4-5(?:-|$)/.test(name)) efforts.push('max');
    return { efforts, defaultEffort: 'high', thinkingMode: /^claude-opus-4-5(?:-|$)/.test(name) ? 'manual' : 'adaptive' };
  }
  if (id === 'perplexity') return { efforts: ['low','medium','high'] };
  if (id === 'xai') return { efforts: /^grok-4\.20-multi-agent(?:-|$)/.test(name) ? ['low','medium','high','xhigh'] : ['none','low','medium','high'] };
  return { efforts: [] };
}

export function effortOptions(provider, model, includeDefault = true) {
  const efforts = reasoningCapability(provider, model).efforts;
  return includeDefault ? ['', ...efforts] : efforts.slice();
}

export function validEffort(provider, model, value) {
  const effort = String(value || '').trim().toLowerCase();
  return !effort || reasoningCapability(provider, model).efforts.includes(effort);
}

export function supportsFastSpeed(provider, model) {
  const id = String(provider || '').trim().toLowerCase();
  const raw = String(model || '').trim().toLowerCase();
  const name = raw.includes('/') ? raw.split('/').filter(Boolean).pop() : raw;
  if (id === 'anthropic') return /^claude-opus-4-(?:7|8)(?:-|$)/.test(name);
  if (id === 'openai' || id === 'openai_codex') return /^(?:gpt-5\.6(?:-(?:sol|terra|luna))?|gpt-5\.5|gpt-5\.4(?:-mini)?|gpt-5\.2|gpt-5\.1|gpt-5(?:-mini)?|gpt-4\.1(?:-mini|-nano)?|gpt-4o(?:-mini)?|o3|o4-mini)(?:-\d{4}.*|$)/.test(name);
  return false;
}
