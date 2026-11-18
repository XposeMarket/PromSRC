// Model + reasoning state for a chat run by a connected agent (Codex, Claude
// Code, ...). The ORIGINAL desktop switcher and mobile reasoning sheet render
// it; this module only supplies the harness's own models and effort levels.
import { agentName } from './external-agent-ui.js';
let context = null;
let revision = 0;
let catalog = null;
let loading = null;
let selected = '';
let selectedEffort = '';
const PROVIDER_FOR_AGENT = { codex: 'openai_codex', 'claude-code': 'anthropic' };
export function setAgentModelContext(value) {
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
function stateFrom(data) {
  if (!context || !data) return null;
  const models = Array.isArray(data.models) ? data.models : [];
  const model = selected || data.currentModel || '';
  const entry = models.find((item) => item.id === model);
  const efforts = Array.isArray(entry?.efforts) ? entry.efforts.filter(Boolean) : [];
  const fallback = entry?.defaultEffort || (efforts.includes('medium') ? 'medium' : efforts[0] || '');
  return {
    agentId: context.id,
    agentName: agentName(context.id),
    provider: PROVIDER_FOR_AGENT[context.id] || 'openai_codex',
    model,
    label: entry?.label || model || 'Model',
    models,
    efforts,
    effort: efforts.includes(selectedEffort) ? selectedEffort : fallback,
    unavailableReason: models.length ? '' : (data.unavailableReason || `${agentName(context.id)} has not reported model choices.`),
  };
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
