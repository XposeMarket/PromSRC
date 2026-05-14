/**
 * HyperFrames preview iframe host (parent side of the bridge).
 *
 * Hosts a sandboxed same-origin iframe that runs the official @hyperframes/core
 * runtime IIFE (injected by src/gateway/creative/hyperframes-bridge.ts:
 * wrapForIframePreview). Communicates with the runtime via postMessage using
 * the documented protocol:
 *
 *   parent  -> iframe : { source: 'hf-parent',  action, payload }
 *   iframe  -> parent : { source: 'hf-preview', type,   payload }
 *
 * Supported actions (from HYPERFRAME_CONTROL_ACTIONS):
 *   'play' | 'pause' | 'seek' | 'set-muted' | 'set-playback-rate'
 *   | 'enable-pick-mode' | 'disable-pick-mode'
 *
 * Beyond playback, the runtime exposes window.__HF_PICKER_API for hit-testing
 * (returns HyperframePickerElementInfo records with selectors + bounding boxes).
 *
 * Usage:
 *   const preview = createHyperframesPreview({
 *     mount: document.querySelector('#preview'),
 *     html: wrappedHtmlMotion,
 *     onPick:    (info) => console.log('picked', info),
 *     onReady:   ()     => preview.seek(0),
 *     onMessage: (msg)  => {},
 *   });
 *   preview.seek(1500);
 *   preview.enablePickMode();
 *   preview.dispose();
 */

const HF_PARENT = 'hf-parent';
const HF_PREVIEW = 'hf-preview';

export function createHyperframesPreview(options = {}) {
  const {
    mount,
    html = '',
    sandbox = 'allow-scripts allow-same-origin',
    width,
    height,
    onPick = () => {},
    onReady = () => {},
    onTime = () => {},
    onError = () => {},
    onMessage = () => {},
  } = options;

  if (!mount || !mount.appendChild) {
    throw new Error('createHyperframesPreview: options.mount must be a DOM element');
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', sandbox);
  iframe.style.border = '0';
  iframe.style.background = 'transparent';
  iframe.style.display = 'block';
  if (width) iframe.style.width = typeof width === 'number' ? `${width}px` : String(width);
  if (height) iframe.style.height = typeof height === 'number' ? `${height}px` : String(height);
  iframe.srcdoc = String(html || '');
  mount.appendChild(iframe);

  let ready = false;
  let pendingActions = [];

  function post(action, payload) {
    const message = { source: HF_PARENT, action, payload: payload || {} };
    if (!ready || !iframe.contentWindow) {
      pendingActions.push(message);
      return;
    }
    iframe.contentWindow.postMessage(message, '*');
  }

  function flushPending() {
    if (!iframe.contentWindow) return;
    const queue = pendingActions;
    pendingActions = [];
    for (const message of queue) iframe.contentWindow.postMessage(message, '*');
  }

  function handleMessage(event) {
    if (!event || !event.data || event.data.source !== HF_PREVIEW) return;
    if (event.source && iframe.contentWindow && event.source !== iframe.contentWindow) return;
    const { type, payload } = event.data;
    try {
      onMessage(event.data);
      if (type === 'ready') {
        ready = true;
        flushPending();
        onReady(payload);
      } else if (type === 'time') {
        onTime(payload);
      } else if (type === 'pick' || type === 'picked') {
        onPick(payload);
      } else if (type === 'error') {
        onError(payload);
      }
    } catch (err) {
      console.error('HyperFrames preview message handler failed', err);
    }
  }

  window.addEventListener('message', handleMessage);

  // Some runtimes don't post a 'ready' until after load; treat iframe load as
  // a fallback readiness signal so seek/pick still work even if the runtime
  // never broadcasts.
  iframe.addEventListener('load', () => {
    if (!ready) {
      ready = true;
      flushPending();
      onReady({ via: 'iframe-load' });
    }
  });

  return {
    iframe,
    isReady: () => ready,
    play: () => post('play'),
    pause: () => post('pause'),
    seek: (timeMs) => post('seek', { timeMs: Number(timeMs) || 0 }),
    setMuted: (muted) => post('set-muted', { muted: !!muted }),
    setPlaybackRate: (rate) => post('set-playback-rate', { rate: Number(rate) || 1 }),
    enablePickMode: () => post('enable-pick-mode'),
    disablePickMode: () => post('disable-pick-mode'),
    /**
     * Direct access to __HF_PICKER_API inside the iframe. Only safe when the
     * iframe is same-origin (i.e. sandbox includes 'allow-same-origin').
     */
    pickerApi() {
      try {
        return iframe.contentWindow && iframe.contentWindow.__HF_PICKER_API
          ? iframe.contentWindow.__HF_PICKER_API
          : null;
      } catch {
        return null;
      }
    },
    /**
     * Synchronous hit-test against the picker API. Returns null if the
     * iframe is cross-origin or the runtime has not loaded.
     */
    pickAtPoint(clientX, clientY, index = 0) {
      const api = this.pickerApi();
      if (!api) return null;
      try {
        return api.pickAtPoint(clientX, clientY, index) || null;
      } catch {
        return null;
      }
    },
    /**
     * Replace the loaded composition. Resets readiness.
     */
    setHtml(nextHtml) {
      ready = false;
      pendingActions = [];
      iframe.srcdoc = String(nextHtml || '');
    },
    dispose() {
      window.removeEventListener('message', handleMessage);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    },
  };
}
