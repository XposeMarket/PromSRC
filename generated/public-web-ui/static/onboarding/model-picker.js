// Onboarding step 1: connect a model. Everything happens inline: one-click
// Claude, Sign in with ChatGPT, paste an API key, or use local Ollama. Each
// path makes the chosen provider live, verifies it with a real health check,
// then records it with /api/onboarding/model-connected.

import { connectClaudeOneClick, submitClaudeCode, cancelClaudeConnect, reopenClaudeSignIn } from './claude-connect.js';

const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const CODEX_MODELS = ['gpt-5.5'];
const KEY_PROVIDERS = {
  openai:    { label: 'OpenAI',    placeholder: 'sk-...',      models: ['gpt-5.5'] },
  anthropic: { label: 'Anthropic', placeholder: 'sk-ant-api...', models: CLAUDE_MODELS },
  xai:       { label: 'xAI (Grok)', placeholder: 'xai-...',    models: ['grok-4.3'] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function getJson(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function health() {
  try { return await getJson('/api/onboarding/model/health'); } catch { return { healthy: false }; }
}

/** Make provider/model live, then verify. Tries model candidates in order. */
async function activate(provider, models) {
  let last = null;
  for (const model of models) {
    await post('/api/settings/model', { provider, model });
    last = await health();
    if (last?.healthy) return { ok: true, provider, model: last.model || model };
  }
  return { ok: false, provider, error: last?.reason || 'The model did not respond.' };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function showModelPicker(opts = {}) {
  const devTest = !!opts.devTest;
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card prom-onb-model" role="dialog" aria-modal="true" aria-label="Connect a model">
        <div class="prom-onb-header">
          <div class="prom-onb-step">Step 1 of 3 · Connect a model</div>
          <button class="prom-onb-skip" data-skip type="button">Skip for now</button>
        </div>
        <div class="prom-onb-body">
          <h2 class="prom-onb-title">Welcome to Prometheus</h2>
          <p class="prom-onb-caption">Pick the AI that powers Prom. Use a subscription you already pay for, an API key, or a model running on this computer. You can change it any time.</p>
          ${devTest ? '<div class="prom-onb-devnote">Dev test mode · connections still work, but onboarding progress is not saved.</div>' : ''}
          <div class="prom-onb-options" data-options>
            <button class="prom-onb-option" data-pick="claude" type="button">
              <span class="prom-onb-option-title">Claude <span class="prom-onb-pill">Recommended</span></span>
              <span class="prom-onb-option-sub">Use your Claude Pro or Max plan. One click, approve in the browser.</span>
            </button>
            <button class="prom-onb-option" data-pick="codex" type="button">
              <span class="prom-onb-option-title">ChatGPT</span>
              <span class="prom-onb-option-sub">Sign in with your ChatGPT Plus or Pro account.</span>
            </button>
            <button class="prom-onb-option" data-pick="key" type="button">
              <span class="prom-onb-option-title">API key</span>
              <span class="prom-onb-option-sub">OpenAI, Anthropic, or xAI. Pay per use.</span>
            </button>
            <button class="prom-onb-option" data-pick="ollama" type="button">
              <span class="prom-onb-option-title">Local (Ollama)</span>
              <span class="prom-onb-option-sub">Free and private. Runs on this computer.</span>
            </button>
          </div>
          <div class="prom-onb-panel" data-panel hidden></div>
          <div class="prom-onb-status" data-status aria-live="polite"></div>
        </div>
        <div class="prom-onb-footer">
          <button class="prom-onb-link" data-more type="button">More providers in Settings</button>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn" data-back type="button" hidden>Back</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const optionsEl = root.querySelector('[data-options]');
    const panelEl   = root.querySelector('[data-panel]');
    const statusEl  = root.querySelector('[data-status]');
    const backBtn   = root.querySelector('[data-back]');
    const skipBtn   = root.querySelector('[data-skip]');
    const moreBtn   = root.querySelector('[data-more]');
    let busy = false;
    let resolved = false;
    let claudeSignal = null;

    function setStatus(msg, tone = 'muted') {
      statusEl.dataset.tone = tone;
      statusEl.textContent = msg || '';
    }

    function showOptions() {
      if (claudeSignal) { claudeSignal.cancelled = true; claudeSignal = null; }
      busy = false;
      panelEl.hidden = true;
      panelEl.innerHTML = '';
      optionsEl.hidden = false;
      backBtn.hidden = true;
      setStatus('');
    }

    function showPanel(html) {
      optionsEl.hidden = true;
      panelEl.hidden = false;
      panelEl.innerHTML = html;
      backBtn.hidden = false;
    }

    function close(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey, true);
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => { root.remove(); resolve(result); }, 200);
    }

    async function succeed(result) {
      setStatus(`Connected: ${result.provider} · ${result.model}`, 'ok');
      if (!devTest) {
        try { await post('/api/onboarding/model-connected', { provider: result.provider, model: result.model }); }
        catch (e) { console.warn('[onboarding] model-connected failed:', e); }
      }
      try { window.refreshStatus?.(); window.refreshModelSwitcher?.(); } catch {}
      await sleep(700);
      close('connected');
    }

    // ── Claude: one click ──────────────────────────────────────────────────
    async function startClaude() {
      busy = true;
      showPanel(`
        <div class="prom-onb-progress">
          <div class="prom-onb-spinner" aria-hidden="true"></div>
          <div>
            <div class="prom-onb-progress-title" data-ctitle>Starting Claude sign-in…</div>
            <div class="prom-onb-progress-sub" data-csub>A browser window will open. Approve access there, then come back.</div>
          </div>
        </div>
        <div class="prom-onb-inline" data-code-row hidden>
          <input class="prom-onb-input" data-code placeholder="Paste the code from the Claude page" autocomplete="off" />
          <button class="prom-onb-btn primary" data-code-submit type="button">Submit</button>
        </div>
        <div class="prom-onb-row-actions">
          <button class="prom-onb-link" data-reopen type="button" hidden>Browser didn't open? Open sign-in page</button>
        </div>
      `);
      const title = panelEl.querySelector('[data-ctitle]');
      const sub = panelEl.querySelector('[data-csub]');
      const codeRow = panelEl.querySelector('[data-code-row]');
      const codeInput = panelEl.querySelector('[data-code]');
      const reopen = panelEl.querySelector('[data-reopen]');
      let lastUrl = null;
      reopen.addEventListener('click', () => reopenClaudeSignIn(lastUrl));
      panelEl.querySelector('[data-code-submit]').addEventListener('click', async () => {
        const code = codeInput.value.trim();
        if (!code) return;
        setStatus('Checking code…');
        const r = await submitClaudeCode(code).catch((e) => ({ error: e.message }));
        if (r?.error) setStatus(r.error, 'err');
      });

      claudeSignal = { cancelled: false };
      const signal = claudeSignal;
      const result = await connectClaudeOneClick({
        signal,
        installIfMissing: true,
        onState(state, data) {
          if (signal.cancelled) return;
          if (data?.authUrl) { lastUrl = data.authUrl; reopen.hidden = false; }
          if (state === 'installing' || state === 'cli_missing') {
            title.textContent = 'Installing Claude Code…';
            sub.textContent = "Prom uses Anthropic's official Claude Code to sign you in. This takes about a minute and only happens once.";
          } else if (state === 'starting') {
            title.textContent = 'Starting Claude sign-in…';
          } else if (state === 'awaiting_browser') {
            title.textContent = 'Approve in your browser';
            sub.textContent = 'Sign in to Claude and click Authorize. Prom connects automatically when you approve.';
          } else if (state === 'awaiting_code') {
            title.textContent = 'Paste the code';
            sub.textContent = 'After approving, Claude shows a code. Paste it below.';
            codeRow.hidden = false;
            codeInput.focus();
          } else if (state === 'connected') {
            title.textContent = 'Claude approved. Checking the connection…';
            sub.textContent = '';
          }
        },
      }).catch((e) => ({ ok: false, error: e.message }));
      if (signal.cancelled || resolved) return;
      if (!result.ok) {
        busy = false;
        title.textContent = 'Claude did not connect';
        sub.textContent = result.error || 'Something went wrong.';
        setStatus('You can try again, or pick another option.', 'warn');
        panelEl.querySelector('.prom-onb-spinner')?.remove();
        const retry = document.createElement('button');
        retry.className = 'prom-onb-btn primary';
        retry.type = 'button';
        retry.textContent = 'Try again';
        retry.addEventListener('click', startClaude);
        panelEl.querySelector('.prom-onb-row-actions').appendChild(retry);
        return;
      }
      const live = await activate('anthropic', CLAUDE_MODELS);
      if (live.ok) return succeed(live);
      busy = false;
      title.textContent = 'Connected, but Claude did not answer';
      sub.textContent = live.error;
      setStatus('Your Claude plan may not include API access yet. Try again in a minute or pick another option.', 'warn');
    }

    // ── ChatGPT (Codex OAuth) ─────────────────────────────────────────────
    async function startCodex() {
      busy = true;
      showPanel(`
        <div class="prom-onb-progress">
          <div class="prom-onb-spinner" aria-hidden="true"></div>
          <div>
            <div class="prom-onb-progress-title" data-otitle>Opening ChatGPT sign-in…</div>
            <div class="prom-onb-progress-sub">Approve in the browser window. Prom connects automatically.</div>
          </div>
        </div>
        <div class="prom-onb-row-actions"><button class="prom-onb-link" data-reopen type="button" hidden>Browser didn't open? Open sign-in page</button></div>
      `);
      const title = panelEl.querySelector('[data-otitle]');
      const reopen = panelEl.querySelector('[data-reopen]');
      let start;
      try { start = await post('/api/auth/openai/start', {}); }
      catch (e) { start = { error: e.message }; }
      if (start?.error || !start?.authUrl) {
        busy = false;
        title.textContent = 'Could not start ChatGPT sign-in';
        setStatus(start?.error || 'No sign-in URL returned.', 'err');
        return;
      }
      const open = () => (typeof window.openPrometheusExternalLink === 'function'
        ? window.openPrometheusExternalLink(start.authUrl, { target: '_blank' })
        : window.open(start.authUrl, '_blank'));
      open();
      reopen.hidden = false;
      reopen.addEventListener('click', open);
      title.textContent = 'Approve in your browser';
      const deadline = Date.now() + 10 * 60 * 1000;
      while (!resolved && optionsEl.hidden && Date.now() < deadline) {
        await sleep(2000);
        if (!optionsEl.hidden || resolved) return;
        const p = await getJson('/api/auth/openai/poll').catch(() => ({}));
        if (!p?.done) continue;
        if (!p.success) {
          busy = false;
          title.textContent = 'ChatGPT sign-in failed';
          setStatus(p.error || 'Try again or pick another option.', 'err');
          return;
        }
        title.textContent = 'Signed in. Checking the connection…';
        const live = await activate('openai_codex', CODEX_MODELS);
        if (live.ok) return succeed(live);
        busy = false;
        setStatus(live.error || 'ChatGPT did not answer.', 'warn');
        return;
      }
    }

    // ── API key ───────────────────────────────────────────────────────────
    function startKey() {
      showPanel(`
        <label class="prom-onb-label">Provider</label>
        <div class="prom-onb-seg" data-seg>
          ${Object.entries(KEY_PROVIDERS).map(([id, p], i) => `<button type="button" class="prom-onb-seg-btn${i === 0 ? ' active' : ''}" data-provider="${id}">${esc(p.label)}</button>`).join('')}
        </div>
        <label class="prom-onb-label">API key</label>
        <div class="prom-onb-inline">
          <input class="prom-onb-input" type="password" data-key placeholder="${esc(KEY_PROVIDERS.openai.placeholder)}" autocomplete="off" spellcheck="false" />
          <button class="prom-onb-btn primary" data-save type="button">Connect</button>
        </div>
        <div class="prom-onb-hint">Stored encrypted on this computer. Never sent anywhere except the provider.</div>
      `);
      let provider = 'openai';
      const keyInput = panelEl.querySelector('[data-key]');
      panelEl.querySelectorAll('[data-provider]').forEach((btn) => btn.addEventListener('click', () => {
        provider = btn.dataset.provider;
        panelEl.querySelectorAll('[data-provider]').forEach((b) => b.classList.toggle('active', b === btn));
        keyInput.placeholder = KEY_PROVIDERS[provider].placeholder;
        keyInput.focus();
      }));
      keyInput.focus();
      const save = async () => {
        const key = keyInput.value.trim();
        if (!key || busy) return;
        busy = true;
        setStatus('Saving key and testing…');
        try {
          if (provider === 'anthropic') {
            await post('/api/auth/anthropic/setup-token', { token: key });
          } else {
            await post('/api/settings/provider', {
              llm: { provider, providers: { [provider]: { api_key: key, model: KEY_PROVIDERS[provider].models[0] } } },
            });
          }
          keyInput.value = '';
          const live = await activate(provider, KEY_PROVIDERS[provider].models);
          if (live.ok) return succeed(live);
          setStatus(`The key was saved but ${KEY_PROVIDERS[provider].label} did not answer. Check the key and try again.`, 'err');
        } catch (e) {
          setStatus(e.message || 'Could not save the key.', 'err');
        }
        busy = false;
      };
      panelEl.querySelector('[data-save]').addEventListener('click', save);
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    }

    // ── Ollama ────────────────────────────────────────────────────────────
    async function startOllama() {
      busy = true;
      showPanel(`<div class="prom-onb-progress"><div class="prom-onb-spinner" aria-hidden="true"></div><div><div class="prom-onb-progress-title">Looking for Ollama on this computer…</div></div></div>`);
      const data = await getJson('/api/ollama/models').catch(() => ({ success: false }));
      busy = false;
      if (!data?.success) {
        showPanel(`
          <div class="prom-onb-progress-title">Ollama isn't running</div>
          <p class="prom-onb-caption">Install Ollama, run <code>ollama pull qwen3:8b</code>, then check again.</p>
          <div class="prom-onb-row-actions">
            <button class="prom-onb-btn" data-get type="button">Get Ollama</button>
            <button class="prom-onb-btn primary" data-retry type="button">Check again</button>
          </div>
        `);
        panelEl.querySelector('[data-get]').addEventListener('click', () => {
          const url = 'https://ollama.com/download';
          if (typeof window.openPrometheusExternalLink === 'function') window.openPrometheusExternalLink(url, { target: '_blank' });
          else window.open(url, '_blank');
        });
        panelEl.querySelector('[data-retry]').addEventListener('click', startOllama);
        return;
      }
      const models = (data.models || []).map((m) => m.name).filter(Boolean);
      if (!models.length) {
        showPanel(`
          <div class="prom-onb-progress-title">Ollama is running, but has no models</div>
          <p class="prom-onb-caption">Run <code>ollama pull qwen3:8b</code> in a terminal, then check again.</p>
          <div class="prom-onb-row-actions"><button class="prom-onb-btn primary" data-retry type="button">Check again</button></div>
        `);
        panelEl.querySelector('[data-retry]').addEventListener('click', startOllama);
        return;
      }
      showPanel(`
        <label class="prom-onb-label">Pick a local model</label>
        <div class="prom-onb-inline">
          <select class="prom-onb-input" data-model>${models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
          <button class="prom-onb-btn primary" data-use type="button">Use this model</button>
        </div>
        <div class="prom-onb-hint">Smaller local models work for chat, but tool use is much better with Claude or ChatGPT.</div>
      `);
      panelEl.querySelector('[data-use]').addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        const model = panelEl.querySelector('[data-model]').value;
        setStatus('Testing local model…');
        const live = await activate('ollama', [model]).catch((e) => ({ ok: false, error: e.message }));
        busy = false;
        if (live.ok) return succeed(live);
        setStatus(live.error || 'The model did not respond.', 'err');
      });
    }

    optionsEl.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]')?.dataset.pick;
      if (!pick || busy) return;
      setStatus('');
      if (pick === 'claude') startClaude();
      else if (pick === 'codex') startCodex();
      else if (pick === 'key') startKey();
      else if (pick === 'ollama') startOllama();
    });

    backBtn.addEventListener('click', async () => {
      if (claudeSignal) await cancelClaudeConnect();
      showOptions();
    });

    moreBtn.addEventListener('click', () => {
      root.style.display = 'none';
      try { window.openSettings?.('models'); } catch (e) { console.warn('[onboarding] could not open settings:', e); }
      const watch = setInterval(async () => {
        const modal = document.getElementById('settings-modal');
        const open = modal && modal.style.display !== 'none' && modal.offsetParent !== null;
        if (open || resolved) return;
        clearInterval(watch);
        root.style.display = '';
        setStatus('Checking your connection…');
        const h = await health();
        if (h?.healthy) succeed({ provider: h.provider, model: h.model || 'default' });
        else setStatus(h?.provider ? `${h.provider} is set but did not respond.` : '');
      }, 600);
    });

    skipBtn.addEventListener('click', async () => {
      if (claudeSignal) await cancelClaudeConnect();
      if (!devTest) await post('/api/onboarding/model-skipped', {}).catch(() => {});
      close('skipped');
    });

    function onKey(e) {
      if (e.key === 'Escape' && !panelEl.hidden) { e.stopPropagation(); backBtn.click(); }
    }
    document.addEventListener('keydown', onKey, true);

    // Already connected (e.g. returning after a crash mid-onboarding)?
    health().then((h) => {
      if (h?.healthy && !resolved && !busy && optionsEl.hidden === false) {
        setStatus(`${h.provider} · ${h.model || 'default'} is already working.`, 'ok');
        const use = document.createElement('button');
        use.className = 'prom-onb-btn primary';
        use.type = 'button';
        use.textContent = 'Continue with it';
        use.addEventListener('click', () => succeed({ provider: h.provider, model: h.model || 'default' }));
        root.querySelector('.prom-onb-actions').appendChild(use);
      }
    });
  });
}
