import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);

const desktop = await load('dist/gateway/desktop-tools.js');
const wrappers = await load('dist/gateway/desktop-wrappers.js');
const cancellation = await load('dist/gateway/desktop-cancellation.js');
const background = await load('dist/gateway/desktop-background.js');
const desktopToolDefs = await load('dist/tools/desktop.js');

const sampleWindow = { handle: 987654, pid: 4321, processStartTime: 1_725_000_123_456 };
const token = desktop.createDesktopWindowToken(sampleWindow);
assert.deepEqual(desktop.parseDesktopWindowToken(token), sampleWindow, 'window token must round-trip');
const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
assert.equal(desktop.parseDesktopWindowToken(tampered), null, 'tampered window token must fail');
assert.equal(desktop.windowIdForHandle(sampleWindow.handle), 'win_987654', 'compatibility window id shape changed');
assert.equal(
  desktop.resolveDesktopWindowClickCoordinateSpace({ screenshot_id: 'ds_test' }),
  'capture',
  'a screenshot-anchored window click must default to capture space',
);
assert.equal(
  desktop.resolveDesktopWindowClickCoordinateSpace({}),
  'window',
  'an unanchored window click must retain logical window-space compatibility',
);
assert.equal(
  desktop.resolveDesktopWindowClickCoordinateSpace({ screenshot_id: 'ds_test', coordinate_space: 'window' }),
  'window',
  'an explicit coordinate space must win',
);
assert.equal(desktop.desktopCaptureRequiresPrecisionRecapture({ width: 1720, height: 1392, targetWindow: sampleWindow }), true);
assert.equal(desktop.desktopCaptureRequiresPrecisionRecapture({ width: 620, height: 1392, targetWindow: sampleWindow }), false);
assert.equal(desktop.desktopCaptureRequiresPrecisionRecapture({ width: 800, height: 600, targetWindow: sampleWindow, normalizedScreenshot: { originalWidth: 1600, originalHeight: 1200, originalBytes: 1, bytes: 1 } }), true);

const invoke = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'invoke', state_id: 's1', element_id: 'e1',
});
assert.equal(invoke.name, 'desktop_accessibility_action');
assert.equal(invoke.args.semantic_action, 'invoke');

const atomic = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'find_and_act', title: 'Calculator', element_name: 'Equals', semantic_action: 'invoke',
});
assert.equal(atomic.name, 'desktop_accessibility_action');
assert.equal(atomic.args.semantic_action, 'invoke');
assert.equal(atomic.args.element_name, 'Equals');
assert.equal(atomic.args.atomic, true);

const partialVisibleText = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'find_and_act', title: 'ChatGPT', element_name: 'compare computer use skills',
  match_mode: 'contains', semantic_action: 'invoke',
});
assert.equal(partialVisibleText.args.match_mode, 'contains');
assert.equal(partialVisibleText.args.atomic, true);

const findByTitle = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'find', title: 'SKILL.md - Notepad',
});
assert.equal(findByTitle.args.name, 'SKILL.md - Notepad');

const closeByApp = wrappers.normalizeDesktopWrapperTool('desktop_apps', {
  action: 'close_app', app: 'Calculator',
});
assert.equal(closeByApp.args.name, 'Calculator');

const atomicSchema = desktopToolDefs.desktopAccessibilityActionTool.jsonSchema;
assert.ok(atomicSchema.properties.atomic, 'compatibility schema must preserve atomic routing marker');
assert.ok(atomicSchema.properties.automation_id, 'compatibility schema must preserve semantic selectors');
assert.ok(atomicSchema.properties.match_mode, 'compatibility schema must preserve visible-text matching mode');
assert.ok(!atomicSchema.required?.includes('state_id'), 'atomic action must not require a preexisting state_id');

const invalidKeyStarted = performance.now();
const invalidKey = await desktop.desktopPressKey('7+8=');
assert.match(invalidKey, /INVALID_ARGUMENT/);
assert.ok(performance.now() - invalidKeyStarted < 100, 'invalid composite key should reject before desktop initialization');

const state = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'state', window_token: token,
});
assert.equal(state.name, 'desktop_get_window_state');
assert.equal(state.args.window_token, token);

const windowRegion = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'region_screenshot', window_token: token, region: [10, 20, 310, 220],
});
assert.equal(windowRegion.name, 'desktop_window_screenshot');
assert.deepEqual(windowRegion.args.region, [10, 20, 310, 220]);

const screenRegion = wrappers.normalizeDesktopWrapperTool('desktop_screen', {
  action: 'region_screenshot', region: [-100, 20, 500, 420],
});
assert.equal(screenRegion.name, 'desktop_screenshot');
assert.deepEqual(screenRegion.args.region, [-100, 20, 500, 420]);
const ordinaryWindowScreenshot = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'screenshot', window_token: token, region: [0, 0, 0, 0],
});
assert.equal(ordinaryWindowScreenshot.args.region, undefined, 'zero-filled optional crop must be omitted');
assert.equal(ordinaryWindowScreenshot.args.skip_ocr, true, 'model-facing vision screenshots must skip OCR by default');
const ocrWindowScreenshot = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'screenshot', window_token: token, ocr: true,
});
assert.equal(ocrWindowScreenshot.args.skip_ocr, true, 'model-facing screenshots must stay on the vision fast path');
assert.equal(ocrWindowScreenshot.args.ocr, undefined, 'wrapper-only OCR option must not leak to the compatibility handler');
const fastAutoClick = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'click', window_token: token, x: 10, y: 10, verify: 'auto', focus_first: false,
});
assert.equal(fastAutoClick.args.verify, 'off', 'schema-filled auto verification must use the wrapper fast path');
assert.equal(fastAutoClick.args.focus_first, false, 'explicit focus preservation must survive wrapper normalization');
const missingWindowRegion = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'region_screenshot', window_token: token,
});
assert.match(missingWindowRegion.error, /region_screenshot.*requires region/);
const locateText = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'locate_text', screenshot_id: 'ds_crop', query: 'Hardening chat artifact extraction',
});
assert.equal(locateText.name, 'desktop_locate_text');
const clickText = wrappers.normalizeDesktopWrapperTool('desktop_window', {
  action: 'click_text', screenshot_id: 'ds_crop', query: 'Hardening chat artifact extraction', min_confidence: 0.8,
});
assert.equal(clickText.name, 'desktop_click_text');
assert.equal(clickText.args.min_confidence, 0.8);
const invalidClickText = wrappers.normalizeDesktopWrapperTool('desktop_window', { action: 'click_text', query: 'missing anchor' });
assert.match(invalidClickText.error, /requires screenshot_id/);

const wrapperDefinitions = wrappers.getDesktopWrapperToolDefinitions();
const screenWrapper = wrapperDefinitions.find((tool) => tool.function?.name === 'desktop_screen');
const windowWrapper = wrapperDefinitions.find((tool) => tool.function?.name === 'desktop_window');
assert.ok(screenWrapper.function.parameters.properties.action.enum.includes('region_screenshot'));
assert.ok(windowWrapper.function.parameters.properties.action.enum.includes('region_screenshot'));

const backgroundCall = wrappers.normalizeDesktopWrapperTool('desktop_background', {
  action: 'command', command_action: 'list_windows',
});
assert.equal(backgroundCall.name, 'desktop_background_command');
assert.equal(backgroundCall.args.action, 'list_windows');

const controller = new AbortController();
const pending = cancellation.desktopAbortableDelay(10_000, controller.signal);
controller.abort();
await assert.rejects(pending, (error) => cancellation.isDesktopCancellationError(error));
const waitController = new AbortController();
const desktopWait = desktop.desktopWait(10_000, waitController.signal);
waitController.abort();
assert.match(await desktopWait, /DESKTOP_CANCELLED/, 'desktop wait must surface typed cancellation');

const worker = background.buildDesktopBackgroundWorkerScript();
for (const action of ['list_windows', 'get_window_state', 'accessibility_tree', 'window_click', 'window_type', 'window_key']) {
  assert.ok(worker.includes(`$action -eq "${action}"`), `background worker missing ${action}`);
}

const desktopSource = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'src/gateway/desktop-tools.ts'), 'utf8'));
const nativeHelperSource = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'native/desktop-helper-windows/main.cpp'), 'utf8'));
const helperClientSource = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'src/gateway/desktop-platform-win32-helper.ts'), 'utf8'));
assert.match(desktopSource, /const imagePath = process\.argv\[1\]/, 'node -e OCR child must read its first supplied argument from argv[1]');
assert.match(desktopSource, /stage: 'worker_or_recognition'/, 'OCR worker failures must expose a diagnostic stage');
assert.doesNotMatch(desktopSource, /\{ x: xx - 4, y: yy - 4 \}/, 'click verification must not retry guessed neighboring pixels');
assert.match(desktopSource, /const shouldCheckOcr = options\.mode === 'strict'/, 'ordinary auto verification must not block on OCR');
assert.match(desktopSource, /ERROR: \[ACTION_NOT_CONFIRMED\]/, 'strict unconfirmed clicks must be surfaced as tool errors');
assert.match(desktopSource, /skipOcr: true,[\s\S]{0,160}resolvedTarget: target/, 'window state screenshots must never invoke OCR and must reuse resolved context');
assert.match(desktopSource, /VISUAL_TARGET_AMBIGUOUS/, 'visual text clicks must reject ambiguous OCR targets');
for (const method of ['focus_window', 'move_pointer', 'click_current', 'scroll_current', 'drag', 'type_text', 'press_key']) {
  assert.ok(nativeHelperSource.includes(`method == "${method}"`), `persistent Windows helper missing ${method}`);
}
assert.match(nativeHelperSource, /SendInput\(/, 'Windows input hot path must use SendInput');
assert.match(nativeHelperSource, /DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2/, 'capture and input helper must share per-monitor DPI awareness');
for (const method of ['movePointer', 'clickCurrent', 'scrollCurrent', 'typeText', 'pressKey']) {
  assert.ok(helperClientSource.includes(`async ${method}(`), `Windows helper client missing ${method}`);
}
assert.match(desktopSource, /await helper\.clickAt\(xx, yy, button, repeat\)/, 'ordinary coordinate clicks must route through the persistent helper');

console.log('PASS: strong window identity, semantic wrapper routing, cancellation, and background worker contract');
