/**
 * test-ui-action-policy.mjs — table tests for the UI action confirmation taxonomy.
 * Run after `npm run build:backend`:
 *   node scripts/test-ui-action-policy.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const { evaluateUiActionRisk } = await import(pathToFileURL(path.join(repoRoot, 'dist/gateway/ui-action-policy.js')).href);

let failed = false;
const check = (label, ctx, expectedMode) => {
  const d = evaluateUiActionRisk(ctx);
  if (d.mode !== expectedMode) {
    failed = true;
    console.error(`FAIL: ${label} → expected ${expectedMode}, got ${d.mode} (${d.actionKind})`);
  } else {
    console.log(`PASS: ${label} → ${d.mode} (${d.actionKind})`);
  }
};

check('screenshot is allowed', { surface: 'desktop', toolName: 'desktop_screenshot', intent: 'capture screen' }, 'allow');
check('list windows is allowed', { surface: 'desktop', toolName: 'desktop_list_windows' }, 'allow');
check('ordinary click is allowed', { surface: 'desktop', toolName: 'desktop_window_click', intent: 'click the settings gear' }, 'allow');
check('final submit needs confirm', { surface: 'desktop', toolName: 'desktop_window_click', intent: 'click Send to post the message' }, 'confirm');
check('final submit with approval allowed', { surface: 'desktop', toolName: 'desktop_window_click', intent: 'click Send to post the message', hasFinalActionApproval: true }, 'allow');
check('delete data needs confirm', { surface: 'browser', toolName: 'browser_click', intent: 'delete the email permanently' }, 'confirm');
check('captcha hands off', { surface: 'browser', toolName: 'browser_click', intent: 'solve the captcha checkbox' }, 'handoff');
check('password change hands off', { surface: 'browser', toolName: 'browser_press_key', intent: 'submit the change password form' }, 'handoff');
check('paywall bypass hands off', { surface: 'browser', toolName: 'browser_click', intent: 'bypass the paywall to read the article' }, 'handoff');
check('install software needs confirm', { surface: 'browser', toolName: 'browser_click', intent: 'install the browser extension' }, 'confirm');
check('login confirm without pre-approval', { surface: 'browser', toolName: 'browser_click', intent: 'log in to the account' }, 'confirm');
check('login allowed when pre-approved', { surface: 'browser', toolName: 'browser_click', intent: 'log in to the account', preApproved: true }, 'allow');
check('upload pre-approvable', { surface: 'desktop', toolName: 'desktop_window_click', intent: 'upload the resume file', preApproved: true }, 'allow');

if (failed) {
  console.error('\nUI action policy tests FAILED.');
  process.exit(1);
}
console.log('\nUI action policy tests OK.');
