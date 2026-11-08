import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTaskNoteEvidence, taskJournalNoteEvidence } from './task-note-evidence';
(async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-notes-'));
 const t = Date.parse('2026-11-08T12:00:00Z');
 const run = { id: 'chat-plan:r', sessionId: 'mobile_test', createdAt: t, completedAt: t + 60000, status: 'completed' };
 const note = (sid: string, time: number, content: string, id: string) => `\n### [TASK] ${new Date(time).toISOString()} #n_${id} (info)\n_Source: Mobile chat session; session: ${sid}_\n${content}\n`;
 try {
  await fs.writeFile(path.join(dir,'2026-11-08-intraday-notes.md'), note('mobile_test',t+1,'## Exact\n\n**note**','a')+note('mobile_test_other',t+2,'wrong session','b')+note('mobile_test',t-1,'before run','c')+note('mobile_test',t+60001,'after run','d'));
  const rows = await readTaskNoteEvidence(dir,run);
  assert.equal(rows.length,1); assert.equal(rows[0].content,'## Exact\n\n**note**');
  assert.equal((await readTaskNoteEvidence(dir,run,[{...run,id:'other'}])).length,0);
  assert.equal((await readTaskNoteEvidence(dir,run,[{...run,id:run.id}])).length,1);
  assert.equal((await readTaskNoteEvidence(dir,{...run,sessionId:''})).length,0);
  assert.equal((await readTaskNoteEvidence(dir,{...run,createdAt:NaN})).length,0);
  assert.equal((await readTaskNoteEvidence(dir+'/missing',run)).length,0);
  const running={...run,completedAt:undefined,status:'running'};
  assert.equal((await readTaskNoteEvidence(dir,running,[],t+30000)).length,1);
  assert.equal(taskJournalNoteEvidence({journal:[{type:'tool_call',content:'ignore'},{type:'write_note',content:'short',detail:'## Full note'}]})[0].content,'## Full note');
  console.log('PASS exact session, time window, overlapping runs, missing/invalid metadata, running bound, journal details');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
