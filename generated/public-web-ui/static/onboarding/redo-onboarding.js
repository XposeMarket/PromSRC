// Triple-gated hard reset. Walks the user through three confirmation screens:
//   1. Explanation modal listing what gets wiped vs kept.
//   2. Type-the-phrase verification ("redo onboarding").
//   3. 5-second countdown destructive button with always-available Cancel.
// On final confirm, calls POST /api/onboarding/redo with the phrase and reloads
// once the wipe completes so the controller restarts from step 1.

const PHRASE = 'redo onboarding';

export function startRedoOnboardingFlow() {
  // Stage 1 — explanation
  showStage1();
}

function buildShell(innerHtml) {
  const root = document.createElement('div');
  root.id = 'prom-onboarding-root';
  root.innerHTML = innerHtml;
  document.body.appendChild(root);
  return root;
}

function dismiss(root, cb) {
  root.style.transition = 'opacity 180ms ease-out';
  root.style.opacity = '0';
  setTimeout(() => { root.remove(); cb && cb(); }, 180);
}

function dangerHeader(stepLabel) {
  return `
    <div class="prom-onb-header" style="border-bottom:1px solid rgba(196,61,61,0.2)">
      <div class="prom-onb-step" style="color:#c43d3d">⚠️ Danger zone · ${stepLabel}</div>
    </div>
  `;
}

function showStage1() {
  const root = buildShell(`
    <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Redo Onboarding — confirmation 1 of 3" style="border:2px solid rgba(196,61,61,0.45)">
      ${dangerHeader('Step 1 of 3')}
      <div class="prom-onb-body">
        <h2 class="prom-onb-title" style="color:#c43d3d">Redo Onboarding — destructive action</h2>
        <p class="prom-onb-caption">
          This wipes Prometheus's memory of you and starts over. It is <strong>not reversible</strong>.
          You will go through the entire onboarding flow again from scratch.
        </p>
        <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="border:1px solid rgba(196,61,61,0.3);border-radius:10px;padding:12px;background:rgba(196,61,61,0.05)">
            <div style="font-weight:700;color:#c43d3d;font-size:13px;margin-bottom:6px">Will be deleted</div>
            <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--text,#222)">
              <li>USER.md, BUSINESS.md, MEMORY.md, TOOLS.md, SOUL.md</li>
              <li>All chat history</li>
              <li>All projects, canvases, creatives</li>
              <li>Heartbeat history &amp; BOOT.md</li>
              <li>Scheduled tasks (cron jobs)</li>
              <li>Teams &amp; team state</li>
              <li>Self-improvement &amp; learning state</li>
            </ul>
          </div>
          <div style="border:1px solid rgba(34,160,90,0.3);border-radius:10px;padding:12px;background:rgba(34,160,90,0.05)">
            <div style="font-weight:700;color:#1a7f37;font-size:13px;margin-bottom:6px">Will be kept</div>
            <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--text,#222)">
              <li>Your model settings &amp; API keys</li>
              <li>Credentials vault</li>
              <li>OAuth connections (Gmail, etc.)</li>
              <li>Installed apps &amp; skills</li>
              <li>Audit logs</li>
            </ul>
          </div>
        </div>
        <p class="prom-onb-caption" style="margin-top:14px;font-size:12px;color:var(--muted,#666)">
          Use this if you want a completely fresh start — for instance, you're handing
          this install to someone else, or your memory has drifted and you want to
          re-baseline. Otherwise, "Replay tutorial" is probably what you want.
        </p>
      </div>
      <div class="prom-onb-footer" style="border-top-color:rgba(196,61,61,0.2)">
        <div></div>
        <div class="prom-onb-actions">
          <button class="prom-onb-btn primary" data-cancel autofocus style="background:#fff;color:var(--text,#222);border-color:var(--line,#ddd)">Cancel</button>
          <button class="prom-onb-btn" data-continue style="background:#fff;color:#c43d3d;border-color:rgba(196,61,61,0.5)">I understand the risks</button>
        </div>
      </div>
    </div>
  `);
  root.querySelector('[data-cancel]').addEventListener('click', () => dismiss(root));
  root.querySelector('[data-continue]').addEventListener('click', () => dismiss(root, showStage2));
}

function showStage2() {
  const root = buildShell(`
    <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Redo Onboarding — confirmation 2 of 3" style="border:2px solid rgba(196,61,61,0.6)">
      ${dangerHeader('Step 2 of 3')}
      <div class="prom-onb-body">
        <h2 class="prom-onb-title" style="color:#c43d3d">Type to confirm</h2>
        <p class="prom-onb-caption">
          To unlock the final confirmation, type the phrase below exactly. This is to
          ensure you really mean to do this.
        </p>
        <div style="margin-top:14px;padding:14px;background:rgba(196,61,61,0.06);border:1px solid rgba(196,61,61,0.2);border-radius:10px">
          <div style="font-size:11px;color:var(--muted,#666);margin-bottom:8px;letter-spacing:0.04em">TYPE THIS PHRASE</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:600;color:#c43d3d;user-select:none">${PHRASE}</div>
        </div>
        <input data-phrase type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
          placeholder="Type the phrase here…"
          style="width:100%;margin-top:12px;padding:12px;border:2px solid var(--line,#ddd);border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:14px;box-sizing:border-box;outline:none" />
        <div data-msg style="margin-top:8px;font-size:12px;color:var(--muted,#777);min-height:18px"></div>
      </div>
      <div class="prom-onb-footer" style="border-top-color:rgba(196,61,61,0.2)">
        <div></div>
        <div class="prom-onb-actions">
          <button class="prom-onb-btn" data-cancel>Cancel</button>
          <button class="prom-onb-btn" data-continue disabled style="background:#fff;color:#c43d3d;border-color:rgba(196,61,61,0.5)">Continue</button>
        </div>
      </div>
    </div>
  `);
  const input  = root.querySelector('[data-phrase]');
  const cont   = root.querySelector('[data-continue]');
  const msg    = root.querySelector('[data-msg]');
  input.focus();
  input.addEventListener('input', () => {
    const v = input.value.trim().toLowerCase();
    const match = v === PHRASE;
    cont.disabled = !match;
    msg.textContent = match ? '✓ Phrase matched.' : (v ? `${v.length} / ${PHRASE.length} characters` : '');
    msg.style.color = match ? '#1a7f37' : 'var(--muted,#777)';
    if (match) { input.style.borderColor = '#1a7f37'; }
    else { input.style.borderColor = 'var(--line,#ddd)'; }
  });
  root.querySelector('[data-cancel]').addEventListener('click', () => dismiss(root));
  cont.addEventListener('click', () => { if (!cont.disabled) dismiss(root, showStage3); });
}

function showStage3() {
  const COUNTDOWN = 5;
  const root = buildShell(`
    <div class="prom-onb-card" role="dialog" aria-modal="true" aria-label="Redo Onboarding — confirmation 3 of 3" style="border:2px solid #c43d3d">
      ${dangerHeader('Step 3 of 3 — final')}
      <div class="prom-onb-body">
        <h2 class="prom-onb-title" style="color:#c43d3d">Last chance</h2>
        <p class="prom-onb-caption">
          When you click "Wipe and restart", everything listed earlier will be deleted
          and the app will reload into a fresh onboarding. Cancel any time during the
          countdown.
        </p>
        <div data-countdown style="margin-top:18px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:42px;font-weight:700;color:#c43d3d">${COUNTDOWN}</div>
        <div data-error style="display:none;margin-top:10px;color:#c43d3d;font-size:13px"></div>
      </div>
      <div class="prom-onb-footer" style="border-top-color:rgba(196,61,61,0.2)">
        <div style="font-size:11px;color:var(--muted,#888)">Click Cancel to back out.</div>
        <div class="prom-onb-actions">
          <button class="prom-onb-btn" data-cancel autofocus>Cancel</button>
          <button class="prom-onb-btn" data-wipe disabled style="background:#c43d3d;color:#fff;border-color:#c43d3d">Wipe in ${COUNTDOWN}…</button>
        </div>
      </div>
    </div>
  `);
  const wipeBtn  = root.querySelector('[data-wipe]');
  const cdEl     = root.querySelector('[data-countdown]');
  const errEl    = root.querySelector('[data-error]');
  let n = COUNTDOWN;
  const tick = setInterval(() => {
    n--;
    if (n > 0) {
      cdEl.textContent = String(n);
      wipeBtn.textContent = `Wipe in ${n}…`;
    } else {
      clearInterval(tick);
      cdEl.textContent = 'Ready';
      wipeBtn.disabled = false;
      wipeBtn.textContent = 'Wipe and restart';
    }
  }, 1000);

  root.querySelector('[data-cancel]').addEventListener('click', () => { clearInterval(tick); dismiss(root); });
  wipeBtn.addEventListener('click', async () => {
    if (wipeBtn.disabled) return;
    wipeBtn.disabled = true;
    wipeBtn.textContent = 'Wiping…';
    try {
      const r = await fetch('/api/onboarding/redo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPhrase: PHRASE }),
      });
      if (!r.ok) throw new Error('redo failed: ' + r.status);
      // Reload — the controller will restart at step 1.
      location.reload();
    } catch (e) {
      console.warn('[onboarding] redo failed:', e);
      errEl.style.display = 'block';
      errEl.textContent = 'Redo failed: ' + (e?.message || 'unknown error');
      wipeBtn.disabled = false;
      wipeBtn.textContent = 'Wipe and restart';
    }
  });
}
