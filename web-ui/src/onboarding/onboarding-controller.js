// Onboarding orchestrator. Reads /api/onboarding/status, decides which step to
// show, and runs the matching UI.
//
// Options:
//   { devTest: true } — runs the flow against the user's real onboarding state
//   but blocks any persistent memory writes during the memory-confirm step.
//   The Dev Test button uses this so internal flow checks can't pollute the
//   user's actual workspace.

import { showTutorial }    from './tutorial-overlay.js';
import { showMigrationPanel } from './migration-panel.js';
import { showModelPicker } from './model-picker.js';
import { showMeetPanel }   from './meet-panel.js';
import { showMemoryConfirm } from './memory-confirm.js';

async function fetchStatusWithRetry(maxAttempts = 5, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch('/api/onboarding/status');
      if (r.ok) return await r.json();
      if (r.status === 401 || r.status === 402) return null;
      lastErr = new Error('status ' + r.status);
    } catch (e) { lastErr = e; }
    await new Promise(res => setTimeout(res, delayMs));
  }
  console.warn('[onboarding] could not fetch status:', lastErr);
  return null;
}

async function postJson(url, body = {}) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('status ' + r.status);
    return await r.json();
  } catch (e) {
    console.warn('[onboarding] POST', url, 'failed:', e);
    return null;
  }
}

async function runTutorial(opts) {
  if (!opts?.devTest) await postJson('/api/onboarding/tutorial-shown');
  const reason = await showTutorial();
  if (!opts?.devTest) await postJson('/api/onboarding/tutorial-complete');
  return reason;
}

async function runModelSetup(_opts) {
  await showModelPicker();
}

async function runMigration(opts) {
  await showMigrationPanel(opts);
}

async function runMeetAndGreet(_opts) {
  const profile = await showMeetPanel();
  window.__promOnboardingProfile = profile || {};
}

async function runMemoryConfirm(opts) {
  const profile = window.__promOnboardingProfile || {};
  await showMemoryConfirm(profile, { devTest: !!opts?.devTest });
  delete window.__promOnboardingProfile;
}

export async function runIfNeeded(opts = {}) {
  const status = await fetchStatusWithRetry();
  if (!status) return;

  // In dev test mode we always start from the tutorial so the operator sees
  // the full visual flow regardless of where the user actually is.
  let current = opts.devTest ? 'tutorial' : status.nextStep;
  let safety = 0;
  while (current && current !== 'done' && safety++ < 8) {
    if      (current === 'tutorial')        await runTutorial(opts);
    else if (current === 'migration')       await runMigration(opts);
    else if (current === 'model')           await runModelSetup(opts);
    else if (current === 'meet')            await runMeetAndGreet(opts);
    else if (current === 'memory_confirm')  { await runMemoryConfirm(opts); break; }
    else break;

    if (opts.devTest) {
      // Walk the static sequence in dev test mode so we never miss a step
      // (status flags stay untouched, so we can't rely on the server to
      // advance us).
      const order = ['tutorial', 'migration', 'model', 'meet', 'memory_confirm', 'done'];
      const idx = order.indexOf(current);
      current = order[idx + 1] || 'done';
    } else {
      const next = await fetchStatusWithRetry(2, 200);
      if (!next) break;
      current = next.nextStep;
    }
  }
}

window.OnboardingController = { runIfNeeded };
