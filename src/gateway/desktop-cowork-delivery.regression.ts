import assert from 'node:assert/strict';
import {
  DesktopBackgroundDeliveryNoopError,
  DesktopBackgroundDeliveryUnsupportedError,
  hasStrongBackgroundTarget,
  normalizeDesktopDeliveryMode,
  normalizeDesktopDeliveryTarget,
  runDesktopDeliveryWithFallback,
} from './desktop-cowork-delivery.js';

async function main(): Promise<void> {
  assert.equal(normalizeDesktopDeliveryMode(undefined), 'background');
  assert.equal(normalizeDesktopDeliveryMode('foreground'), 'foreground');
  assert.equal(hasStrongBackgroundTarget({ pid: 1234 }), true);
  assert.equal(hasStrongBackgroundTarget({ windowHandle: 44 }), true);
  assert.equal(hasStrongBackgroundTarget({ title: 'Calculator' }), false);
  assert.equal(hasStrongBackgroundTarget({ pid: 0 }), false);
  assert.equal(hasStrongBackgroundTarget({ pid: -3 }), false);
  assert.equal(hasStrongBackgroundTarget({ windowHandle: 0 }), false);
  assert.deepEqual(normalizeDesktopDeliveryTarget({ pid: -1, windowHandle: 0, title: ' X ' }), { title: 'X' });

  let backgroundCalls = 0;
  let foregroundCalls = 0;
  const background = await runDesktopDeliveryWithFallback({
    request: { requestedMode: 'background', target: { pid: 99, windowHandle: 7 } },
    background: async () => {
      backgroundCalls++;
      return { value: 'ok', verified: true, verification: 'target changed' };
    },
    foreground: async () => {
      foregroundCalls++;
      return { value: 'fallback', verified: true };
    },
  });
  assert.equal(background.value, 'ok');
  assert.equal(background.delivery.deliveredMode, 'background');
  assert.equal(background.delivery.cursorDisturbed, false);
  assert.equal(background.delivery.focusDisturbed, false);
  assert.equal(backgroundCalls, 1);
  assert.equal(foregroundCalls, 0);

  const fallback = await runDesktopDeliveryWithFallback({
    request: { requestedMode: 'background', target: { pid: 100 } },
    background: async () => {
      throw new DesktopBackgroundDeliveryNoopError('unchanged screenshot');
    },
    foreground: async () => ({ value: 'foreground-ok', verified: true }),
  });
  assert.equal(fallback.value, 'foreground-ok');
  assert.equal(fallback.delivery.backgroundAttempted, true);
  assert.equal(fallback.delivery.foregroundFallbackUsed, true);
  assert.equal(fallback.delivery.cursorDisturbed, true);
  assert.equal(fallback.delivery.focusDisturbed, true);

  // A background API returning successfully is not enough. The target must be
  // positively verified or the foreground compatibility path is used.
  const unverified = await runDesktopDeliveryWithFallback({
    request: { target: { windowHandle: 222 } },
    background: async () => ({ value: 'posted-but-unverified' }),
    foreground: async () => ({
      value: 'verified-foreground',
      verified: true,
      cursorDisturbed: false,
      focusDisturbed: true,
    }),
  });
  assert.equal(unverified.value, 'verified-foreground');
  assert.equal(unverified.delivery.foregroundFallbackUsed, true);
  assert.equal(unverified.delivery.cursorDisturbed, false);
  assert.equal(unverified.delivery.focusDisturbed, true);

  const weakTarget = await runDesktopDeliveryWithFallback({
    request: { requestedMode: 'background', target: { title: 'ambiguous' } },
    background: async () => ({ value: 'should-not-run', verified: true }),
    foreground: async () => ({ value: 'compat', verified: true }),
  });
  assert.equal(weakTarget.value, 'compat');
  assert.equal(weakTarget.delivery.backgroundAttempted, false);
  assert.equal(weakTarget.delivery.foregroundFallbackUsed, true);

  await assert.rejects(
    () => runDesktopDeliveryWithFallback({
      request: { requestedMode: 'background', target: { title: 'ambiguous' }, allowForegroundFallback: false },
      background: async () => ({ value: 'nope', verified: true }),
      foreground: async () => ({ value: 'nope', verified: true }),
    }),
    DesktopBackgroundDeliveryUnsupportedError,
  );

  // Arbitrary execution failures must not silently become foreground takeover.
  let arbitraryFallbackCalls = 0;
  await assert.rejects(
    () => runDesktopDeliveryWithFallback({
      request: { target: { pid: 55 } },
      background: async () => { throw new Error('permission denied'); },
      foreground: async () => {
        arbitraryFallbackCalls++;
        return { value: 'unsafe', verified: true };
      },
    }),
    /permission denied/,
  );
  assert.equal(arbitraryFallbackCalls, 0);

  const explicitForeground = await runDesktopDeliveryWithFallback({
    request: { requestedMode: 'foreground', target: { pid: 101 } },
    background: async () => ({ value: 'wrong', verified: true }),
    foreground: async () => ({
      value: 'foreground',
      verified: true,
      cursorDisturbed: false,
      focusDisturbed: true,
    }),
  });
  assert.equal(explicitForeground.delivery.deliveredMode, 'foreground');
  assert.equal(explicitForeground.delivery.backgroundAttempted, false);
  assert.equal(explicitForeground.delivery.foregroundFallbackUsed, false);
  assert.equal(explicitForeground.delivery.cursorDisturbed, false);
  assert.equal(explicitForeground.delivery.focusDisturbed, true);

  console.log('desktop co-work delivery regression passed');
}

void main();
