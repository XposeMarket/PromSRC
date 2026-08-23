// Contract coverage for mobile-only device motion; keep this deterministic and browser-independent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeShakeEnergy,
  createOrbPhysicsState,
  isOrbPhysicsSettled,
  mapAccelerationToScreen,
  mapOrientationDelta,
  signedAngleDelta,
  stepOrbPhysics,
} from '../web-ui/src/mobile/mobile-voice-motion-orb.js';

assert.equal(signedAngleDelta(-179, 179), 2, 'angle deltas should cross the ±180° seam cleanly');
assert.deepEqual(
  mapOrientationDelta(10, 20, 10, 20, 0),
  { x: 0, y: 0 },
  'the permission-time pose should be a stable neutral position',
);

const portraitTilt = mapOrientationDelta(25, 32, 10, 20, 0);
assert.ok(portraitTilt.x > 0 && portraitTilt.y > 0, 'portrait tilt should map into both screen axes');
const landscapeAcceleration = mapAccelerationToScreen({ x: 3, y: 7 }, 90);
assert.deepEqual(landscapeAcceleration, { x: 7, y: -3 }, 'sensor axes should rotate with the screen');
assert.equal(computeShakeEnergy({ x: 0.1, y: 0.1, z: 0.1 }), 0, 'tiny sensor noise should not move the orb');
assert.ok(computeShakeEnergy({ x: 10, y: 0, z: 0 }) > 0.8, 'a real shake should create a strong impulse');

let physics = createOrbPhysicsState();
assert.equal(isOrbPhysicsSettled(physics, { tiltX: 0, tiltY: 0 }), true, 'an untouched neutral orb should not keep an animation frame alive');
for (let i = 0; i < 15; i += 1) {
  physics = stepOrbPhysics(physics, {
    tiltX: 1,
    tiltY: 0,
    impulseX: i === 0 ? 8 : 0,
    impulseY: 0,
    rotationImpulse: i === 0 ? 80 : 0,
    shake: i === 0 ? 1 : 0,
  }, 1 / 60);
}
assert.ok(physics.x > 0, 'tilt and a rightward shake should move the orb right');
assert.ok(Math.abs(physics.x) <= 22, 'physics should remain inside the visual travel bound');
assert.ok(Math.abs(physics.rotation) <= 11.2, 'rotation should remain bounded');
assert.ok(physics.shake < 1, 'shake scale should decay instead of sticking');
assert.equal(isOrbPhysicsSettled(physics, { tiltX: 1, tiltY: 0 }), false, 'an orb with residual spring energy should keep animating');
for (let i = 0; i < 240; i += 1) {
  physics = stepOrbPhysics(physics, { tiltX: 1, tiltY: 0 }, 1 / 60);
}
assert.equal(isOrbPhysicsSettled(physics, { tiltX: 1, tiltY: 0 }), true, 'settled spring physics should release the requestAnimationFrame loop');

const motionSource = readFileSync(new URL('../web-ui/src/mobile/mobile-voice-motion-orb.js', import.meta.url), 'utf8');
assert.match(motionSource, /addEventListener\('pointerup', handleGesture/, 'touch pointerup must request iOS motion permission');
assert.match(motionSource, /addEventListener\('touchend', handleGesture/, 'touchend must request iOS motion permission');
assert.doesNotMatch(motionSource, /addEventListener\('touchstart', handleGesture/, 'touchstart is not a WebKit transient-activation event');
const voicePageSource = readFileSync(new URL('../web-ui/src/mobile/mobile-voice-page.js', import.meta.url), 'utf8');
assert.match(voicePageSource, /size: 64, theme: 'auto', speed: 0\.5/, 'mobile Voice orb should run its autonomous animation at half speed');

console.log('mobile voice motion orb contract: ok');
