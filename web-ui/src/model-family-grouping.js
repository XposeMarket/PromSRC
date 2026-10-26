// Pure taxonomy shared by the existing desktop and mobile chat pickers.
function numericParts(value) { return (String(value).match(/\d+/g) || []).map(Number); }
function newest(a, b) {
  const av = numericParts(a); const bv = numericParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const difference = (bv[i] || 0) - (av[i] || 0);
    if (difference) return difference;
  }
  return String(a).localeCompare(String(b));
}
export function groupModelsByFamily(provider, models, currentModel = '') {
  const ids = [...new Set([...models, currentModel].map((m) => String(m || '').trim()).filter(Boolean))];
  const groups = new Map();
  for (const model of ids) {
    let key = 'other'; let label = 'Additional models';
    if (provider === 'openai' || provider === 'openai_codex') {
      const version = model.match(/^gpt-(\d+(?:\.\d+)*)(?:-|$)/i)?.[1];
      if (/astra/i.test(model)) { key = 'astra'; label = 'Astra'; }
      else if (/^chatgpt/i.test(model)) { key = 'chatgpt'; label = 'ChatGPT'; }
      else if (version) { key = `gpt-${version}`; label = `GPT ${version}`; }
    } else if (provider === 'anthropic') {
      const family = model.match(/(?:^|-)(opus|sonnet|haiku|fable)(?:-|$)/i)?.[1]?.toLowerCase();
      if (family) { key = family; label = family[0].toUpperCase() + family.slice(1); }
    } else { key = 'models'; label = 'Models'; }
    if (!groups.has(key)) groups.set(key, { key, label, models: [] });
    groups.get(key).models.push(model);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'other' || b.key === 'other') return a.key === b.key ? 0 : a.key === 'other' ? 1 : -1;
    const an = a.key.startsWith('gpt-'); const bn = b.key.startsWith('gpt-');
    if (an && bn) return newest(a.key, b.key);
    if (an !== bn) return an ? -1 : 1;
    return a.label.localeCompare(b.label);
  }).map((group) => ({ ...group, models: group.models.sort(newest) }));
}
