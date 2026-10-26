import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'strict-trigger-plan-'));
const root=path.join(temp,'skills');fs.mkdirSync(path.join(root,'sample'),{recursive:true});fs.mkdirSync(path.join(root,'.manifests'));
const manifest=path.join(root,'sample/skill.json'),overlay=path.join(root,'.manifests/sample.skill.json'),md=path.join(root,'sample/SKILL.md');
fs.writeFileSync(manifest,JSON.stringify({id:'sample',triggers:['legacy'],custom:'keep'}));
fs.writeFileSync(overlay,JSON.stringify({description:'custom overlay',promptSignals:{phrases:['old']}}));fs.writeFileSync(md,'private instructions unchanged');
const catalog=path.join(temp,'catalog.json');fs.writeFileSync(catalog,JSON.stringify({rows:[{id:'sample',triggerPolicy:{version:2,rules:[{allOf:['portrait']}]}}]}));
const plan=path.join(temp,'plan.json');
const run=(mode)=>spawnSync(process.execPath,['--import','tsx','scripts/plan-installed-skill-triggers.mjs',mode,'--skills-dir',root,'--plan',plan,'--catalog',catalog],{encoding:'utf8'});
try{
 const before=fs.readFileSync(manifest,'utf8');let result=run('--capture');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(manifest,'utf8'),before);
 fs.appendFileSync(manifest,' ');result=run('--apply');assert.notEqual(result.status,0);assert.equal(fs.readFileSync(manifest,'utf8'),before+' ');assert.equal(fs.readdirSync(temp).some(x=>x.startsWith('plan.json.backup')),false);
 fs.writeFileSync(manifest,before);result=run('--apply');assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(fs.readFileSync(manifest)).custom,'keep');assert.equal(JSON.parse(fs.readFileSync(overlay)).description,'custom overlay');assert.equal(JSON.parse(fs.readFileSync(overlay)).triggerPolicy.version,2);assert.equal(fs.readFileSync(md,'utf8'),'private instructions unchanged');
 result=run('--apply');assert.notEqual(result.status,0,'stale plan fails safely');
 const backup=fs.readdirSync(temp).find(x=>x.startsWith('plan.json.backup'));assert.equal(fs.readFileSync(path.join(temp,backup,'sample/skill.json'),'utf8'),before);
 console.log('PASS installed trigger plan: read-only capture, stale guard, explicit apply, overlay preservation, backups, repeated-plan refusal');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
