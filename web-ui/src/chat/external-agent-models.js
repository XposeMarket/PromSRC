// Model + reasoning state for a chat run by a connected agent (Codex, Claude
// Code, ...). The ORIGINAL desktop switcher and mobile reasoning sheet render
// it; this module only supplies the harness's own models and effort levels.
import { agentName } from './external-agent-ui.js';
import { setAgentPlaceholder } from './external-agent-placeholder.js';
import { groupModelsByFamily } from '../model-family-grouping.js';
let context = null;
let revision = 0;
let catalog = null;
let loading = null;
let selected = '';
let selectedEffort = '';
const PROVIDER_FOR_AGENT = { codex: 'openai_codex', 'claude-code': 'anthropic' };
export function setAgentModelContext(value) {
  setAgentPlaceholder(value?.id || '');
  const key = value ? `${value.id}|${value.sessionId || ''}|${value.cwd || ''}` : '';
  if (key === (context?.key || '')) { if (value?.currentModel && catalog && !selected) catalog.currentModel = value.currentModel; return; }
  revision++; context = value ? { ...value, key } : null; catalog = null; loading = null;
  selected = value?.selectedModel || ''; selectedEffort = value?.selectedEffort || '';
  window.dispatchEvent(new Event('external-agent-model-context'));
}
export function hasAgentModelContext() { return !!context; }
export function agentModelForSend() { return selected || undefined; }
export function agentEffortForSend() { return selectedEffort || undefined; }
export async function loadAgentModelCatalog(request) {
  if (!context) return null;
  if (catalog) return catalog;
  if (loading) return loading;
  const current = context; const stamp = revision;
  loading = (async () => {
    try {
      const query = new URLSearchParams({ cwd: current.cwd || '', ...(current.sessionId ? { sessionId: current.sessionId } : {}) });
      const data = await request(`/api/external-agents/${encodeURIComponent(current.id)}/models?${query}`);
      if (stamp !== revision) return null;
      if (data?.success === false) throw new Error(data.error);
      catalog = { ...data, currentModel: selected || data.currentModel || current.currentModel || data.models?.[0]?.id || '' };
      return catalog;
    } finally { if (stamp === revision) loading = null; }
  })();
  return loading;
}
/** Harness labels in Prometheus's own style: "GPT-6.1-Sol" -> "GPT-6.1 Sol", "Default (recommended)" -> "Default". */
export function cleanAgentModelLabel(label, id = '') {
  const text = String(label || id || '').replace(/\s*\((?:recommended|default)\)\s*/ig, ' ').trim();
  return text.replace(/^(GPT-\d+(?:\.\d+)*)-(?=[A-Za-z])/i, '$1 ').replace(/\s+/g, ' ') || String(id || 'Model');
}
function stateFrom(data) {
  if (!context || !data) return null;
  const models = (Array.isArray(data.models) ? data.models : []).map((item) => ({ ...item, label: cleanAgentModelLabel(item.label, item.id) }));
  const model = selected || data.currentModel || '';
  const entry = models.find((item) => item.id === model);
  const efforts = Array.isArray(entry?.efforts) ? entry.efforts.filter(Boolean) : [];
  const fallback = entry?.defaultEffort || (efforts.includes('medium') ? 'medium' : efforts[0] || '');
  return {
    agentId: context.id,
    agentName: agentName(context.id),
    provider: PROVIDER_FOR_AGENT[context.id] || 'openai_codex',
    // Family grouping only for harnesses whose model names follow a known provider's scheme.
    groupProvider: PROVIDER_FOR_AGENT[context.id] || '',
    model,
    label: entry?.label || cleanAgentModelLabel(model, model) || 'Model',
    models,
    efforts,
    effort: efforts.includes(selectedEffort) ? selectedEffort : fallback,
    unavailableReason: models.length ? '' : (context.id === 'openai-dots' ? 'OpenAI picks the model for your dot.' : (data.unavailableReason || `${agentName(context.id)} has not reported model choices.`)),
  };
}
/**
 * The harness's models in the same families as the Prometheus picker (Astra, GPT 6.1, Opus, ...).
 * `top` holds a harness "Default" entry shown above the families. `groups` is empty when the
 * list is too small or unknown to group, so callers show one flat list.
 */
export function agentModelGroups(state) {
  const models = Array.isArray(state?.models) ? state.models : [];
  const top = models.filter((m) => /^default$/i.test(String(m.id)));
  const rest = models.filter((m) => !top.includes(m));
  if (!state?.groupProvider || rest.length < 2) return { top, groups: [], models };
  // Group and sort by the display name: Claude reports aliases ("opus") whose version is only in the label.
  const bySlug = new Map();
  for (const m of rest) {
    let slug = String(m.label || m.id).toLowerCase().trim().replace(/\s+/g, '-');
    while (bySlug.has(slug)) slug += '~';
    bySlug.set(slug, m);
  }
  const groups = groupModelsByFamily(state.groupProvider, [...bySlug.keys()])
    .map((g) => ({ key: g.key, label: g.label, models: g.models.map((slug) => bySlug.get(slug)).filter(Boolean) }));
  return { top, groups: groups.length > 1 ? groups : [], models };
}
/** Synchronous view from the cached catalog (null until it is loaded). */
export function agentModelStateCached() { return stateFrom(catalog); }
export async function agentModelState(request) {
  const stamp = revision;
  const data = await loadAgentModelCatalog(request);
  return stamp === revision ? stateFrom(data) : null;
}
async function persist(request, body) {
  if (!context?.sessionId) return;
  const result = await request(`/api/external-agents/sessions/${encodeURIComponent(context.sessionId)}/model`, { method: 'PUT', body: JSON.stringify(body) });
  if (result?.success === false) throw new Error(result.error || 'Could not save.');
}
export async function saveAgentModel(request, model) {
  if (!catalog?.models?.some((item) => item.id === model)) throw new Error('Choose a model reported by this agent.');
  const stamp = revision;
  // A different model may not support the old effort; let the harness default apply.
  const keepEffort = catalog.models.find((item) => item.id === model)?.efforts?.includes(selectedEffort);
  await persist(request, { model, ...(keepEffort ? { effort: selectedEffort } : {}) });
  if (stamp !== revision) return;
  selected = model; catalog.currentModel = model; if (!keepEffort) selectedEffort = '';
}
export async function saveAgentEffort(request, effort) {
  const state = stateFrom(catalog);
  if (!state || (effort && !state.efforts.includes(effort))) throw new Error('This model does not offer that reasoning level.');
  const stamp = revision;
  await persist(request, { model: state.model, effort });
  // The level belongs to the shown model, so a new chat sends both.
  if (stamp === revision) { selectedEffort = effort; selected = state.model; }
}
function effortWord(value) {
  const v = String(value || '');
  return v === 'xhigh' ? 'Extra High' : v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
}
/** Composer badge text, e.g. "GPT-6-Luna Medium". */
export async function agentModelBadge(request) {
  if (!context) return null;
  const stamp = revision;
  try {
    const state = await agentModelState(request);
    if (stamp !== revision || !state) return null;
    return [state.label, effortWord(state.effort)].filter(Boolean).join(' ');
  } catch { return stamp === revision ? 'Model' : null; }
}
export { effortWord as agentEffortLabel };
