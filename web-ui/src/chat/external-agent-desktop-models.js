import { setAgentModelContext, hasAgentModelContext, agentModelBadge, loadAgentModelCatalog, agentModelForSend } from './external-agent-models.js';
import { esc } from './external-agent-ui.js';
const request = async (path, options = {}) => {
  if (window.api) return window.api(path, options);
  return (await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })).json();
};
let savedLabel = null;
let current = null;
let generation = 0;
let menu;
let displayed = '';
let watched;
function paintLabel(text) {
  displayed = text;
  const label = document.getElementById('chat-model-name');
  if (label && label !== watched) {
    watched = label;
    new MutationObserver(() => { if (current && displayed && label.textContent !== displayed) label.textContent = displayed; }).observe(label, { childList: true, subtree: true, characterData: true });
  }
  if (label && text && label.textContent !== text) label.textContent = text;
}
function close() { menu?.remove(); menu = null; }
export function setDesktopAgentModel(context) {
  const label = document.getElementById('chat-model-name');
  const key = context ? `${context.id}|${context.sessionId || ''}|${context.cwd || ''}` : '';
  if (key === (current?.key || '')) return;
  generation++; close(); current = context ? { ...context, key } : null; displayed = '';
  if (context && savedLabel === null) savedLabel = label?.textContent || '';
  setAgentModelContext(context);
  if (!context) { if (label && savedLabel !== null) label.textContent = savedLabel; savedLabel = null; return; }
  const stamp = generation;
  agentModelBadge(request).then(text => { if (stamp === generation && label && text) paintLabel(text); }).catch(() => {});
}
document.addEventListener('click', async event => {
  if (!hasAgentModelContext() || document.body.classList.contains('pm-mobile-active')) return;
  const button = event.target.closest?.('#model-switcher-btn');
  if (!button) { if (!menu?.contains(event.target)) close(); return; }
  event.preventDefault(); event.stopImmediatePropagation();
  if (menu) { close(); return; }
  const stamp = generation; const context = current;
  menu = document.createElement('div'); menu.className = 'ea-menu'; menu.style.bottom = '100%'; menu.textContent = 'Loading models…';
  button.parentElement.style.position = 'relative'; button.parentElement.appendChild(menu);
  const target = menu;
  try {
    const data = await loadAgentModelCatalog(request);
    if (stamp !== generation || !target.isConnected) return;
    target.innerHTML = (data?.models || []).map(model => `<button type="button" class="ea-menu-item" data-ea-model="${esc(model.id)}">${esc(model.label)}</button>`).join('') || `<div class="ea-menu-note">${esc(data?.unavailableReason || 'No model choices reported.')}</div>`;
    target.querySelectorAll('[data-ea-model]').forEach(row => row.addEventListener('click', async e => {
      e.stopPropagation(); row.disabled = true;
      try {
        const model = row.dataset.eaModel;
        if (context.sessionId) {
          const result = await request(`/api/external-agents/sessions/${encodeURIComponent(context.sessionId)}/model`, { method: 'PUT', body: JSON.stringify({ model }) });
          if (result?.success === false) throw new Error(result.error);
        }
        if (stamp !== generation) return;
        const { selectAgentModel } = await import('./external-agent-models.js'); selectAgentModel(model);
        paintLabel(row.textContent);
        close();
      } catch (error) { row.textContent = error.message; row.disabled = false; }
    }));
  } catch (error) { if (target.isConnected) target.textContent = error.message; }
}, true);
export { agentModelForSend };
