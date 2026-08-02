const IOS_HAPTICS_POLYFILL = 'https://esm.sh/ios-vibrator-pro-max@3.0.3?bundle';
const polyfillReady = import(IOS_HAPTICS_POLYFILL);
const state = { reasoning: 3, flashlight: 52 };

const reasoningLevels = ['Quick', 'Light', 'Focused', 'Balanced', 'Deep', 'Thorough', 'Max'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function logEvent(message, kind = 'selection') {
  const status = $('#eventStatus');
  const time = $('#eventTime');
  if (status) status.textContent = `${message} · ${kind}`;
  if (time) time.textContent = new Date().toLocaleTimeString([], { hour12: false });
}

function vibrate(pattern = 10) {
  // The official ios-vibrator-pro-max polyfill replaces this method on iOS
  // Safari. Keeping the call inside the trusted click/pointer handlers is
  // what lets the polyfill translate the interaction into native haptics.
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported browsers stay usable as a visual interaction trace.
  }
}

function installPointerSlider(surface, valueFromPointer, applyValue, { ignoreButtons = false } = {}) {
  let activePointer = null;

  const isPrimaryPointer = (event) => event.pointerType !== 'mouse' || event.button === 0;
  const isIgnoredTarget = (event) => ignoreButtons && event.target.closest('button');

  const finish = (event, cancelled = false) => {
    if (activePointer !== event.pointerId) return;
    if (!cancelled) applyValue(valueFromPointer(event), false);
    try { surface.releasePointerCapture(activePointer); } catch {}
    activePointer = null;
    surface.classList.remove('is-dragging');
  };

  surface.addEventListener('pointerdown', (event) => {
    if (!isPrimaryPointer(event) || activePointer !== null || isIgnoredTarget(event)) return;
    activePointer = event.pointerId;
    surface.classList.add('is-dragging');
    try { surface.setPointerCapture(activePointer); } catch {}
    applyValue(valueFromPointer(event), true);
  });

  surface.addEventListener('pointermove', (event) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    applyValue(valueFromPointer(event), true);
  }, { passive: false });

  surface.addEventListener('pointerup', (event) => finish(event));
  surface.addEventListener('pointercancel', (event) => finish(event, true));
  surface.addEventListener('lostpointercapture', (event) => {
    if (activePointer === event.pointerId) finish(event, true);
  });
}

function setReasoning(index, { tactile = true, log = true } = {}) {
  const next = Math.max(0, Math.min(reasoningLevels.length - 1, Number(index) || 0));
  const previous = state.reasoning;
  state.reasoning = next;
  const progress = next / (reasoningLevels.length - 1);
  const slider = $('#reasoningSlider');
  slider?.style.setProperty('--progress', progress);
  slider?.style.setProperty('--index', next);
  slider?.setAttribute('aria-valuenow', String(next));
  slider?.setAttribute('aria-valuetext', reasoningLevels[next]);
  $('#reasoningValue').textContent = reasoningLevels[next];
  $('#reasoningIndex').textContent = `${String(next + 1).padStart(2, '0')} / ${String(reasoningLevels.length).padStart(2, '0')}`;
  $$('.reasoning-steps button').forEach((button, i) => {
    button.classList.toggle('is-filled', i <= next);
    button.classList.toggle('is-active', i === next);
  });

  if (tactile && next !== previous) {
    const direction = next > previous ? 1 : -1;
    for (let tick = previous + direction; tick !== next + direction; tick += direction) {
      vibrate(8);
    }
    if (log) logEvent(`Reasoning → ${reasoningLevels[next]}`, `${Math.abs(next - previous)} step${Math.abs(next - previous) === 1 ? '' : 's'}`);
  }
}

function reasoningFromPointer(event) {
  const slider = $('#reasoningSlider');
  const rect = slider.getBoundingClientRect();
  if (!rect.width) return state.reasoning;
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(fraction * (reasoningLevels.length - 1));
}

function installReasoningSlider() {
  const slider = $('#reasoningSlider');
  installPointerSlider(
    slider,
    reasoningFromPointer,
    (value, tactile) => setReasoning(value, { tactile }),
    { ignoreButtons: true },
  );

  slider.addEventListener('keydown', (event) => {
    const keys = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, Home: -state.reasoning, End: reasoningLevels.length - 1 - state.reasoning };
    if (!(event.key in keys)) return;
    event.preventDefault();
    setReasoning(state.reasoning + keys[event.key]);
  });

  $$('.reasoning-steps button').forEach((button) => button.addEventListener('click', () => {
    setReasoning(button.dataset.index);
  }));

  setReasoning(state.reasoning, { tactile: false });
}

function setFlashlight(value, { tactile = true, log = true } = {}) {
  const next = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const previous = state.flashlight;
  state.flashlight = next;
  const slider = $('#flashlightSlider');
  slider?.style.setProperty('--progress', next / 100);
  slider?.setAttribute('aria-valuenow', String(next));
  slider?.setAttribute('aria-valuetext', `${next} percent`);
  $('#flashlightValue').textContent = String(next);

  const stage = $('.flashlight-stage');
  const power = next / 100;
  stage?.style.setProperty('--light-power', String(power));
  stage?.style.setProperty('--light-opacity', String(0.16 + power * 0.68));
  stage?.style.setProperty('--light-scale', String(0.9 + power * 0.16));

  if (tactile && Math.abs(next - previous) >= 3) {
    vibrate(6);
    if (log) logEvent(`Flashlight → ${next}%`, 'selection pulse');
  }
}

function flashlightFromPointer(event) {
  const slider = $('#flashlightSlider');
  const rect = slider.getBoundingClientRect();
  if (!rect.height) return state.flashlight;
  const fraction = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return fraction * 100;
}

function installFlashlightSlider() {
  const slider = $('#flashlightSlider');
  installPointerSlider(
    slider,
    flashlightFromPointer,
    (value, tactile) => setFlashlight(value, { tactile }),
  );

  slider.addEventListener('keydown', (event) => {
    const keys = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, Home: -state.flashlight, End: 100 - state.flashlight };
    if (!(event.key in keys)) return;
    event.preventDefault();
    setFlashlight(state.flashlight + keys[event.key]);
  });

  setFlashlight(state.flashlight, { tactile: false });
}

function installHapticsArm() {
  const button = $('#armHaptics');
  const status = $('#armStatus');
  if (!button) return;
  button.addEventListener('click', () => {
    vibrate(28);
    button.textContent = 'Haptics armed';
    button.classList.add('is-armed');
    if (status) status.textContent = 'Ready. Now tap buttons or drag slowly across either slider.';
    logEvent('Haptics armed', 'trusted tap');
  });
}

function installButtons() {
  $$('.haptic-button').forEach((button) => {
    button.addEventListener('pointerdown', () => button.classList.add('is-pressed'));
    const release = () => button.classList.remove('is-pressed');
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('click', () => {
      const pattern = button.dataset.pattern;
      if (pattern === 'success') vibrate([8, 55, 13]);
      else vibrate(pattern === 'medium' ? 18 : pattern === 'light' ? 10 : 7);
      const label = $('b', button)?.textContent || 'Button';
      logEvent(`${label} pressed`, pattern === 'success' ? 'double pulse' : 'impact');
    });
  });
}

function installCopyButtons() {
  $$('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      const text = target?.textContent?.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const original = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = original; }, 1200);
        logEvent('Haptic helper copied', 'clipboard unavailable');
      } catch {
        logEvent('Select the snippet to copy it', 'clipboard unavailable');
      }
    });
  });
}

function detectSupport() {
  const label = $('#supportLabel');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) label.textContent = 'iOS Safari polyfill loaded';
  else if ('vibrate' in navigator) label.textContent = 'Desktop API · no actuator';
  else label.textContent = 'Visual trace · no actuator';
}

polyfillReady
  .then(() => {
    document.documentElement.dataset.hapticsPolyfill = 'ready';
    detectSupport();
  })
  .catch((error) => {
    console.warn('iOS haptics polyfill could not load; native API fallback remains available.', error);
    document.documentElement.dataset.hapticsPolyfill = 'unavailable';
    detectSupport();
  });

detectSupport();
installReasoningSlider();
installFlashlightSlider();
installHapticsArm();
installButtons();
installCopyButtons();
