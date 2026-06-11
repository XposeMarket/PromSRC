#!/usr/bin/env node
// End-to-end test of the macOS routing: Node -> DarwinBackend -> Swift helper.
// Run after `npm run build:backend` (or `npx tsc`) so dist/ is current.
//   node native/desktop-helper-macos/e2e-test.cjs
const path = require('path');
const dist = path.resolve(__dirname, '../../dist/gateway');

(async () => {
  const { getPlatformDesktopBackend } = require(path.join(dist, 'desktop-platform.js'));
  const backend = getPlatformDesktopBackend();
  console.log('platform:', backend.platform);

  // 1. Permissions (no grant needed to query).
  const perms = await backend.checkPermissions();
  console.log('permissions:', JSON.stringify(perms));

  // 2. Monitors (no permission needed).
  const monitors = await backend.enumerateMonitors();
  console.log('monitors:', JSON.stringify(monitors));

  // 3. Context (no permission needed).
  const ctx = await backend.gatherContext();
  console.log('windows:', ctx.windows.length, 'active:', ctx.activeWindow ? ctx.activeWindow.title : '(none)');

  // 4. Capture (needs Screen Recording). Expect either a PNG or a clean
  //    permission error — both prove the path works end to end.
  try {
    const cap = await backend.capture({ kind: 'primary' });
    console.log('capture OK:', cap.png.length, 'bytes, dpr', cap.devicePixelRatio, 'bounds', JSON.stringify(cap.bounds));
  } catch (e) {
    console.log('capture error (expected if Screen Recording not granted):', e.message);
  }

  if (backend.dispose) backend.dispose();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
