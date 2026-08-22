import { api } from './api.js';
import { showToast } from './utils.js';

const CREATE_BUTTON_ID = 'subagent-create-bot-button';
const SIDEBAR_CREATE_BUTTON_ID = 'prom-bot-sidebar-create-button';
const MODAL_ID = 'prom-bot-create-modal';
const STYLE_ID = 'prom-bot-create-styles';

const BOT_TEMPLATES = {
  blank: {
    roleType: '',
    purpose: '',
  },
  researcher: {
    roleType: 'researcher',
    purpose: 'Research, analysis, source verification, and fact-checking.',
  },
  analyst: {
    roleType: 'analyst',
    purpose: 'Analyze information, compare evidence, find patterns, and produce clear conclusions.',
  },
  builder: {
    roleType: 'builder',
    purpose: 'Build, edit, test, and verify code and technical projects.',
  },
  operator: {
    roleType: 'operator',
    purpose: 'Carry out practical workflows, operate tools, and follow work through to completion.',
  },
};

let createBusy = false;
let observer = null;
let ensureQueued = false;

function isDesktopShell() {
  try {
    return !window.__PROM_SHOULD_BOOT_MOBILE?.();
  } catch {
    return true;
  }
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${CREATE_BUTTON_ID} {
      display:inline-flex;align-items:center;justify-content:center;gap:7px;
      min-height:32px;padding:7px 12px;border:1px solid var(--line);border-radius:9px;
      background:var(--panel-2);color:var(--text);font:inherit;font-size:12px;font-weight:800;
      cursor:pointer;transition:background .14s ease,border-color .14s ease,transform .14s ease;
      margin-left:auto;
    }
    #${CREATE_BUTTON_ID}:hover { background:var(--panel);border-color:color-mix(in srgb,var(--brand) 42%,var(--line)); }
    #${CREATE_BUTTON_ID}:active { transform:translateY(1px); }
    #${CREATE_BUTTON_ID} iconify-icon { color:var(--brand); }

    #${SIDEBAR_CREATE_BUTTON_ID} {
      position:absolute;right:6px;top:5px;z-index:2;width:26px;height:26px;padding:0;
      display:grid;place-items:center;border:0;border-radius:7px;background:transparent;
      color:var(--sidebar-muted,var(--muted));cursor:pointer;
    }
    #${SIDEBAR_CREATE_BUTTON_ID}:hover { background:var(--sidebar-item-hover,var(--panel-2));color:var(--text); }
    #prom-bot-sidebar-section { position:relative; }
    #prom-bot-sidebar-section > .section-title { padding-right:38px; }

    #${MODAL_ID} {
      position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;
      padding:24px;background:rgba(8,10,16,.54);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    }
    #${MODAL_ID}.open { display:flex; }
    .prom-bot-create-card {
      width:min(520px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 40px));overflow:auto;
      border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);
      box-shadow:0 24px 80px rgba(0,0,0,.28);padding:22px;
    }
    .prom-bot-create-head { display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:20px; }
    .prom-bot-create-kicker { font-size:11px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--brand); }
    .prom-bot-create-title { margin-top:4px;font-size:21px;line-height:1.15;font-weight:900;letter-spacing:-.02em; }
    .prom-bot-create-copy { margin-top:6px;font-size:12px;line-height:1.5;color:var(--muted);max-width:390px; }
    .prom-bot-create-close { width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:9px;background:var(--panel-2);color:var(--muted);cursor:pointer; }
    .prom-bot-create-close:hover { color:var(--text); }
    .prom-bot-create-field { display:flex;flex-direction:column;gap:7px;margin-top:14px; }
    .prom-bot-create-label { font-size:11px;font-weight:850;color:var(--text);letter-spacing:.01em; }
    .prom-bot-create-label span { font-weight:600;color:var(--muted); }
    .prom-bot-create-input,.prom-bot-create-textarea,.prom-bot-create-select {
      width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;
      background:var(--panel-2);color:var(--text);font:inherit;font-size:13px;outline:none;
      transition:border-color .14s ease,box-shadow .14s ease;
    }
    .prom-bot-create-input,.prom-bot-create-select { min-height:40px;padding:9px 11px; }
    .prom-bot-create-textarea { min-height:92px;resize:vertical;padding:10px 11px;line-height:1.45; }
    .prom-bot-create-input:focus,.prom-bot-create-textarea:focus,.prom-bot-create-select:focus {
      border-color:color-mix(in srgb,var(--brand) 65%,var(--line));box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 11%,transparent);
    }
    .prom-bot-create-help { font-size:10px;line-height:1.45;color:var(--muted); }
    .prom-bot-create-advanced { margin-top:16px;border-top:1px solid var(--line);padding-top:14px; }
    .prom-bot-create-advanced summary { cursor:pointer;font-size:11px;font-weight:850;color:var(--muted);user-select:none; }
    .prom-bot-create-note { margin-top:16px;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);font-size:10.5px;line-height:1.5;color:var(--muted); }
    .prom-bot-create-actions { display:flex;justify-content:flex-end;gap:9px;margin-top:20px; }
    .prom-bot-create-action {
      min-height:36px;padding:8px 14px;border-radius:9px;border:1px solid var(--line);
      background:var(--panel-2);color:var(--text);font:inherit;font-size:12px;font-weight:850;cursor:pointer;
    }
    .prom-bot-create-action.primary { border-color:var(--brand);background:var(--brand);color:var(--brand-contrast,#fff); }
    .prom-bot-create-action:disabled { opacity:.55;cursor:not-allowed; }
  `;
  document.head.appendChild(style);
}

function slugBotId(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `bot_${Date.now().toString(36)}`;
}

async function chooseUniqueBotId(name) {
  const data = await api('/api/agents', { timeoutMs: 8000 });
  const ids = new Set((Array.isArray(data?.agents) ? data.agents : []).map((agent) => String(agent?.id || '').trim()).filter(Boolean));
  const base = slugBotId(name);
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 48 - String(suffix).length - 1))}_${suffix}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${base.slice(0, 36)}_${Date.now().toString(36)}`;
}

function buildAgentMd({ name, purpose, instructions }) {
  const cleanName = String(name || 'Bot').trim() || 'Bot';
  const cleanPurpose = String(purpose || '').trim();
  const cleanInstructions = String(instructions || '').trim();
  const lines = [`# ${cleanName}`];
  if (cleanPurpose) lines.push('', '## Purpose', cleanPurpose);
  lines.push(
    '',
    '## Working Identity',
    `You are ${cleanName}, a distinct Prometheus Bot. Work within the capabilities and workspace access Prometheus actually exposes to you.`,
  );
  if (cleanInstructions) lines.push('', '## Persistent Instructions', cleanInstructions);
  return `${lines.join('\n').trim()}\n`;
}

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'prom-bot-create-title');
  modal.innerHTML = `
    <div class="prom-bot-create-card" role="document">
      <div class="prom-bot-create-head">
        <div>
          <div class="prom-bot-create-kicker">Prom Bot</div>
          <div class="prom-bot-create-title" id="prom-bot-create-title">Create a Bot</div>
          <div class="prom-bot-create-copy">Create the identity first. Tools, skills, memory, schedules, and run policy can be configured later without asking Prometheus to architect the Bot.</div>
        </div>
        <button class="prom-bot-create-close" type="button" data-bot-create-close aria-label="Close"><iconify-icon icon="solar:close-circle-linear" width="19" height="19"></iconify-icon></button>
      </div>

      <form id="prom-bot-create-form">
        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-template">Start from</label>
          <select class="prom-bot-create-select" id="prom-bot-create-template">
            <option value="blank">Blank Bot</option>
            <option value="researcher">Researcher</option>
            <option value="analyst">Analyst</option>
            <option value="builder">Builder</option>
            <option value="operator">Operator</option>
          </select>
        </div>

        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-name">Name</label>
          <input class="prom-bot-create-input" id="prom-bot-create-name" maxlength="80" autocomplete="off" placeholder="Terra" required />
        </div>

        <div class="prom-bot-create-field">
          <label class="prom-bot-create-label" for="prom-bot-create-purpose">What is this Bot for? <span>optional</span></label>
          <textarea class="prom-bot-create-textarea" id="prom-bot-create-purpose" maxlength="1600" placeholder="Research, analysis, and fact-checking."></textarea>
          <div class="prom-bot-create-help">This becomes the Bot's persistent <strong>Purpose</strong> in AGENT.md. It does not become a tool allowlist, success criteria, timeout, or heartbeat policy.</div>
        </div>

        <details class="prom-bot-create-advanced">
          <summary>Advanced</summary>
          <div class="prom-bot-create-field">
            <label class="prom-bot-create-label" for="prom-bot-create-model">Model override <span>optional</span></label>
            <input class="prom-bot-create-input" id="prom-bot-create-model" maxlength="180" autocomplete="off" placeholder="openai_codex/gpt-5.6-sol" />
            <div class="prom-bot-create-help">Leave blank to inherit Prometheus's configured subagent/default model.</div>
          </div>
          <div class="prom-bot-create-field">
            <label class="prom-bot-create-label" for="prom-bot-create-instructions">Persistent identity instructions <span>optional</span></label>
            <textarea class="prom-bot-create-textarea" id="prom-bot-create-instructions" maxlength="4000" placeholder="How this Bot should consistently work or communicate."></textarea>
          </div>
        </details>

        <div class="prom-bot-create-note">Memory and heartbeat files are intentionally not created here. MEMORY.md is created when the Bot first writes durable memory; heartbeat/schedule state is created only when you enable autonomy for this Bot.</div>

        <div class="prom-bot-create-actions">
          <button class="prom-bot-create-action" type="button" data-bot-create-close>Cancel</button>
          <button class="prom-bot-create-action primary" id="prom-bot-create-submit" type="submit">Create Bot</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest?.('[data-bot-create-close]')) closeBotCreateModal();
  });
  modal.querySelector('#prom-bot-create-template')?.addEventListener('change', (event) => {
    const template = BOT_TEMPLATES[String(event.target?.value || 'blank')] || BOT_TEMPLATES.blank;
    const purpose = modal.querySelector('#prom-bot-create-purpose');
    if (purpose && (!purpose.value.trim() || purpose.dataset.templateOwned === '1')) {
      purpose.value = template.purpose;
      purpose.dataset.templateOwned = template.purpose ? '1' : '0';
    }
  });
  modal.querySelector('#prom-bot-create-purpose')?.addEventListener('input', (event) => {
    event.target.dataset.templateOwned = '0';
  });
  modal.querySelector('#prom-bot-create-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitBotCreateForm();
  });
  return modal;
}

function openBotCreateModal() {
  installStyles();
  const modal = ensureModal();
  const form = modal.querySelector('#prom-bot-create-form');
  form?.reset();
  const purpose = modal.querySelector('#prom-bot-create-purpose');
  if (purpose) purpose.dataset.templateOwned = '0';
  modal.classList.add('open');
  requestAnimationFrame(() => modal.querySelector('#prom-bot-create-name')?.focus());
}

function closeBotCreateModal() {
  if (createBusy) return;
  document.getElementById(MODAL_ID)?.classList.remove('open');
}

async function submitBotCreateForm() {
  if (createBusy) return;
  const modal = ensureModal();
  const name = String(modal.querySelector('#prom-bot-create-name')?.value || '').trim();
  const purpose = String(modal.querySelector('#prom-bot-create-purpose')?.value || '').trim();
  const templateKey = String(modal.querySelector('#prom-bot-create-template')?.value || 'blank');
  const template = BOT_TEMPLATES[templateKey] || BOT_TEMPLATES.blank;
  const model = String(modal.querySelector('#prom-bot-create-model')?.value || '').trim();
  const instructions = String(modal.querySelector('#prom-bot-create-instructions')?.value || '').trim();
  if (!name) {
    showToast?.('Name required', 'Give the Bot a name before creating it.', 'error');
    modal.querySelector('#prom-bot-create-name')?.focus();
    return;
  }

  const submit = modal.querySelector('#prom-bot-create-submit');
  createBusy = true;
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Creating…';
  }

  try {
    const id = await chooseUniqueBotId(name);
    const agent = {
      id,
      name,
      ...(purpose ? { description: purpose } : {}),
      ...(template.roleType ? { roleType: template.roleType } : {}),
      ...(model ? { model } : {}),
      identity: { displayName: name, shortName: name },
    };

    // The resource creation is the commit point. Once POST /api/agents
    // succeeds, later UI/prompt-save failures must never tell the user that the
    // Bot itself failed to exist (which previously encouraged duplicate retries).
    const created = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ agent }),
      timeoutMs: 12000,
    });
    if (!created?.success) throw new Error(created?.error || 'Bot creation failed');

    let identityError = null;
    try {
      await api(`/api/agents/${encodeURIComponent(id)}/agent-md`, {
        method: 'PUT',
        body: JSON.stringify({ content: buildAgentMd({ name, purpose, instructions }) }),
        timeoutMs: 12000,
      });
    } catch (error) {
      identityError = error;
      console.warn('[Bot Create] Bot exists but AGENT.md could not be saved:', error);
    }

    modal.classList.remove('open');
    if (identityError) {
      showToast?.(
        'Bot created · identity save needs attention',
        `${name} was created successfully, but AGENT.md could not be saved. Open the Bot settings to retry the identity instructions; do not create a duplicate Bot.`,
        'warning',
      );
    } else {
      showToast?.('Bot created', `${name} is ready to chat.`, 'success');
    }

    try { await window.refreshSubagents?.(); } catch (error) { console.warn('[Bot Create] refreshSubagents failed:', error); }
    try { await window.refreshPromBotAgents?.({ force: true }); } catch (error) { console.warn('[Bot Create] Prom Bot roster refresh failed:', error); }

    try {
      if (typeof window.openPromBotAgent === 'function') {
        await window.openPromBotAgent(id);
      } else if (typeof window.openSubagentDetail === 'function') {
        await window.openSubagentDetail(id);
        try { await window.switchSubagentTab?.('chat', id); } catch {}
      }
    } catch (error) {
      console.warn('[Bot Create] Bot was created but could not be opened automatically:', error);
    }
  } catch (error) {
    console.error('[Bot Create] Could not create Bot:', error);
    showToast?.('Could not create Bot', String(error?.message || error), 'error');
  } finally {
    createBusy = false;
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Create Bot';
    }
  }
}

function makeCreateButton(id, compact = false) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  if (!compact) button.innerHTML = '<iconify-icon icon="solar:add-circle-bold" width="17" height="17"></iconify-icon><span>New Bot</span>';
  else {
    button.title = 'Create Bot';
    button.setAttribute('aria-label', 'Create Bot');
    button.innerHTML = '<iconify-icon icon="solar:add-circle-linear" width="17" height="17"></iconify-icon>';
  }
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openBotCreateModal();
  });
  return button;
}

function ensureSubagentsPageButton() {
  if (document.getElementById(CREATE_BUTTON_ID)) return;
  const count = document.getElementById('subagents-count');
  if (!count?.parentElement) return;
  const button = makeCreateButton(CREATE_BUTTON_ID, false);
  count.parentElement.appendChild(button);
}

function ensurePromBotSidebarButton() {
  if (document.getElementById(SIDEBAR_CREATE_BUTTON_ID)) return;
  const section = document.getElementById('prom-bot-sidebar-section');
  const header = section?.querySelector(':scope > .section-title');
  if (!section || !header) return;
  section.appendChild(makeCreateButton(SIDEBAR_CREATE_BUTTON_ID, true));
}

function ensureCreationSurfaces() {
  ensureQueued = false;
  if (!isDesktopShell()) return;
  installStyles();
  ensureSubagentsPageButton();
  ensurePromBotSidebarButton();
}

function queueEnsureCreationSurfaces() {
  if (ensureQueued) return;
  ensureQueued = true;
  queueMicrotask(ensureCreationSurfaces);
}

function boot() {
  if (!isDesktopShell()) return;
  installStyles();
  ensureCreationSurfaces();
  if (!observer && document.body) {
    observer = new MutationObserver(queueEnsureCreationSurfaces);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(MODAL_ID)?.classList.contains('open')) closeBotCreateModal();
  });
}

window.openBotCreateModal = openBotCreateModal;
window.closeBotCreateModal = closeBotCreateModal;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
