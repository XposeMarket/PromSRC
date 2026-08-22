import assert from 'node:assert/strict';
import { getDesktopWrapperToolDefinitions, normalizeDesktopWrapperTool } from './desktop-wrappers.js';

function main(): void {
  const bgClick = normalizeDesktopWrapperTool('desktop_window', {
    action: 'click',
    window_handle: 123,
    x: 10,
    y: 20,
    verify: 'off',
  });
  assert(bgClick && !bgClick.error);
  assert.equal(bgClick.name, 'desktop_window_click');
  assert.equal(bgClick.args.delivery_mode, 'background');
  assert.equal(bgClick.args.allow_foreground_fallback, true);
  assert.equal(bgClick.args.verify, 'auto', 'background pointer delivery must not disable verification');

  const fgClick = normalizeDesktopWrapperTool('desktop_window', {
    action: 'click',
    window_handle: 123,
    x: 10,
    y: 20,
    delivery_mode: 'foreground',
    verify: 'auto',
  });
  assert(fgClick && !fgClick.error);
  assert.equal(fgClick.args.delivery_mode, 'foreground');
  assert.equal(fgClick.args.verify, 'off', 'explicit foreground keeps the existing fast-path optimization');

  const type = normalizeDesktopWrapperTool('desktop_window', {
    action: 'type', window_token: 'win:strong', text: 'hello', allow_foreground_fallback: false,
  });
  assert(type && !type.error);
  assert.equal(type.args.delivery_mode, 'background');
  assert.equal(type.args.allow_foreground_fallback, false);

  const globalInput = normalizeDesktopWrapperTool('desktop_input', {
    action: 'key', key: 'enter', window_handle: 33,
  });
  assert(globalInput && !globalInput.error);
  assert.equal(globalInput.args.delivery_mode, 'background');

  const wait = normalizeDesktopWrapperTool('desktop_input', {
    action: 'wait', ms: 100, delivery_mode: 'foreground', allow_foreground_fallback: false,
  });
  assert(wait && !wait.error);
  assert.equal(wait.args.delivery_mode, undefined, 'non-input actions must not carry host delivery semantics');
  assert.equal(wait.args.allow_foreground_fallback, undefined);

  const sandbox = normalizeDesktopWrapperTool('desktop_background', {
    action: 'status', delivery_mode: 'foreground', allow_foreground_fallback: true,
  });
  assert(sandbox && !sandbox.error);
  assert.equal(sandbox.args.delivery_mode, undefined, 'sandbox is separate from host co-work delivery');

  const defs = getDesktopWrapperToolDefinitions();
  const windowDef = defs.find((d: any) => d?.function?.name === 'desktop_window');
  const inputDef = defs.find((d: any) => d?.function?.name === 'desktop_input');
  const sandboxDef = defs.find((d: any) => d?.function?.name === 'desktop_background');
  assert(windowDef?.function?.parameters?.properties?.delivery_mode);
  assert(inputDef?.function?.parameters?.properties?.delivery_mode);
  assert.equal(sandboxDef?.function?.parameters?.properties?.delivery_mode, undefined);

  console.log('desktop co-work wrapper regression passed');
}

main();
