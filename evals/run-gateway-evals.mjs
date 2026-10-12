#!/usr/bin/env node
// Real gateway benchmark. Never resolves approvals or changes global defaults.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseRoute(spec) {
  const [providerId, ...parts] = spec.split(':');
  const reasoningEffort = /^(none|minimal|low|medium|high|xhigh)$/.test(parts.at(-1) || '') ? parts.pop() : undefined;
  const model = parts.join(':');
  if (!providerId || !model || providerId === 'anthropic' || !['openai_codex','ollama','xai'].includes(providerId)) throw new Error('Invalid/forbidden benchmark route');
  return { providerId, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}
export function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}
export function sseParser(onEvent) {
  let buffer = '';
  function consume(final = false) {
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data && data !== '[DONE]') { try { onEvent(JSON.parse(data)); } catch {} }
    }
    if (final && buffer.trim()) { buffer += '\n\n'; consume(); }
  }
  return { push(chunk) { buffer += chunk; consume(); }, end() { consume(true); } };
}
export function summarize(rows) {
  const result = {};
  for (const model of new Set(rows.map(r => r.model))) {
    const runs = rows.filter(r => r.model === model);
    const times = runs.map(r => r.elapsedMs).sort((a,b) => a-b);
    const n = times.length;
    result[model] = { runs: n, passed: runs.filter(r => r.status === 'pass').length,
      failed: runs.filter(r => r.status === 'fail').length, blocked: runs.filter(r => r.status === 'blocked').length,
      medianMs: n % 2 ? times[(n-1)/2] : (times[n/2-1] + times[n/2])/2,
      passRate: runs.filter(r => r.status === 'pass').length / n };
  }
  return result;
}
export async function runTurn({ gateway, sessionId, message, timeoutMs, api, fetchImpl = fetch, pollMs = 500 }) {
  const controller = new AbortController();
  let error = '', text = '', traceId = '', doneSeen = false, polling = false, pollError = '';
  const toolResults = [];
  const abort = reason => { error ||= reason; controller.abort(); };
  const timer = setTimeout(() => abort('timeout'), timeoutMs);
  // Read-only visibility. Approvals are exclusively user-operated.
  const poll = setInterval(async () => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    try {
      const data = await api('GET', '/api/approvals');
      if ((data.approvals || []).some(a => a.sessionId === sessionId && a.status === 'pending')) abort('pending_user_approval');
    } catch { pollError = 'approval_visibility_unavailable'; abort(pollError); }
    finally { polling = false; }
  }, pollMs);
  let reader;
  let stop;
  try {
    const res = await fetchImpl(`${gateway}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message, sessionId, clientRequestId: `eval_${crypto.randomUUID()}`, useTools: true }), signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`chat_http_${res.status}`);
    traceId = res.headers.get('x-prometheus-trace-id') || '';
    const parser = sseParser(ev => {
      if (ev.type === 'tool_result') toolResults.push({ name: String(ev.action || ev.name || ''), error: ev.error === true });
      if (ev.type === 'token') text += String(ev.text || '');
      if (ev.type === 'done') { doneSeen = true; text = String(ev.reply || ev.text || text); }
      if (ev.type === 'error') abort(String(ev.message || ev.error || 'gateway_error'));
      if (/approval|permission/.test(String(ev.type))) abort('pending_user_approval');
    });
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; parser.push(decoder.decode(value, { stream: true })); }
    parser.push(decoder.decode()); parser.end();
    if (!doneSeen && !error) error = 'incomplete_stream';
  } catch (e) { error ||= String(e?.message || e); }
  finally {
    clearTimeout(timer); clearInterval(poll);
    if (error) {
      controller.abort();
      try {
        stop = await api('POST', '/api/mobile/commands/stop-now', { sessionId, source: 'gateway_eval_cleanup' });
        // An accepted abort is not proof the turn settled. Poll session-scoped
        // live targets before deleting any files that the turn may still use.
        stop.confirmed = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const targets = await api('GET', '/api/mobile/commands/stop-targets');
          const list = targets.success === true ? targets.targets : null;
          if (Array.isArray(list) && !list.some(t => t.sessionId === sessionId)) { stop.confirmed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch { stop = { success: false, confirmed: false, message: 'stop_request_failed' }; }
      try { await reader?.cancel(); } catch {}
    }
  }
  return { text, toolResults, error, traceId, timedOut: error === 'timeout', doneSeen, stop, pollError };
}
export async function main(argv = process.argv.slice(2)) {
  const arg = (key, fallback) => { const values = []; for (let i=0;i<argv.length;i++) if (argv[i] === `--${key}`) values.push(argv[i+1]); return values.length ? values : fallback; };
  const gateway = arg('gateway', ['http://127.0.0.1:32466'])[0].replace(/\/$/, '');
  const workspaceArg = arg('workspace', [''])[0];
  if (!workspaceArg) throw new Error('Explicit --workspace required');
  const workspaceRoot = fs.realpathSync(workspaceArg);
  const models = arg('model', ['openai_codex:gpt-6.1-sol:low']); models.forEach(parseRoute);
  const repeats = Number(arg('repeats', ['2'])[0]), timeoutMs = Number(arg('timeout-ms', ['180000'])[0]);
  if (!Number.isInteger(repeats) || repeats < 2 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('repeats >=2 and positive timeout required');
  const only = arg('tasks', ['file-create,read-and-answer,bugfix-off-by-one,multi-file-rename'])[0].split(',');
  if (only.some(id => !TASKS.some(t => t.id === id)) || only.includes('stay-in-workspace')) throw new Error('Unknown or unsafe gateway task');
  const tasks = TASKS.filter(t => only.includes(t.id));
  const outDir = path.resolve(arg('out', [path.join(repo, 'evals/results')])[0]);
  const runtimeRepo = path.resolve(arg('runtime-repo', ['C:/Users/rafel/PromSRC'])[0]);
  const runtimeCommit = arg('runtime-commit', [''])[0];
  const git = root => spawnSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(runtimeCommit) || git(runtimeRepo) !== runtimeCommit) throw new Error('Explicit full runtime commit must match runtime checkout');
  const api = async (method, pathname, body) => {
    const res = await fetch(`${gateway}${pathname}`, { method, headers: { 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`http_${res.status}_${pathname}`);
    return res.json();
  };
  const status = await api('GET','/api/status');
  if (!status.workspace || fs.realpathSync(status.workspace) !== workspaceRoot) throw new Error('Gateway workspace mismatch');
  const distFile = path.join(runtimeRepo, 'dist/gateway/server-v2.js');
  const runtime = { commit: runtimeCommit, repo: runtimeRepo, buildSha256: fs.existsSync(distFile) ? crypto.createHash('sha256').update(fs.readFileSync(distFile)).digest('hex') : null,
    attestation: 'checkout-and-dist; loaded process commit not exposed by gateway' };
  const rows = [], startedAt = new Date().toISOString();
  fs.mkdirSync(outDir, { recursive:true });
  const file = path.join(outDir, `gateway-evals-${Date.now()}.json`);
  const runnerSha256 = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const save = () => fs.writeFileSync(file, JSON.stringify({ version:2, mode:'gateway', runnerCommit:git(repo), runnerSha256, runtime, gateway, startedAt, finishedAt:new Date().toISOString(), repeats, tasks:tasks.map(t=>({id:t.id,area:t.area})), summary:summarize(rows), rows }, null,2));
  for (const spec of models) for (const task of tasks) for (let repeat=1;repeat<=repeats;repeat++) {
    if (git(runtimeRepo) !== runtimeCommit) throw new Error('Runtime checkout changed during benchmark');
    const id = `eval_${crypto.randomUUID().replaceAll('-','')}`, relDir = `evals-runs/${id}`, runDir = path.join(workspaceRoot,relDir);
    const t0 = Date.now(); let run, row, cleanupSafe = true;
    try {
      fs.mkdirSync(runDir,{recursive:true});
      if (!inside(workspaceRoot,fs.realpathSync(runDir))) throw new Error('Unsafe run directory');
      task.seed(runDir);
      const route = parseRoute(spec);
      const routed = await api('PUT',`/api/sessions/${id}/model-route`,route);
      if (routed.chatModelRoute?.availability !== 'ready') throw new Error('route_not_ready');
      run = await runTurn({ gateway, sessionId:id, timeoutMs, api,
        message:`${task.prompt}\n\nAll task paths (including directory targets such as src/) are relative to "${relDir}"; prefix EVERY file/directory tool target with that folder. Never touch other paths. Do not delegate, send messages, access credentials, change settings, or resolve approvals. If user approval is required, stop and report blocked. This eval cannot grant permissions.` });
      cleanupSafe = !run.error || run.stop?.confirmed === true;
      const verdict = run.error ? { pass:false,detail:run.error } : task.id === 'read-and-answer'
        ? { pass:run.text.trim() === '7' && run.toolResults.some(t => /read|file|workspace/.test(t.name)), detail:`strict exact-answer: ${JSON.stringify(run.text.slice(0,160))}` }
        : await task.verify(runDir,run);
      row = { model:spec, task:task.id, area:task.area, repeat, status:run.error ? 'blocked' : verdict.pass ? 'pass' : 'fail', pass:!run.error && verdict.pass === true,
        detail:String(verdict.detail || '').slice(0,200), toolCalls:run.toolResults.length, toolErrors:run.toolResults.filter(t=>t.error).length,
        timedOut:run.timedOut, traceId:run.traceId, doneSeen:run.doneSeen, stop:run.stop, sessionId:id, route:routed.chatModelRoute };
    } catch(e) { row = { model:spec, task:task.id, area:task.area, repeat, status:'blocked', pass:false, detail:String(e?.message || e).slice(0,200), toolCalls:0 }; }
    finally {
      if (cleanupSafe && fs.existsSync(runDir) && inside(workspaceRoot,fs.realpathSync(runDir))) fs.rmSync(runDir,{recursive:true,force:true});
    }
    row.elapsedMs = Date.now()-t0; row.cleanupSafe = cleanupSafe; rows.push(row); save();
    console.log(`${row.status} ${spec} ${task.id} #${repeat} ${row.elapsedMs}ms ${row.detail}`);
    if (!cleanupSafe) throw new Error(`Stop unconfirmed: preserved ${runDir}; report ${file}`);
  }
  console.log(`report: ${file}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{ console.error(e.message); process.exitCode=1; });
