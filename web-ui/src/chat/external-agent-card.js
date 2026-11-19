// Markup for a harness request (approval or question) on Prometheus's own approval card.
// Loaded only when a harness actually asks something, so ordinary chats do not carry it.
//
// The card reuses the native approval classes per surface: phone = _renderMobileApprovalCard,
// desktop = renderInlineApprovalRequest. Buttons carry only data-ea-option (never
// data-pm-approval-* or onclick), so Prometheus's own approval handlers never fire for it.
import { agentLogoHtml } from './external-agent-logos.js';
import { agentName, esc } from './external-agent-ui.js';

const MOBILE_NAMES = {
  shell: 'pm-chat-approval pm-approval-sheet pending', meta: 'pm-approval-meta', eyebrow: 'pm-approval-eyebrow',
  title: 'pm-chat-approval-title', sub: 'pm-approval-sub mono', quote: 'pm-approval-quote',
  details: 'pm-approval-technical pm-chat-approval-details', params: 'pm-chat-approval-parameters',
  row: 'pm-chat-approval-parameter', actions: 'pm-chat-approval-actions pm-approval-actions',
  approve: 'pm-chat-approval-btn approve pm-approval-primary', session: 'pm-chat-approval-btn session',
  reject: 'pm-chat-approval-btn reject pm-approval-deny',
};
const DESKTOP_NAMES = {
  shell: 'chat-approval-card chat-approval-card-pending', meta: 'chat-approval-head', eyebrow: 'chat-approval-kicker',
  title: 'chat-approval-title', sub: 'chat-approval-command', quote: 'chat-approval-reason',
  details: 'chat-approval-technical', params: '', row: 'chat-approval-scope', actions: 'chat-approval-actions',
  approve: 'chat-approval-btn chat-approval-approve', session: 'chat-approval-link', reject: 'chat-approval-btn chat-approval-deny',
};

function isMobileSurface() {
  return document.body.classList.contains('pm-mobile-active');
}

function nativeNames(mobile) {
  return mobile ? MOBILE_NAMES : DESKTOP_NAMES;
}

/** Class for the card element itself. */
export function cardClass() {
  return `ea-harness-card ${nativeNames(isMobileSurface()).shell}`;
}

function questionsHtml(req) {
  const questions = Array.isArray(req.detail?.questions) ? req.detail.questions : [];
  return questions.map((q) => {
    const opts = Array.isArray(q.options) && q.options.length
      ? `<div class="ea-card-choices">${q.options.map((o) => `<label class="ea-card-choice"><input type="${q.multi ? 'checkbox' : 'radio'}" name="ea-q-${esc(req.requestId)}-${esc(q.id)}" value="${esc(o.id)}"><span>${esc(o.label)}</span></label>`).join('')}</div>`
      : `<input class="ea-card-input" type="text" data-ea-q="${esc(q.id)}" autocomplete="off">`;
    return `<div class="ea-card-q" data-ea-qid="${esc(q.id)}"><div class="ea-card-q-prompt">${esc(q.prompt)}</div>${opts}</div>`;
  }).join('');
}

export function cardHtml(req) {
  const mobile = isMobileSurface();
  const n = nativeNames(mobile);
  const d = req.detail || {};
  const files = Array.isArray(d.files) ? d.files : [];
  const grants = Array.isArray(d.grants) ? d.grants : [];
  const shown = files.length > 12 ? [...files.slice(0, 12), `…and ${files.length - 12} more`] : files;
  const row = (label, value) => (mobile
    ? `<div class="${n.row}"><dt>${label}</dt><dd>${value}</dd></div>`
    : `<div class="${n.row}"><span>${label}</span>${value}</div>`);
  const sub = d.command || files[0] || '';
  // A single file is already the line under the title: do not list it twice.
  const filesRow = shown.length && !(shown.length === 1 && shown[0] === sub) ? row('Files', `<span class="ea-card-text">${esc(shown.join('\n'))}</span>`) : '';
  const body = (d.cwd ? `<div class="ea-card-cwd">in ${esc(d.cwd)}</div>` : '')
    + (mobile && filesRow ? `<dl class="${n.params}">${filesRow}</dl>` : filesRow)
    + (grants.length ? `<div class="ea-card-cwd">Allow grants exactly this:</div><pre class="ea-card-grants">${esc(grants.join('\n'))}</pre>` : '')
    + (typeof d.preview === 'string' && d.preview ? `<pre class="ea-card-preview">${esc(d.preview)}</pre>` : '');
  const who = `${agentLogoHtml(req.agentId)}<span>${esc(agentName(req.agentId))} · ${req.kind === 'question' ? 'has a question' : 'needs your approval'}</span>`;
  const title = esc(req.title || 'Agent request');
  const head = mobile
    ? `<div class="${n.meta}"><span class="pm-approval-dot" aria-hidden="true"></span><span class="${n.eyebrow} ea-card-agent">${who}</span></div><strong class="${n.title}">${title}</strong>`
    : `<div class="${n.meta}"><div><div class="${n.eyebrow} ea-card-agent">${who}</div><div class="${n.title}">${title}</div></div></div>`;
  const buttons = (req.options || []).map((o) => {
    const kind = String(o.kind || '');
    const cls = kind === 'allow_session' ? n.session : (kind === 'deny' || kind === 'cancel') ? n.reject : n.approve;
    return `<button type="button" class="${cls} ea-card-btn" data-ea-option="${esc(o.id)}">${esc(o.label)}</button>`;
  }).join('');
  return `${head}${sub ? `<div class="${n.sub} ea-card-sub">${esc(sub)}</div>` : ''}${d.reason ? `<div class="${n.quote}">${esc(d.reason)}</div>` : ''}${questionsHtml(req)}${body ? `<details class="${n.details}" open><summary>Details <span aria-hidden="true">›</span></summary>${body}</details>` : ''}<div class="${n.actions}">${buttons}</div>
    <p class="ea-card-note">Your answer goes to ${esc(agentName(req.agentId))} only. Prometheus's own permissions are not changed.</p>
    <div class="ea-card-error" hidden></div>`;
}

export function missingHtml() {
  const n = nativeNames(isMobileSurface());
  return `<div class="${n.meta}"><div class="${n.eyebrow}">Agent session ended</div></div>`
    + '<p class="ea-card-note">The original agent session could not be found. Your chat history is still here.</p>'
    + `<div class="${n.actions}"><button type="button" class="${n.approve}">Start a new agent session in this chat</button></div>`
    + '<p role="status" class="ea-card-note"></p>';
}

// Mount point, re-resolved on every show. Phone: at the end of the scrolling chat, right under the
// live turn, where Prometheus's own approval cards sit (a sibling of the re-rendered message list,
// so a re-render never removes it). Desktop: the top of the composer area. Else a fixed fallback.
let hostEl = null;

export function cardHost() {
  const mobile = isMobileSurface();
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = 'ea-request-host';
    hostEl.className = 'ea-request-host';
    hostEl.setAttribute('aria-live', 'polite');
  }
  const chat = mobile ? document.getElementById('pm-chat-body') : null;
  const composer = mobile ? null : document.querySelector('#chat-view > .chat-input-area:not([data-canonical-secondary-composer])');
  hostEl.classList.remove('ea-request-fallback');
  if (chat) chat.appendChild(hostEl);
  else if (composer) composer.prepend(hostEl);
  else { hostEl.classList.add('ea-request-fallback'); document.body.appendChild(hostEl); }
  return hostEl;
}
