let hiddenSwitch = null;

function ensureHiddenSwitch() {
  if (hiddenSwitch?.isConnected) return hiddenSwitch;
  hiddenSwitch = document.createElement('input');
  hiddenSwitch.type = 'checkbox';
  hiddenSwitch.setAttribute('switch', '');
  hiddenSwitch.setAttribute('aria-hidden', 'true');
  hiddenSwitch.tabIndex = -1;
  hiddenSwitch.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(hiddenSwitch);
  return hiddenSwitch;
}

export function mobileV2Haptic(strength = 10) {
  try { if (navigator.vibrate) navigator.vibrate(strength); } catch {}
  try {
    const input = ensureHiddenSwitch();
    input.click?.();
    input.checked = !input.checked;
  } catch {}
}

export function attachMobileV2HapticGestureSurface(surface, handlers = {}) {
  if (!surface || typeof document === 'undefined') return () => {};

  const proxy = document.createElement('label');
  const input = document.createElement('input');
  proxy.className = 'pm-haptic-gesture-surface pm-tabbar-haptic-gesture-surface';
  proxy.dataset.pmV2Owner = 'tabbar';
  proxy.setAttribute('aria-hidden', 'true');
  proxy.tabIndex = -1;
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.className = 'pm-haptic-gesture-input';
  input.style.cssText = [
    'all:revert', 'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'margin:0', 'opacity:0', 'touch-action:none',
  ].join(';');
  proxy.appendChild(input);
  proxy.style.cssText = [
    'all:unset', 'position:fixed', 'z-index:31', 'overflow:hidden', 'opacity:0',
    'pointer-events:auto', 'touch-action:none', 'border-radius:999px',
  ].join(';');

  let pointerId = null;
  let flippedDirection = false;
  let disposed = false;

  const position = (event, compact = false) => {
    const rect = surface.getBoundingClientRect?.();
    if (!compact && rect && rect.width > 0 && rect.height > 0) {
      proxy.style.left = `${rect.left}px`;
      proxy.style.top = `${rect.top}px`;
      proxy.style.width = `${rect.width}px`;
      proxy.style.height = `${rect.height}px`;
      return;
    }
    const width = 70;
    const height = 31;
    const x = Number(event?.clientX || 0);
    const y = Number(event?.clientY || 0);
    proxy.style.left = `${x - width / 2}px`;
    proxy.style.top = `${y - height / 2}px`;
    proxy.style.width = `${width}px`;
    proxy.style.height = `${height}px`;
  };

  const nativeTick = (event, compact = true) => {
    if (disposed || pointerId == null) return;
    flippedDirection = !flippedDirection;
    input.style.direction = flippedDirection ? 'rtl' : 'ltr';
    position(event, compact);
    mobileV2Haptic(8);
  };

  const finish = (event, cancelled = false) => {
    if (pointerId == null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    try { input.releasePointerCapture?.(pointerId); } catch {}
    const callback = cancelled ? handlers.onPointerCancel : handlers.onPointerUp;
    try { callback?.(event, { requestNativeHaptic: () => nativeTick(event) }); } catch {}
    pointerId = null;
    flippedDirection = false;
    input.checked = false;
    if (!disposed) position(null, false);
  };

  input.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointerId != null) return;
    pointerId = event.pointerId;
    position(event, false);
    try { input.setPointerCapture?.(pointerId); } catch {}
    let tick = false;
    handlers.onPointerDown?.(event, { requestNativeHaptic: () => { tick = true; } });
    if (tick) nativeTick(event, false);
  }, true);
  input.addEventListener('pointermove', (event) => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    let tick = false;
    handlers.onPointerMove?.(event, { requestNativeHaptic: () => { tick = true; } });
    if (handlers.nativeHapticsOnMove !== false || tick) nativeTick(event, true);
    else position(event, true);
  }, true);
  input.addEventListener('pointerup', (event) => finish(event, false), true);
  input.addEventListener('pointercancel', (event) => finish(event, true), true);
  proxy.addEventListener('click', (event) => event.stopPropagation(), true);

  document.body.appendChild(proxy);
  position(null, false);
  const refresh = () => { if (!disposed) position(null, false); };
  window.addEventListener('resize', refresh, { passive: true });

  return () => {
    disposed = true;
    window.removeEventListener('resize', refresh);
    proxy.remove();
  };
}
