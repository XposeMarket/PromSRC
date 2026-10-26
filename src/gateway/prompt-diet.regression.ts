import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTools } from './tool-builder';
import { personaContextLabel } from './prompt-tool-menu';
import { buildToolsContext, processIntradayNotesForPrompt, loadFullMemoryProfile, buildPersonalityContext } from './prompt-context';

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-diet-'));
 const deps = { getMCPManager: () => ({getAllTools: () => []}), skipDynamicExtensionTools: true };
 const tools = buildTools(deps, new Set());
 const background = buildTools(deps, new Set(), { runSurface: 'background_dispatch' } as any);
 const menu = buildToolsContext(new Set());
 const raw = Array.from({length: 12}, (_,i) => `### [TASK] 2026-10-26T00:${String(i).padStart(2,'0')}:00Z #n_test${i} (open)\n${'body '.repeat(120)}`).join('\n\n');
 fs.writeFileSync(path.join(root,'USER.md'), 'persona '.repeat(3000));
 fs.writeFileSync(path.join(root,'SOUL.md'), 'voice '.repeat(120));
 fs.mkdirSync(path.join(root,'memory'));
 fs.writeFileSync(path.join(root,'memory',`${new Date().toISOString().slice(0,10)}-intraday-notes.md`),raw);
 const notes = processIntradayNotesForPrompt(root, raw);
 const skills = { buildTurnContext: () => '', getSkill: () => undefined, getSkillPath: () => '', getActiveSkills: () => [] } as any;
 const mainPrompt = await buildPersonalityContext('diet_fixture_main', root, 'hello', 'interactive', 0, skills, () => new Map(), () => {}, undefined, { skipAutomaticMemorySearch: true } as any);
 const bgPrompt = await buildPersonalityContext('background_diet_fixture', root, 'Complete assigned audit', 'background_agent', 0, skills, () => new Map(), () => {}, undefined, {});
 const metrics = { menuChars:menu.length, notesChars:notes.length, userChars:loadFullMemoryProfile(root,'USER.md').length, mainPromptChars:mainPrompt.length, backgroundPromptChars:bgPrompt.length, mainToolCount:tools.length, backgroundToolCount:background.length, mainSchemaChars:JSON.stringify(tools).length, backgroundSchemaChars:JSON.stringify(background).length };
 console.log(JSON.stringify(metrics));
 if (process.argv.includes('--measure')) { fs.rmSync(root,{recursive:true,force:true}); return; }
 assert.ok(menu.length <= 7000, `menu is ${menu.length} chars`);
 for (const tool of tools) assert.ok(menu.includes(tool.function.name), `menu missing core ${tool.function.name}`);
 assert.ok(notes.length <= 2000);
 for(let i=0;i<12;i++) assert.ok(notes.includes(`#n_test${i}`), `missing open ID ${i}`);
 assert.ok(notes.indexOf('#n_test11') < notes.indexOf('#n_test0'));
 assert.equal(loadFullMemoryProfile(root,'USER.md').length, 23999);
 const names = (t:any[]) => t.map(x=>x.function.name);
 assert.ok(names(tools).includes('ask_prometheus_questions'));
 assert.ok(!names(background).includes('ask_prometheus_questions'));
 assert.ok(!names(background).includes('request_browser_login'));
 assert.ok(names(background).includes('request_final_action_approval'));
 assert.ok(names(background).includes('delivery_send'));
 assert.deepEqual(buildTools(deps,new Set(),{runSurface:'direct_chat'}), tools);
 for (const runSurface of ['scheduled_run','heartbeat','team_dispatch','proposal_execution'] as const) {
  const filtered = names(buildTools(deps,new Set(),{runSurface}));
  assert.ok(!filtered.includes('ask_prometheus_questions'));
  assert.ok(filtered.includes('request_final_action_approval'));
  assert.ok(filtered.includes('delivery_send'));
 }
 assert.ok(!buildToolsContext(new Set(),{runSurface:'background_dispatch'}).includes('Core tools loaded: ask_prometheus_questions'));
 assert.match(personaContextLabel('USER', 'x'.repeat(15000)), /size warning.*15,000/);
 assert.equal(personaContextLabel('USER', 'short'), '[USER]');
 const recent = Array.from({length:5},(_,i)=>`### [TASK] 2026-10-26T01:0${i}:00Z #n_info${i} (info)\nRecent unique ${i}`).join('\n\n');
 const projected = processIntradayNotesForPrompt(root,raw+'\n\n'+recent);
 assert.ok(projected.length<=2000);
 for(const i of [2,3,4]) assert.ok(projected.includes(`#n_info${i}`));
 assert.ok(!projected.includes('#n_info1'));
 const huge=Array.from({length:500},(_,i)=>`### [TASK] 2026-10-26T01:00:00Z #n_overflow${i} (open)\nDetails`).join('\n\n');
 const overflow=processIntradayNotesForPrompt(root,huge);
 assert.ok(overflow.length<=2000); assert.match(overflow,/more open IDs omitted/);
 fs.rmSync(root,{recursive:true,force:true});
 console.log('prompt diet regression: PASS');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
