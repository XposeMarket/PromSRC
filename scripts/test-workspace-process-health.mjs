import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-process-health-'));
const port = 18877;
fs.writeFileSync(path.join(fixture, 'server.js'), `require('http').createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('healthy')}).listen(${port},'127.0.0.1')`);

const supervisorModule = await import(pathToFileURL(path.join(root, 'dist/gateway/process/supervisor.js')).href);
const executor = await import(pathToFileURL(path.join(root, 'dist/gateway/agents-runtime/subagent-executor.js')).href);
const supervisor = supervisorModule.getProcessSupervisor();
const run = await supervisor.spawn({ command: 'node server.js', cwd: fixture, mode: 'background', captureOutput: true });
try {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const status = await executor.executeTool('process_status', { runId: run.runId, port, health_url: `http://127.0.0.1:${port}/` }, root, {}, 'workspace_health_test');
  const payload = JSON.parse(status.result);
  assert.equal(payload.verdict, 'running_and_healthy');
  assert.equal(payload.service_health.status, 200);
  assert.equal(payload.listening_socket.LocalPort, port);
  assert.equal(payload.process.command, 'node server.js');
  assert.ok('stderr' in payload.recent_output);
  console.log('PASS: supervised process liveness and HTTP service-health contract');
} finally {
  run.cancel('manual_cancel');
  await run.wait();
  fs.rmSync(fixture, { recursive: true, force: true });
}
