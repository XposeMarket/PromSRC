import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const commandSource = read('web-ui/src/chat-slash-commands.js');
const commandModule = await import(`data:text/javascript;base64,${Buffer.from(commandSource).toString('base64')}`);
for (const surface of ['desktop', 'mobile']) {
  const visual = commandModule.getChatSlashCommands(surface).find((item) => item.command === '/visual');
  assert.ok(visual, `/visual must be available on ${surface}`);
  assert.deepEqual(visual.selectedSkillIds, ['interactive-visuals']);
}
assert.deepEqual(
  commandModule.mergeSlashCommandSkillIds('/visual compare these options', ['chart-visualizer']),
  ['chart-visualizer', 'interactive-visuals'],
);

const desktop = read('web-ui/src/pages/ChatPage.js');
const mobile = read('web-ui/src/mobile/mobile-pages.js');
const utils = read('web-ui/src/utils.js');
assert.match(desktop, /getChatSlashCommands\('desktop'\)/);
assert.match(mobile, /getChatSlashCommands\('mobile'\)/);
assert.match(desktop, /prometheus:visual-state-change/);
assert.match(mobile, /prometheus:visual-state-change/);
assert.match(utils, /data-visual-id=/);
assert.match(utils, /window\.openai\.setWidgetState/);
assert.match(utils, /window\.prometheusVisual/);
assert.doesNotMatch(utils, /Math\.ceil\(height\)\s*\+\s*16/);
assert.match(utils, /Math\.abs\(current - bounded\) <= 1/);
assert.match(utils, /measured<=viewport\+24\?viewport:measured/);
assert.match(utils, /height:\$\{minHeight\}px/);
assert.match(utils, /const visualCanvasBg = isDark/);
assert.match(utils, /function normalizeSvgSize\(\)/);

const skill = read('workspace/skills/interactive-visuals/SKILL.md');
for (const lane of ['chart-visualizer', 'mermaid-diagrams', 'svg-diagrams', 'interactive-artifacts']) {
  assert.ok(skill.includes(lane), `visual router must document ${lane}`);
}
assert.match(skill, /do not call `show_ui_card`/i);
assert.match(skill, /exactly one complete fenced visual block/i);

const chatRouter = read('src/gateway/routes/chat.router.ts');
const promptContext = read('src/gateway/prompt-context.ts');
const skillsManagerSource = read('src/gateway/skills-runtime/skills-manager.ts');
assert.match(chatRouter, /VISUAL FINALIZATION BLOCKED/);
assert.match(chatRouter, /hasReadSpecializedVisualSkill/);
assert.match(promptContext, /selectedSkillCtxLocal/);
assert.match(skillsManagerSource, /\[USER_SELECTED_SKILL_INSTRUCTIONS\]/);
assert.match(skillsManagerSource, /String\(skill\.instructions/);

const require = createRequire(import.meta.url);
const richArtifacts = require(path.join(root, 'dist/gateway/rich-artifacts.js'));
const first = richArtifacts.extractVisualArtifactsFromMarkdown('```chart\n({type:"bar"})\n```');
assert.equal(first.length, 1);
assert.equal(first[0].renderer, 'chart');
assert.equal(first[0].version, 1);
first[0].state = { controls: { metric: { value: 'revenue' } } };

const exact = richArtifacts.extractVisualArtifactsFromMarkdown('```chart\n({type:"bar"})\n```', first);
assert.equal(exact[0].id, first[0].id);
assert.equal(exact[0].version, 1);
assert.deepEqual(exact[0].state, first[0].state);

const revised = richArtifacts.extractVisualArtifactsFromMarkdown(
  '```chart\n({type:"line"})\n```',
  first,
  { reuseIdentityOnChange: true },
);
assert.equal(revised[0].id, first[0].id);
assert.equal(revised[0].version, 2);
assert.equal(revised[0].parentVersion, 1);
assert.deepEqual(revised[0].state, first[0].state);

console.log('visual command + persistent artifact contract: ok');
