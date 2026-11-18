// Composer placeholder for harness chats: "Send Codex a message" instead of
// "Send Prometheus a message". The rest of the composer is untouched. Native code
// rewrites the placeholder in many places (send, stop, chat switch), so a small
// observer re-applies it instead of patching each of those sites.
import { agentName } from './external-agent-ui.js';

const INPUTS = ['chat-input', 'pm-composer-input'];
// Only the default "talk to the agent" placeholders are replaced; transient ones
// (e.g. "Assistant is responding… queue next prompt") are left alone.
const DEFAULT_RE = /^(Send Prometheus a message|Work on .+)$/;
let agentId = '';
let observer = null;
const originals = new WeakMap();

function apply(input) {
  if (!input) return;
  const current = input.getAttribute('placeholder') || '';
  const wanted = agentId ? `Send ${agentId === 'openai-dots' ? 'Dot' : agentName(agentId)} a message` : '';
  if (wanted) {
    if (current === wanted) return;
    if (!DEFAULT_RE.test(current)) return;
    originals.set(input, current);
    input.setAttribute('placeholder', wanted);
  } else if (/^Send .+ a message$/.test(current) && current !== 'Send Prometheus a message' && originals.has(input)) {
    input.setAttribute('placeholder', originals.get(input));
    originals.delete(input);
  }
}

function applyAll() { for (const id of INPUTS) apply(document.getElementById(id)); }

/** id = the harness running this chat (or being picked for a new one); '' / prometheus = native. */
export function setAgentPlaceholder(id) {
  agentId = id && id !== 'prometheus' ? String(id) : '';
  if (!observer && typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => { if (agentId) applyAll(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['placeholder'] });
  }
  applyAll();
}
