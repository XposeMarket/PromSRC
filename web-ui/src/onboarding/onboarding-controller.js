// Onboarding orchestrator.
//
// Production order (first start only):
//   1. model           connect a model inline (Claude one-click, ChatGPT, key, Ollama)
//   2. meet            short meet & greet chat (needs a working model)
//   3. memory_confirm  review what Prom will remember
//   4. tutorial        guided tour of the real UI
//
// Trigger safety: the flow only auto-starts when the server's persisted
// install record says onboarding is unfinished. Restarts, reloads, and
// upgrades never reset that record, existing installs are grandfathered
// server-side, and a single-flight lock prevents double-starts in one tab.
//
// Options:
//   { devTest: true } walks every step but writes no onboarding progress or memory.
//   { skipMigration } kept for the Settings dev-test button (migration is now
//                     offered from Settings › System, not during first start).

import { showTutorial }      from './tutorial-overlay.js';
import { showModelPicker }   from './model-picker.js';
import { showMeetPanel }     from './meet-panel.js';
import { showMemoryConfirm } from './memory-confirm.js';

let running = null;

async function fetchJson(url, init, maxAttempts = 5, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return await r.json();
      if (r.status === 401 || r.status === 402 || r.status === 404) return null;
      lastErr = new Error('status ' + r.status);
    } catch (e) { lastErr = e; }
    await new Promise(res => setTimeout(res, delayMs));
  }
  console.warn('[onboarding] request failed:', url, lastErr);
  return null;
}

function surface() {
  if (document.body.classList.contains('pm-mobile-active')) return 'mobile';
  return window.electronAPI || /Electron/i.test(navigator.userAgent) ? 'electron' : 'web';
}

async function postJson(url, body = {}) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 2, 300);
}

async function runTutorial(opts) {
  if (!opts?.devTest) await postJson('/api/onboarding/tutorial-shown');
  const reason = await showTutorial();
  if (!opts?.devTest) await postJson('/api/onboarding/tutorial-complete', { skipped: reason === 'skipped' });
  return reason;
}

async function runMeetAndGreet() {
  const profile = await showMeetPanel();
  window.__promOnboardingProfile = profile || {};
}

async function runMemoryConfirm(opts) {
  const profile = window.__promOnboardingProfile || {};
  await showMemoryConfirm(profile, { devTest: !!opts?.devTest });
  delete window.__promOnboardingProfile;
}

const DEV_ORDER = ['model', 'meet', 'memory_confirm', 'tutorial', 'done'];

async function runFlow(opts = {}) {
  const status = await fetchJson('/api/onboarding/status?surface=' + surface());
  if (!status) return { ran: false, reason: 'status_unavailable' };

  let current = opts.devTest ? 'model' : status.nextStep;
  if (!current || current === 'done') return { ran: false, reason: 'already_done' };

  document.body.classList.add('prom-onboarding-active');
  let safety = 0;
  try {
    while (current && current !== 'done' && safety++ < 8) {
      if (current === 'model') {
        const reason = await showModelPicker({ devTest: !!opts.devTest });
        // Without a model, meet & greet can't work; dev test jumps to the tour.
        if (opts.devTest && reason !== 'connected') { current = 'tutorial'; continue; }
      }
      else if (current === 'meet')           await runMeetAndGreet(opts);
      else if (current === 'memory_confirm') await runMemoryConfirm(opts);
      else if (current === 'tutorial')       await runTutorial(opts);
      else break;

      if (opts.devTest) {
        current = DEV_ORDER[DEV_ORDER.indexOf(current) + 1] || 'done';
      } else {
        const next = await fetchJson('/api/onboarding/status?surface=' + surface(), undefined, 2, 200);
        if (!next || next.nextStep === current) break; // never loop on a step that didn't persist
        current = next.nextStep;
      }
    }
  } finally {
    document.body.classList.remove('prom-onboarding-active');
  }
  return { ran: true };
}

/** Manual entry point (Settings dev test, redo, console). */
export function runIfNeeded(opts = {}) {
  if (running) return running;
  running = runFlow(opts).finally(() => { running = null; });
  return running;
}

/**
 * Boot entry point. Records the boot (telemetry only) and starts onboarding
 * when the install's persisted record says it is unfinished. Never runs on
 * mobile, in creative render workers, or twice in the same tab.
 */
export async function startOnBoot() {
  if (window.__PROM_CREATIVE_RENDER_CONTEXT?.enabled) return;
  if (document.body.classList.contains('pm-mobile-active')) return;
  if (window.__promOnboardingBootChecked) return;
  window.__promOnboardingBootChecked = true;

  const boot = await postJson('/api/onboarding/boot', { surface: surface() });
  if (!boot || !boot.nextStep || boot.nextStep === 'done') return;
  // Same-tab guard: if this tab already auto-started onboarding (e.g. a
  // soft reload mid-flow), resume from the server state instead of piling up.
  try {
    const key = 'prom.onboarding.autostart.' + (boot.installId || 'local');
    sessionStorage.setItem(key, String(Date.now()));
  } catch {}
  await runIfNeeded();
}

window.OnboardingController = { runIfNeeded, startOnBoot };
