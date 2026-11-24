// Desktop: the ORIGINAL model switcher (quick reasoning slider + Advanced)
// stays in charge. When a connected agent owns the chat it reads this hook
// instead of Prometheus providers, so only the harness's models/efforts show.
import { desktopModelLabel } from '../components/desktop-model-label.js';
import { setAgentPlaceholder } from './external-agent-placeholder.js';
import {
  setAgentModelContext, hasAgentModelContext, agentModelState, agentModelStateCached,
  saveAgentModel, saveAgentEffort, agentModelForSend, agentEffortForSend, agentEffortLabel, agentModelGroups,
} from './external-agent-models.js';
const request = async (path, options = {}) => {
  if (window.api) return window.api(path, options);
  return (await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })).json();
};
let savedLabel = null;
let current = null;
let generation = 0;
let displayed = '';
let watched;
let labels = new Map();
function paintLabel(state) {
  const html = desktopModelLabel(state?.provider, state?.model, state?.label || 'Model', agentEffortLabel(state?.effort));
  const label = document.getElementById('chat-model-name');
  if (label && label !== watched) {
    watched = label;
    new MutationObserver(() => { if (current && displayed && label.innerHTML !== displayed) label.innerHTML = displayed; }).observe(label, { childList: true, subtree: true, characterData: true });
  }
  if (label) { label.innerHTML = html; displayed = label.innerHTML; }
}
function repaint() {
  const stamp = generation;
  return agentModelState(request).then((state) => { if (stamp === generation && current && state) paintLabel(state); }).catch(() => { if (stamp === generation && current) paintLabel(null); });
}
export function setDesktopAgentModel(context) {
  setAgentPlaceholder(context?.id || '');
  const label = document.getElementById('chat-model-name');
  const key = context ? `${context.id}|${context.sessionId || ''}|${context.cwd || ''}` : '';
  if (key === (current?.key || '')) return;
  generation++; current = context ? { ...context, key } : null; displayed = '';
  if (context && savedLabel === null) savedLabel = Array.from(label?.childNodes || [], node => node.cloneNode(true));
  setAgentModelContext(context);
  if (!context) { if (label && savedLabel !== null) label.replaceChildren(...savedLabel); savedLabel = null; return; }
  void repaint();
}
// Catalog labels ("GPT-6-Luna", "Haiku") instead of Prometheus provider names.
function installLabelOverride() {
  const original = window.formatModelDisplayName;
  if (typeof original !== 'function' || original.__eaAgentLabels) return;
  const wrapped = (model, provider) => (hasAgentModelContext() && labels.get(model)) || original(model, provider);
  wrapped.__eaAgentLabels = true;
  window.formatModelDisplayName = wrapped;
}
function switcherState(state) {
  if (!state) return null;
  installLabelOverride();
  labels = new Map(state.models.map((item) => [item.id, item.label]));
  return {
    route: null, llm: { provider: state.provider, providers: { [state.provider]: { model: state.model } } },
    catalog: [{ id: state.provider, name: state.agentName }],
    credentialed: [state.provider], provider: state.provider, model: state.model,
    providerConfig: { model: state.model }, reasoningEffort: state.effort, speed: 'standard',
    agentName: state.agentName, agentModels: state.models, agentEfforts: state.efforts,
    // Families for the switcher's Model view, same grouping as Prometheus providers.
    agentModelGroups: agentModelGroups(state),
  };
}
window.__promAgentModelSwitcher = {
  active: () => hasAgentModelContext() && !document.body.classList.contains('pm-mobile-active'),
  cached: () => switcherState(agentModelStateCached()) || switcherState({ provider: 'openai_codex', agentName: 'Agent', models: [], efforts: [], model: '', effort: '' }),
  load: async () => switcherState(await agentModelState(request)),
  levels: () => {
    const state = agentModelStateCached();
    return state ? state.efforts.map((v) => ({ v, label: agentEffortLabel(v), desc: '' })) : [];
  },
  async setRoute(route = {}) {
    const state = agentModelStateCached();
    if (route.model && route.model !== state?.model) await saveAgentModel(request, route.model);
    else if (route.reasoningEffort && route.reasoningEffort !== state?.effort) await saveAgentEffort(request, route.reasoningEffort);
    await repaint();
    return { effective: { providerId: state?.provider, model: route.model || state?.model, reasoningEffort: route.reasoningEffort } };
  },
};
export { agentModelForSend, agentEffortForSend };
