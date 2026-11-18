import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {normalizeWorkspaceWrapperTool as normalize} from '../agents-runtime/wrapper-normalizers';
import {classifyCommandTermination as classify} from './command-outcome';
import {observedWindowsBatch} from './literal-command';
import {ProcessSupervisor} from './supervisor'; import {ProcessRunStore} from './store';
async function main(){
  if(process.platform!=='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-argv-')); const supervisor=new ProcessSupervisor(new ProcessRunStore(path.join(dir,'runs')));
  const args=(x:any)=>normalize('workspace_run',{action:'run',...x})!;
  const command=(x:any)=>{const r=args(x);assert.ifError(r.error);return r.args.command as string;};
  const run=async(c:string)=>{const r=await supervisor.spawn({command:c,cwd:dir,timeoutMs:15000});const e=await r.wait();const record=supervisor.get(r.record.runId)!; const out=classify({code:e.exitCode,reason:e.reason,timedOut:e.timedOut},record.command); if(e.exitCode===1 && out.ok)assert.equal(record.failureSummary,undefined); return {e,out};};
  try{
    fs.writeFileSync(path.join(dir,'build file.ts'),'literal (. from fixture\n');
    const values=['', 'spaces here','C:\\with space\\','a"b',"don't",'$env:X','a;b','pipe|val','🦊'];
    const echo=await run(command({program:'node',argv:['-e','console.log(JSON.stringify(process.argv.slice(1)))','--',...values]}));assert.equal(echo.e.exitCode,0);assert.deepEqual(JSON.parse(echo.e.stdout),values);
    for(const [fields,code,ok] of [[{text:'(.',glob:'build*.ts'},0,true],[{text:'unmatched',glob:'*.ts'},1,true],[{text:'foo',directory:'missing'},2,false],[{text:'(',regex:true},2,false]] as const){ const r=await run(command({search:fields}));assert.equal(r.e.exitCode,code);assert.equal(r.out.ok,ok); }
    for(const extra of [{elevated:true},{pty:true},{shell:'cmd'},{command:'echo other'}])assert.ok(args({search:{text:'hi'},...extra}).error);
    assert.ok(args({search:{text:'x',directory:'build*.ts'}}).error);
    // Strict-schema models fill every unused optional field with an empty placeholder (seen live from gpt-6-astra, 2026-11-18).
    const ph={text:'',directory:'',glob:'',regex:false};
    assert.match(command({command:'',program:'git',argv:['diff','--stat','a...b'],search:ph}),/^git diff --stat a\.\.\.b/);
    assert.equal(command({command:'git status --short',program:'git',argv:[],search:ph}),'git status --short');
    assert.equal(command({command:'git status --short',argv:[],program:''}),'git status --short');
    assert.match(command({command:'',program:'rg',argv:[],search:{text:'needle',directory:'',glob:'',regex:false}}),/^rg -n -F -e needle -- \./);
    // Two real forms in one call still fail closed.
    assert.ok(args({command:'echo hi',program:'git',argv:['status']}).error);
    assert.ok(args({command:'',program:'git',argv:['status'],search:{text:'x'}}).error);
    assert.ok(args({command:'echo hi',search:{text:'x'},program:'',argv:[]}).error);

    const miss=await run("Write-Output earlier; rg absent 'build file.ts'");assert.equal(miss.e.exitCode,0);assert.match(miss.e.stdout,/earlier/);assert.match(miss.e.stdout,/step 2\/2: no matches; exit 1/);
    const masked=await run('cmd /c exit 7; Write-Output after');assert.equal(masked.e.exitCode,7);assert.match(masked.e.stdout,/step 1\/2: failed; exit 7/);assert.match(masked.e.stdout,/step 2\/2: ok; exit 0/);
    assert.equal(observedWindowsBatch('cmd /c exit 7; if ($LASTEXITCODE) { exit 0 }'),null);
    assert.equal(classify({code:1,reason:'manual_cancel'},command({search:{text:'foo'}})).ok,false);
    console.log('PASS: supervisor preserved exact argv, search hit/miss/path/regex, exit 7 and both step statuses; control flow and cancellation preserved.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
