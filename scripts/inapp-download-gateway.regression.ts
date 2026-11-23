import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runWithWorkspace } from '../src/tools/workspace-context.js';
import { browserClickAndDownload } from '../src/gateway/browser-tools.js';
import { upsertInHouseSession } from '../src/gateway/browser/inhouse-sessions.js';

async function check() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gateway-qa-'));
  let calls=0, spool='';
  const server=http.createServer(async(req,res)=>{
    if(req.url!=='/click-download'){res.writeHead(404);return res.end();}
    let raw='';for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw); calls++; spool=path.join(os.tmpdir(),body.spool);
    fs.writeFileSync(path.join(spool,'payload'),'expected');
    res.end(JSON.stringify({ok:true,result:{filename:'report.txt'}}));
  });
  try {
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const addr=server.address(); assert.ok(addr && typeof addr!=='string');
    process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL=`http://127.0.0.1:${addr.port}`;
    process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN='synthetic';
    upsertInHouseSession('main', {profile:'main'});
    await runWithWorkspace(workspace,async()=>{
      for(const filename of ['report.txt','report_1.txt']) {
        const result=await browserClickAndDownload('main',1);
        assert.ok(result.includes(`downloads/${filename} (8 bytes)`),result);
        assert.equal(fs.readFileSync(path.join(workspace,'downloads',filename),'utf8'),'expected');
        assert.equal(fs.existsSync(spool),false);
      }
      assert.match(await browserClickAndDownload('main',1,{output_dir:'..'}),/^ERROR/);
      assert.equal(calls,2);
    });
    console.log('PASS real gateway action: workspace bytes, receipt, collision, cleanup, rejected outside directory before click.');
  } finally {server.close();fs.rmSync(workspace,{recursive:true,force:true});}
}
check().catch(e=>{console.error(e);process.exitCode=1;});
