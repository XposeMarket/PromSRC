// Onboarding model gate. Renders an overlay panel that pushes the user into
// Settings → Models, then polls /api/onboarding/model/health until a provider
// reports healthy. On success: POST /api/onboarding/model-connected and resolve.

export function showModelPicker() {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'prom-onboarding-root';
    root.innerHTML = `
      <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Connect a model">
        <div class="prom-onb-header">
          <div class="prom-onb-step">Step · Connect your brain</div>
          <button class="prom-onb-skip" data-skip>Skip for now</button>
        </div>
        <div class="prom-onb-body">
          <div class="prom-onb-illus">
            <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
              <circle cx="100" cy="70" r="36" fill="#fff" stroke="#0d4faf" stroke-width="3"/>
              <circle cx="100" cy="70" r="6"  fill="#0d4faf"/>
              <line x1="44"  y1="70" x2="60"  y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
              <line x1="140" y1="70" x2="156" y2="70" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
              <line x1="100" y1="22" x2="100" y2="34" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
              <line x1="100" y1="106" x2="100" y2="118" stroke="#a36ce0" stroke-width="3" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 class="prom-onb-title">Connect a model brain</h2>
          <p class="prom-onb-caption">
            I need a language model to think with. Pick whichever you prefer — your
            ChatGPT or Claude account, an API key, or a local Ollama install.
            I'll wait here while you set it up.
          </p>
          <div class="prom-onb-status" data-status style="margin-top:8px;font-size:13px;color:var(--muted,#666);min-height:20px"></div>
        </div>
        <div class="prom-onb-footer">
          <div style="font-size:11px;color:var(--muted,#888)">I'll detect the connection automatically.</div>
          <div class="prom-onb-actions">
            <button class="prom-onb-btn" data-recheck>Re-check now</button>
            <button class="prom-onb-btn primary" data-open>Open Model Settings</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const statusEl  = root.querySelector('[data-status]');
    const openBtn   = root.querySelector('[data-open]');
    const recheckBtn= root.querySelector('[data-recheck]');
    const skipBtn   = root.querySelector('[data-skip]');

    let pollTimer = null;
    let resolved  = false;

    function setStatus(msg, tone = 'muted') {
      if (!statusEl) return;
      const colors = { muted: 'var(--muted,#666)', ok: '#1a7f37', warn: '#9a6700', err: 'var(--err,#c43d3d)' };
      statusEl.style.color = colors[tone] || colors.muted;
      statusEl.textContent = msg;
    }

    async function checkOnce() {
      try {
        const r = await fetch('/api/onboarding/model/health');
        if (!r.ok) { setStatus('Could not reach gateway. Will retry.', 'warn'); return false; }
        const h = await r.json();
        if (h.healthy) {
          setStatus(`Connected: ${h.provider} (${h.model || 'default'})`, 'ok');
          finish(h);
          return true;
        }
        if (h.provider) setStatus(`Detected ${h.provider} but it didn't respond — try Open Model Settings.`, 'warn');
        else setStatus('No provider configured yet — click Open Model Settings.', 'muted');
        return false;
      } catch {
        setStatus('Network hiccup — will retry.', 'warn');
        return false;
      }
    }

    async function finish(health) {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      try {
        await fetch('/api/onboarding/model-connected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: health.provider, model: health.model || '' }),
        });
      } catch (e) { console.warn('[onboarding] model-connected post failed:', e); }
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => { root.remove(); resolve('connected'); }, 200);
    }

    function startPolling() {
      checkOnce();
      pollTimer = setInterval(checkOnce, 4000);
    }

    openBtn.addEventListener('click', () => {
      // Hide overlay so the settings modal is reachable, but keep polling underneath.
      root.style.display = 'none';
      try {
        if (typeof window.openSettings === 'function') window.openSettings('models');
      } catch (e) { console.warn('[onboarding] could not open settings:', e); }
      // Re-show overlay when settings modal closes (best-effort: poll for it).
      const reshowTimer = setInterval(() => {
        const settingsModal = document.getElementById('settings-modal');
        const visible = settingsModal && settingsModal.style.display !== 'none' && settingsModal.offsetParent !== null;
        if (!visible) {
          clearInterval(reshowTimer);
          if (!resolved) root.style.display = '';
        }
      }, 500);
    });

    recheckBtn.addEventListener('click', () => { setStatus('Checking…'); checkOnce(); });

    skipBtn.addEventListener('click', () => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      root.style.transition = 'opacity 200ms ease-out';
      root.style.opacity = '0';
      setTimeout(() => { root.remove(); resolve('skipped'); }, 200);
    });

    startPolling();
  });
}
