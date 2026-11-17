import { agentName, esc } from './external-agent-ui.js';
let context = null;
let revision = 0;
let catalog = null;
let loading = null;
let selected = '';
export function setAgentModelContext(value) {
  const key = value ? `${value.id}|${value.sessionId || ''}|${value.cwd || ''}` : '';
  if (key === (context?.key || '')) { if (value?.currentModel && catalog && !selected) catalog.currentModel = value.currentModel; return; }
  revision++; context = value ? { ...value, key } : null; catalog = null; loading = null; selected = value?.selectedModel || '';
  window.dispatchEvent(new Event('external-agent-model-context'));
}
export function hasAgentModelContext() { return !!context; }
export function agentModelForSend() { return selected || undefined; }
export function selectAgentModel(model) { if (!catalog?.models?.some(item => item.id === model)) throw new Error('Choose a model reported by this agent.'); selected = model; catalog.currentModel = model; }
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
      catalog = { ...data, currentModel: selected || data.currentModel || current.currentModel || '' };
      return catalog;
    } finally { if (stamp === revision) loading = null; }
  })();
  return loading;
}
export async function agentModelBadge(request) {
  if (!context) return null;
  const stamp = revision;
  try {
    const data = await loadAgentModelCatalog(request);
    if (stamp !== revision) return null;
    const id = selected || data?.currentModel;
    return data?.models?.find(model => model.id === id)?.label || id || 'Model';
  } catch { return stamp === revision ? 'Model' : null; }
}
/** Use the existing model sheet and row styles; never replace composer controls. */
export async function openAgentModelSheet({ request, open, close, refresh }) {
  if (!context) return false;
  const current = context; const stamp = revision;
  open('Model', '<div class="pm-msheet-loading">Loading models…</div>');
  const body = document.getElementById('pm-msheet-body');
  try {
    const data = await loadAgentModelCatalog(request);
    if (stamp !== revision || !body?.isConnected) return true;
    body.innerHTML = (data?.models || []).map(model => `<button type="button" class="pm-msheet-row" data-ea-model="${esc(model.id)}"><span class="pm-msheet-row-label">${esc(model.label)}</span>${model.id === (selected || data.currentModel) ? '<span class="pm-msheet-check">✓</span>' : ''}</button>`).join('') || `<div class="pm-msheet-loading">${esc(data?.unavailableReason || `${agentName(current.id)} has not reported model choices.`)}</div>`;
    body.querySelectorAll('[data-ea-model]').forEach(button => button.addEventListener('click', async () => {
      if (stamp !== revision) return;
      button.disabled = true;
      try {
        const model = button.dataset.eaModel;
        if (current.sessionId) {
          const result = await request(`/api/external-agents/sessions/${encodeURIComponent(current.sessionId)}/model`, { method: 'PUT', body: JSON.stringify({ model }) });
          if (result?.success === false) throw new Error(result.error);
        }
        if (stamp !== revision) return;
        selected = model; catalog = { ...data, currentModel: model }; close(); await refresh();
      } catch (error) { if (body.isConnected) { const message = document.createElement('p'); message.textContent = error.message; body.appendChild(message); } }
      finally { button.disabled = false; }
    }));
  } catch (error) { if (stamp === revision && body?.isConnected) body.textContent = error.message; }
  return true;
}
