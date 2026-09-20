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
  let payload;
  const deadline = Date.now() + 5_000;
  do {
    const status = await executor.executeTool('process_status', { runId: run.runId, port, health_url: `http://127.0.0.1:${port}/` }, root, {}, 'workspace_health_test');
    payload = JSON.parse(status.result);
    if (payload.verdict === 'running_and_healthy' && payload.listening_socket) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  assert.equal(payload.verdict, 'running_and_healthy');
  assert.equal(payload.service_health.status, 200);
  assert.equal(payload.listening_socket.LocalPort, port);
  assert.equal(payload.process.command, 'node server.js');
  assert.ok('stderr' in payload.recent_output);
  const waitStarted = Date.now();
  const boundedWait = await executor.executeTool('process_wait', { runId: run.runId, timeoutMs: 1000 }, root, {}, 'workspace_health_test');
  assert.equal(boundedWait.error, false);
  assert.equal(boundedWait.extra?.stillRunning, true, 'a long-running process yields a status instead of hanging the agent');
  assert.ok(Date.now() - waitStarted < 2500, 'process_wait respects the requested short wait');
  console.log('PASS: supervised process liveness and HTTP service-health contract');
} finally {
  run.cancel('manual_cancel');
  await run.wait();
  fs.rmSync(fixture, { recursive: true, force: true });
}
