import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeBrowserWrapperTool } from './agents-runtime/wrapper-normalizers';
import { DESKTOP_WRAPPER_ACTION_MAP } from './desktop-wrappers';

// Regression: result, hint, error and prompt text told the model to call
// single-purpose tools (browser_vision_click, desktop_get_window_state, ...)
// that are hidden from the main-chat tool list. A model that followed the
// text called a tool it had never been offered. The text now names the
// wrapper form, e.g. browser_act(action:"vision_click").

const OLD_NAMES = [
  'browser_vision_click',
  'browser_get_focused_item',
  'browser_extract_structured',
  'desktop_get_window_state',
  'desktop_window_click',
  'creative_list_html_motion_templates',
];

// Files whose strings reach the model on the main-chat (wrapper) surface.
// Old tool definitions (browser/definitions.ts, desktop/window-actions.ts,
// tools/defs/*) are hidden from the model and are not listed here. Voice
// exposes its own voice_* tool list and is out of scope.
const MODEL_FACING_FILES = [
  'agents-runtime/handlers/browser-desktop.ts',
  'browser-site-knowledge.ts',
  'browser-tools.ts',
  'chat/chat-helpers.ts',
  'prompt-context.ts',
  'routes/chat/pipeline/handle-chat.ts',
  'site-shortcuts.ts',
  'desktop/window-mid.ts',
  'desktop/interaction-actions.ts',
  'desktop/interaction-context.ts',
  'desktop/apps.ts',
  'delivery-screenshot.ts',
  'comms/telegram-channel.ts',
  'routes/tasks.router.ts',
  'tasks/background-task-runner.ts',
];

// Prose is any string literal containing whitespace. Bare single-token
// literals ('browser_vision_click') are dispatch names, switch cases and
// alias tables, which legitimately keep the internal name.
const LITERAL = /'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g;
const OLD = new RegExp(`\\b(${OLD_NAMES.join('|')})\\b`);

const offenders: string[] = [];
for (const rel of MODEL_FACING_FILES) {
  const file = path.join(__dirname, rel);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const match of line.matchAll(LITERAL)) {
      const literal = match[0];
      if (/\s/.test(literal) && OLD.test(literal)) {
        offenders.push(`${rel}:${index + 1}: ${literal.slice(0, 120)}`);
        break;
      }
    }
  });
}
assert.deepEqual(offenders, [], `model-facing text names hidden legacy tools:\n${offenders.join('\n')}`);

// The wrapper forms used in that text must resolve to the intended tools.
const browser = (wrapper: string, action: string) => normalizeBrowserWrapperTool(wrapper, { action })?.name;
assert.equal(browser('browser_act', 'vision_click'), 'browser_vision_click');
assert.equal(browser('browser_act', 'vision_type'), 'browser_vision_type');
assert.equal(browser('browser_act', 'click'), 'browser_click');
assert.equal(browser('browser_act', 'fill'), 'browser_fill');
assert.equal(browser('browser_act', 'key'), 'browser_press_key');
assert.equal(browser('browser_observe', 'focused_item'), 'browser_get_focused_item');
assert.equal(browser('browser_observe', 'snapshot'), 'browser_snapshot');
assert.equal(browser('browser_observe', 'screenshot'), 'browser_vision_screenshot');
assert.equal(browser('browser_observe', 'page_text'), 'browser_get_page_text');
assert.equal(browser('browser_extract', 'extract_structured'), 'browser_extract_structured');
assert.equal(browser('browser_extract', 'run_js'), 'browser_run_js');
assert.equal(browser('browser_session', 'open'), 'browser_open');
assert.equal(DESKTOP_WRAPPER_ACTION_MAP.desktop_window.state, 'desktop_get_window_state');
assert.equal(DESKTOP_WRAPPER_ACTION_MAP.desktop_window.click, 'desktop_window_click');
assert.equal(DESKTOP_WRAPPER_ACTION_MAP.desktop_window.screenshot, 'desktop_window_screenshot');
assert.equal(DESKTOP_WRAPPER_ACTION_MAP.desktop_screen.screenshot, 'desktop_screenshot');
assert.equal(DESKTOP_WRAPPER_ACTION_MAP.desktop_input.click, 'desktop_click');

console.log('tool-name-hints regression passed');
