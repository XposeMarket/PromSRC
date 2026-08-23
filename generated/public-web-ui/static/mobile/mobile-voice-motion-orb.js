const VOICE_CONTROL_SELECTOR = '#pm-voice-mic, #pm-voice-orb';
const ORB_HOST_SELECTOR = '#pm-thinking-orb-host';
const MOTION_CLASS = 'pm-orb-device-motion';
const STYLE_ID = 'pm-mobile-voice-motion-style';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const MAX_TILT_X_DEG = 24;
const MAX_TILT_Y_DEG = 30;
const TILT_TRAVEL_X_PX = 13;
const TILT_TRAVEL_Y_PX = 12;
const MAX_TRAVEL_PX = 22;
const MAX_ROTATION_DEG = 7;
const ORIENTATION_CHANGE_EPSILON = 0.004;
const ACCELERATION_NOISE_FLOOR = 0.35;
const ROTATION_RATE_NOISE_FLOOR = 3;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function signedAngleDelta(value, baseline) {
  const next = Number(value) || 0;
  const start = Number(baseline) || 0;
  let delta = (next - start) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function normalizeScreenAngle(angle) {
  const raw = Number(angle) || 0;
  const normalized = ((raw % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return 0;
  if (normalized < 135) return 90;
  if (normalized < 225) return 180;
  return 270;
}

function rotateIntoScreenAxes(x, y, screenAngle) {
  switch (normalizeScreenAngle(screenAngle)) {
    case 90: return { x: y, y: -x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: -y, y: x };
    default: return { x, y };
  }
}

export function mapOrientationDelta(beta, gamma, neutralBeta, neutralGamma, screenAngle = 0) {
  const rawX = signedAngleDelta(gamma, neutralGamma);
  const rawY = signedAngleDelta(beta, neutralBeta);
  const mapped = rotateIntoScreenAxes(rawX, rawY, screenAngle);
  return {
    x: clamp(mapped.x / MAX_TILT_X_DEG, -1, 1),
    y: clamp(mapped.y / MAX_TILT_Y_DEG, -1, 1),
  };
}

export function mapAccelerationToScreen(acceleration = {}, screenAngle = 0) {
  return rotateIntoScreenAxes(
    Number(acceleration?.x) || 0,
    Number(acceleration?.y) || 0,
    screenAngle,
  );
}

export function computeShakeEnergy(acceleration = {}) {
  const x = Number(acceleration?.x) || 0;
  const y = Number(acceleration?.y) || 0;
  const z = Number(acceleration?.z) || 0;
  const magnitude = Math.hypot(x, y, z);
  return clamp((magnitude - 0.7) / 10.5, 0, 1);
}

export function createOrbPhysicsState() {
  return { x: 0, y: 0, vx: 0, vy: 0, rotation: 0, vRotation: 0, shake: 0 };
}

export function isOrbPhysicsSettled(state, input = {}) {
  const current = state || createOrbPhysicsState();
  const tiltX = clamp(input?.tiltX, -1, 1);
  const tiltY = clamp(input?.tiltY, -1, 1);
  const targetX = tiltX * TILT_TRAVEL_X_PX;
  const targetY = tiltY * TILT_TRAVEL_Y_PX;
  const targetRotation = tiltX * MAX_ROTATION_DEG;
  return Math.abs(current.x - targetX) < 0.08
    && Math.abs(current.y - targetY) < 0.08
    && Math.abs(current.rotation - targetRotation) < 0.05
    && Math.abs(current.vx) < 0.15
    && Math.abs(current.vy) < 0.15
    && Math.abs(current.vRotation) < 0.18
    && current.shake < 0.002
    && Math.abs(Number(input?.impulseX) || 0) < 0.01
    && Math.abs(Number(input?.impulseY) || 0) < 0.01
    && Math.abs(Number(input?.rotationImpulse) || 0) < 0.01
    && (Number(input?.shake) || 0) < 0.002;
}

export function stepOrbPhysics(state, input, deltaSeconds) {
  const next = state || createOrbPhysicsState();
  const dt = clamp(deltaSeconds, 1 / 240, 1 / 30);
  const tiltX = clamp(input?.tiltX, -1, 1);
  const tiltY = clamp(input?.tiltY, -1, 1);
  const targetX = tiltX * TILT_TRAVEL_X_PX;
  const targetY = tiltY * TILT_TRAVEL_Y_PX;
  const targetRotation = tiltX * MAX_ROTATION_DEG;
  const spring = 94;
  const damping = 15;
  const rotationSpring = 78;
  const rotationDamping = 14;

  next.vx += ((targetX - next.x) * spring - next.vx * damping) * dt;
  next.vy += ((targetY - next.y) * spring - next.vy * damping) * dt;
  next.vRotation += ((targetRotation - next.rotation) * rotationSpring - next.vRotation * rotationDamping) * dt;

  next.vx += clamp(input?.impulseX, -18, 18) * 5.4;
  next.vy += clamp(input?.impulseY, -18, 18) * 5.4;
  next.vRotation += clamp(input?.rotationImpulse, -180, 180) * 0.055;

  next.x = clamp(next.x + next.vx * dt, -MAX_TRAVEL_PX, MAX_TRAVEL_PX);
  next.y = clamp(next.y + next.vy * dt, -MAX_TRAVEL_PX, MAX_TRAVEL_PX);
  next.rotation = clamp(next.rotation + next.vRotation * dt, -MAX_ROTATION_DEG * 1.6, MAX_ROTATION_DEG * 1.6);
  next.shake = Math.max(clamp(input?.shake, 0, 1), next.shake * Math.exp(-8.5 * dt));
  return next;
}

function currentScreenAngle() {
  if (typeof screen !== 'undefined' && Number.isFinite(Number(screen.orientation?.angle))) {
    return Number(screen.orientation.angle) || 0;
  }
  if (typeof window !== 'undefined' && Number.isFinite(Number(window.orientation))) {
    return Number(window.orientation) || 0;
  }
  return 0;
}

function installStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    body.pm-mobile-active .${MOTION_CLASS} {
      --pm-orb-lift: 0px !important;
    }
    body.pm-mobile-active .${MOTION_CLASS} ${ORB_HOST_SELECTOR} .pm-thinking-orb-transition {
      transform:
        translate3d(var(--pm-orb-motion-x, 0px), var(--pm-orb-motion-y, 0px), 0)
        rotate(var(--pm-orb-motion-rotation, 0deg))
        scale(calc(1 + var(--pm-orb-motion-scale, 0))) !important;
      transform-origin: center;
      transition: none !important;
      will-change: transform;
    }
    @media ${REDUCED_MOTION_QUERY} {
      body.pm-mobile-active .${MOTION_CLASS} ${ORB_HOST_SELECTOR} .pm-thinking-orb-transition {
        transform: none !important;
        will-change: auto;
      }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function supportsReducedMotion() {
  try { return !!window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches; } catch { return false; }
}

function resolveGestureVoiceControl(event) {
  const target = event?.target;
  if (!(target instanceof Element)) return null;
  const control = target.closest(VOICE_CONTROL_SELECTOR);
  if (!control?.querySelector?.(ORB_HOST_SELECTOR)) return null;
  return control;
}

function writeMotionStyles(control, state) {
  if (!control?.isConnected) return;
  control.style.setProperty('--pm-orb-motion-x', `${state.x.toFixed(2)}px`);
  control.style.setProperty('--pm-orb-motion-y', `${state.y.toFixed(2)}px`);
  control.style.setProperty('--pm-orb-motion-rotation', `${state.rotation.toFixed(2)}deg`);
  control.style.setProperty('--pm-orb-motion-scale', (state.shake * 0.024).toFixed(4));
}

function clearMotionStyles(control) {
  if (!control) return;
  control.classList.remove(MOTION_CLASS);
  for (const property of ['--pm-orb-motion-x', '--pm-orb-motion-y', '--pm-orb-motion-rotation', '--pm-orb-motion-scale']) {
    control.style.removeProperty(property);
  }
}

function createBrowserController() {
  let permissionState = 'idle';
  let motionGranted = false;
  let orientationGranted = false;
  let sensorsAttached = false;
  let activeControl = null;
  let activeHost = null;
  let frameId = 0;
  let lastFrameAt = 0;
  let neutral = null;
  let neutralScreenAngle = currentScreenAngle();
  let physics = createOrbPhysicsState();
  const input = { tiltX: 0, tiltY: 0, impulseX: 0, impulseY: 0, rotationImpulse: 0, shake: 0 };

  const resetInput = () => {
    input.tiltX = 0;
    input.tiltY = 0;
    input.impulseX = 0;
    input.impulseY = 0;
    input.rotationImpulse = 0;
    input.shake = 0;
    neutral = null;
    neutralScreenAngle = currentScreenAngle();
  };

  const stopFrame = () => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrameAt = 0;
  };

  const detachSensors = () => {
    if (!sensorsAttached) return;
    sensorsAttached = false;
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
  };

  const deactivate = () => {
    stopFrame();
    detachSensors();
    clearMotionStyles(activeControl);
    activeControl = null;
    activeHost = null;
    physics = createOrbPhysicsState();
    resetInput();
  };

  const drawFrame = (timestamp) => {
    if (!activeControl?.isConnected || !activeHost?.isConnected) {
      deactivate();
      return;
    }
    if (document.visibilityState === 'hidden' || supportsReducedMotion()) {
      frameId = 0;
      lastFrameAt = 0;
      return;
    }
    const delta = lastFrameAt ? (timestamp - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = timestamp;
    physics = stepOrbPhysics(physics, input, delta);
    input.impulseX = 0;
    input.impulseY = 0;
    input.rotationImpulse = 0;
    input.shake = 0;
    writeMotionStyles(activeControl, physics);
    if (isOrbPhysicsSettled(physics, input)) {
      frameId = 0;
      lastFrameAt = 0;
      return;
    }
    frameId = requestAnimationFrame(drawFrame);
  };

  const ensureFrame = () => {
    if (!frameId && activeControl?.isConnected && document.visibilityState !== 'hidden') {
      frameId = requestAnimationFrame(drawFrame);
    }
  };

  function onOrientation(event) {
    if (!activeControl?.isConnected || supportsReducedMotion()) return;
    const beta = Number(event?.beta);
    const gamma = Number(event?.gamma);
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    const screenAngle = currentScreenAngle();
    if (!neutral || normalizeScreenAngle(screenAngle) !== normalizeScreenAngle(neutralScreenAngle)) {
      neutral = { beta, gamma };
      neutralScreenAngle = screenAngle;
      input.tiltX = 0;
      input.tiltY = 0;
      return;
    }
    const mapped = mapOrientationDelta(beta, gamma, neutral.beta, neutral.gamma, screenAngle);
    const changed = Math.abs(mapped.x - input.tiltX) >= ORIENTATION_CHANGE_EPSILON
      || Math.abs(mapped.y - input.tiltY) >= ORIENTATION_CHANGE_EPSILON;
    if (!changed) return;
    input.tiltX = mapped.x;
    input.tiltY = mapped.y;
    ensureFrame();
  }

  function onMotion(event) {
    if (!activeControl?.isConnected || supportsReducedMotion()) return;
    let shouldWake = false;
    const acceleration = event?.acceleration;
    if (acceleration) {
      const mapped = mapAccelerationToScreen(acceleration, currentScreenAngle());
      const impulseX = Math.abs(mapped.x) >= ACCELERATION_NOISE_FLOOR ? clamp(mapped.x, -14, 14) : 0;
      const impulseY = Math.abs(mapped.y) >= ACCELERATION_NOISE_FLOOR ? clamp(-mapped.y, -14, 14) : 0;
      const shake = computeShakeEnergy(acceleration);
      if (impulseX || impulseY || shake > 0) {
        input.impulseX += impulseX;
        input.impulseY += impulseY;
        input.shake = Math.max(input.shake, shake);
        shouldWake = true;
      }
    }
    const rotationRate = event?.rotationRate;
    if (rotationRate) {
      const rotationImpulse = Number(rotationRate.gamma ?? rotationRate.alpha) || 0;
      if (Math.abs(rotationImpulse) >= ROTATION_RATE_NOISE_FLOOR) {
        input.rotationImpulse += rotationImpulse;
        shouldWake = true;
      }
    }
    if (shouldWake) ensureFrame();
  }

  const attachSensors = () => {
    if (sensorsAttached || !activeControl?.isConnected || document.visibilityState === 'hidden') return;
    if (!motionGranted && !orientationGranted) return;
    if (orientationGranted) window.addEventListener('deviceorientation', onOrientation, { passive: true });
    if (motionGranted) window.addEventListener('devicemotion', onMotion, { passive: true });
    sensorsAttached = true;
    activeControl.classList.add(MOTION_CLASS);
    ensureFrame();
  };

  const activate = (control) => {
    if (!control?.isConnected) return;
    if (activeControl !== control) {
      clearMotionStyles(activeControl);
      activeControl = control;
      activeHost = control.querySelector(ORB_HOST_SELECTOR);
      physics = createOrbPhysicsState();
      resetInput();
    }
    if (permissionState === 'granted') attachSensors();
  };

  const requestPermission = (EventType) => {
    if (!EventType) return Promise.resolve(false);
    if (typeof EventType.requestPermission !== 'function') return Promise.resolve(true);
    try {
      return Promise.resolve(EventType.requestPermission()).then((value) => value === 'granted').catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  };

  const requestPermissionsFromGesture = (control) => {
    activate(control);
    if (supportsReducedMotion() || permissionState === 'denied') return;
    if (permissionState === 'granted') {
      attachSensors();
      return;
    }
    if (permissionState === 'requesting') return;
    permissionState = 'requesting';
    const motionPromise = requestPermission(window.DeviceMotionEvent);
    const orientationPromise = requestPermission(window.DeviceOrientationEvent);
    Promise.all([motionPromise, orientationPromise]).then(([motionOk, orientationOk]) => {
      motionGranted = motionOk;
      orientationGranted = orientationOk;
      permissionState = motionOk || orientationOk ? 'granted' : 'denied';
      if (permissionState === 'granted' && activeControl?.isConnected) attachSensors();
      else clearMotionStyles(activeControl);
    });
  };

  const handleGesture = (event) => {
    const control = resolveGestureVoiceControl(event);
    if (control) requestPermissionsFromGesture(control);
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      detachSensors();
      stopFrame();
      return;
    }
    if (activeControl?.isConnected && permissionState === 'granted') {
      attachSensors();
      ensureFrame();
    }
  };

  // WebKit grants transient activation for a finger on pointerup/touchend,
  // not pointerdown/touchstart. Request sensor access at gesture completion.
  document.addEventListener('pointerup', handleGesture, { capture: true, passive: true });
  document.addEventListener('touchend', handleGesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', handleVisibility);

  return {
    destroy() {
      document.removeEventListener('pointerup', handleGesture, true);
      document.removeEventListener('touchend', handleGesture, true);
      document.removeEventListener('visibilitychange', handleVisibility);
      deactivate();
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installStyles();
  window.__PROM_MOBILE_VOICE_MOTION = createBrowserController();
}
