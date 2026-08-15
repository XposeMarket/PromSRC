// Keeps the Voice-mode camera shutter visually identical to the canonical
// Prometheus voice orb without changing any of the existing camera controls.
//
// This module is intentionally DOM-safe when imported by Node regression tests:
// the heavier Thinking Orb renderer is loaded only after a browser camera
// shutter actually exists.

const SHUTTER_SELECTOR = '#pm-voice-camera-shutter';
const ORB_CLASS = 'pm-camera-voice-thinking-orb';
const HOST_CLASS = 'pm-camera-thinking-orb-host';
const STYLE_ID = 'pm-mobile-voice-camera-orb-style';

let activeButton = null;
let activeHost = null;
let orbController = null;
let mountGeneration = 0;

function resolveVoiceOrbState() {
  if (typeof document === 'undefined') return 'thinking';

  // Prefer the state emitted by the exact Thinking Orb instance used by the
  // regular Voice control. This avoids guessing from button classes and keeps
  // the camera shutter synchronized with the canonical renderer itself.
  const canonicalState = document.querySelector('#pm-thinking-orb-host .pm-thinking-orb-transition')?.dataset?.state;
  if (canonicalState === 'listening') return 'listening';
  if (canonicalState === 'solving') return 'solving';
  if (canonicalState) return 'thinking';

  // Fallback for the short interval before the canonical orb has mounted.
  const source = document.querySelector('#pm-voice-orb, #pm-voice-mic');
  if (source?.classList?.contains('listening')) return 'listening';
  if (source?.classList?.contains('thinking') || source?.classList?.contains('speaking') || source?.classList?.contains('confirmed')) return 'thinking';
  if (source?.classList?.contains('solving')) return 'solving';
  return 'thinking';
}

function installStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${SHUTTER_SELECTOR}.${ORB_CLASS} {
      position: relative;
      background: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
    }
    ${SHUTTER_SELECTOR}.${ORB_CLASS}::before,
    ${SHUTTER_SELECTOR}.${ORB_CLASS}::after {
      opacity: 0 !important;
    }
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-wave-ambient,
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-wave-line,
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-strands-orb-canvas,
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-glass-glint,
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-voice-fallback,
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .pm-camera-shutter-icon {
      opacity: 0 !important;
      visibility: hidden !important;
    }
    ${SHUTTER_SELECTOR}.${ORB_CLASS} > .${HOST_CLASS} {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 64px;
      height: 64px;
      display: block;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function destroyMountedOrb() {
  mountGeneration += 1;
  try { orbController?.destroy?.(); } catch {}
  orbController = null;
  try { activeButton?.classList?.remove(ORB_CLASS); } catch {}
  try { activeHost?.remove?.(); } catch {}
  activeHost = null;
  activeButton = null;
}

function syncOrbState() {
  try { orbController?.setState?.(resolveVoiceOrbState()); } catch {}
}

async function mountOnButton(button) {
  if (!button || button === activeButton) {
    syncOrbState();
    return;
  }

  destroyMountedOrb();
  activeButton = button;
  const generation = mountGeneration;

  const host = document.createElement('span');
  host.className = HOST_CLASS;
  host.setAttribute('aria-hidden', 'true');
  host.dataset.pmVoiceCameraOrbHost = '1';
  button.appendChild(host);
  activeHost = host;

  try {
    const { mountThinkingOrb } = await import('../vendor/thinking-orb.js');
    if (generation !== mountGeneration || activeButton !== button || !button.isConnected || activeHost !== host) return;
    orbController = mountThinkingOrb(host, {
      state: resolveVoiceOrbState(),
      size: 64,
      theme: 'auto',
    });
    if (!orbController) throw new Error('Thinking Orb renderer unavailable');
    button.classList.add(ORB_CLASS);
  } catch (error) {
    if (generation !== mountGeneration) return;
    console.warn('[mobile voice camera] could not mount canonical voice orb', error);
    try { host.remove(); } catch {}
    activeHost = null;
    activeButton = null;
  }
}

function reconcileVoiceCameraOrb() {
  if (typeof document === 'undefined') return;
  const button = document.querySelector(SHUTTER_SELECTOR);
  if (!button) {
    if (activeButton && !activeButton.isConnected) destroyMountedOrb();
    return;
  }
  if (button !== activeButton) {
    mountOnButton(button);
    return;
  }
  syncOrbState();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reconcileVoiceCameraOrb, { once: true });
  } else {
    reconcileVoiceCameraOrb();
  }

  const observer = new MutationObserver((mutations) => {
    // Voice pages are rebuilt dynamically. Child-list changes find a newly
    // rendered shutter and also catch canonical Thinking Orb state transitions;
    // class changes provide a fallback before that renderer is mounted.
    const relevant = mutations.some((mutation) => {
      if (mutation.type === 'childList') return true;
      const target = mutation.target;
      return target?.id === 'pm-voice-orb' || target?.id === 'pm-voice-mic';
    });
    if (relevant) reconcileVoiceCameraOrb();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}
