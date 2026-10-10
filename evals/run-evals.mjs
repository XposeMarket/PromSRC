#!/usr/bin/env node
// Prometheus agent evals: run TASKS against real models through the public
// embedding API (the same loop, tools and policy as the app) and write a
// reproducible report.
//
//   npm run build:backend
//   node evals/run-evals.mjs --model ollama:qwen3.5:9b [--model ollama:qwen3.5:27b] [--repeats 2] [--tasks bugfix-off-by-one,file-create]
//
// Models: "ollama:<name>" (local, OLLAMA_URL default http://127.0.0.1:11434),
// or "config" (the provider/model configured in --data-dir).
// Each run gets a fresh workspace; verdicts come from the task's on-disk
// verifier, never from the model's claim of success.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TASKS } from './tasks.mjs';
import { oracleProvider } from './oracle.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const all = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === `--${name}`) all.push(process.argv[i + 1]);
  return all.length ? all : fallback;
}

const models = arg('model', ['ollama:qwen3.5:9b']);
const repeats = Number(arg('repeats', ['1'])[0]) || 1;
const only = (arg('tasks', [''])[0] || '').split(',').filter(Boolean);
const turnTimeoutMs = Number(arg('timeout-ms', ['600000'])[0]);
const outDir = path.resolve(arg('out', [path.join(repo, 'evals', 'results')])[0]);
const tasks = TASKS.filter((t) => !only.length || only.includes(t.id));

if (process.argv.includes('--child')) {
  await runChild();
} else {
  await runParent();
}

// Each (model, task, repeat) runs in its own process: the runtime is one per
// process, and isolation keeps one run's state from leaking into the next.
async function runParent() {
  const startedAt = new Date().toISOString();
  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const rows = [];
  for (const model of models) {
    for (const task of tasks) {
      for (let r = 1; r <= repeats; r++) {
        const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', '--model', model, '--tasks', task.id, '--timeout-ms', String(turnTimeoutMs)], {
          cwd: repo, encoding: 'utf8', timeout: turnTimeoutMs + 60_000, env: { ...process.env, NODE_ENV: 'production' },
        });
        const line = (res.stdout || '').split('\n').find((l) => l.startsWith('EVAL_RESULT '));
        const row = line ? JSON.parse(line.slice('EVAL_RESULT '.length)) : { model, task: task.id, pass: false, detail: `runner crashed: ${(res.stderr || '').slice(-300)}`, elapsedMs: 0, toolCalls: 0 };
        row.repeat = r;
        rows.push(row);
        console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${model.padEnd(24)} ${task.id.padEnd(24)} #${r}  ${String(Math.round(row.elapsedMs / 1000)).padStart(4)}s  tools=${row.toolCalls}  ${row.detail}`);
      }
    }
  }
  const summary = {};
  for (const row of rows) {
    const s = (summary[row.model] ||= { runs: 0, passed: 0, byArea: {}, medianSeconds: 0, times: [] });
    s.runs += 1; s.passed += row.pass ? 1 : 0; s.times.push(row.elapsedMs);
    const a = (s.byArea[row.area] ||= { runs: 0, passed: 0 });
    a.runs += 1; a.passed += row.pass ? 1 : 0;
  }
  for (const s of Object.values(summary)) {
    s.times.sort((x, y) => x - y);
    s.medianSeconds = Math.round((s.times[Math.floor(s.times.length / 2)] || 0) / 100) / 10;
    s.passRate = Math.round((s.passed / Math.max(1, s.runs)) * 1000) / 10;
    delete s.times;
  }
  const report = { suite: 'prometheus-agent-evals', version: 1, commit, startedAt, finishedAt: new Date().toISOString(), host: { platform: process.platform, node: process.version, cpus: os.cpus().length }, repeats, tasks: tasks.map((t) => ({ id: t.id, area: t.area })), summary, rows };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `evals-${commit}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n${Object.entries(summary).map(([m, s]) => `${m}: ${s.passed}/${s.runs} (${s.passRate}%), median ${s.medianSeconds}s`).join('\n')}\nreport: ${file}`);
}

async function runChild() {
  const model = models[0];
  const task = tasks[0];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-eval-'));
  const workspaceDir = path.join(dataDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  task.seed(workspaceDir);

  let provider;
  let modelName;
  if (model === 'scripted:oracle') {
    // Harness self-test: a scripted "model" that performs the known-correct
    // tool calls for each task. Validates seeding, the runtime path and the
    // verifiers without a real model. Not a published result.
    provider = oracleProvider(task.id, workspaceDir);
  } else if (/^(openai_codex|anthropic|ollama|xai):/.test(model)) {
    // The embed API resolves approvals through its host callback, including
    // automatic denial. Real cloud evals must use the user-gated gateway runner.
    throw new Error('Cloud evals require evals/run-gateway-evals.mjs; embedded automatic approval resolution is forbidden');
  }
  const { createPrometheusRuntime } = require(path.join(repo, 'dist', 'embed', 'index.js'));
  // Eval host approval policy (what an unattended operator would allow): file
  // tools whose target resolves inside the eval workspace are approved;
  // everything else (outside paths, shell, external writes, unknown tools) is
  // denied. The stay-in-workspace task checks that this boundary holds.
  const FILE_TOOLS = /^(create_file|write_file|find_replace|replace_lines|insert_after|delete_lines|append_file|apply_patch|workspace_edit|mkdir)$/;
  const inside = (p) => {
    if (!p) return false;
    const abs = path.resolve(workspaceDir, String(p));
    return abs === workspaceDir || abs.startsWith(workspaceDir + path.sep);
  };
  const approve = (a) => {
    if (!FILE_TOOLS.test(String(a.toolName || ''))) return false;
    const args = a.args || {};
    const targets = [args.filename, args.path, args.file, args.destination].filter(Boolean);
    return targets.length > 0 && targets.every(inside);
  };
  const rt = await createPrometheusRuntime({ dataDir, workspaceDir, provider, approve });
  const started = Date.now();
  let run = { text: '', toolResults: [], timedOut: false };
  let crash = '';
  try {
    run = await rt.runTurn(task.prompt, { categories: ['workspace_write'], timeoutMs: turnTimeoutMs });
  } catch (err) {
    crash = String(err?.message || err);
  }
  let verdict;
  try { verdict = crash ? { pass: false, detail: `turn threw: ${crash}` } : await task.verify(workspaceDir, run); }
  catch (err) { verdict = { pass: false, detail: `verifier threw: ${err?.message || err}` }; }
  const row = {
    model, task: task.id, area: task.area, pass: verdict.pass === true,
    detail: String(verdict.detail || '').slice(0, 200),
    elapsedMs: Date.now() - started, toolCalls: run.toolResults.length, timedOut: run.timedOut === true,
    tools: run.toolResults.map((r) => ({ name: r.name, error: r.error, result: String(r.result || '').slice(0, 160) })),
  };
  await rt.close();
  process.stdout.write(`EVAL_RESULT ${JSON.stringify(row)}\n`);
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 2 }); } catch {}
  process.exit(0);
}
