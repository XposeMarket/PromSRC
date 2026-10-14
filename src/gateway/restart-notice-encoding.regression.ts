import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend = fs.readFileSync('src/gateway/routes/chat/pipeline/interactive-turn.ts', 'utf8');
assert.ok(backend.includes("content: 'Gateway restarted. Goal continuing.'"), 'Restart notice must use ASCII punctuation at its source');
for (const [file, name] of [
  ['web-ui/src/pages/ChatPage.js', 'renderAssistantWorkTimer'],
  ['web-ui/src/mobile/mobile-pages.js', '_renderMobileWorkTimer'],
]) {
  const source = fs.readFileSync(file, 'utf8');
  assert.ok(source.includes('Gateway restarted. Goal continuing.'), `${file} must use ASCII restart text`);
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
  assert.ok(match, `Find ${name}`);
  const context = vm.createContext({ _isMobileAssistantMessage: () => true });
  vm.runInContext(`${match[0]}; result = ${name}({messageKind: 'goal_restart_notice', timestamp: 1});`, context);
  assert.equal(context.result, '', 'Restart notices must not render duration chrome');
}
console.log('restart-notice-encoding regression passed');
