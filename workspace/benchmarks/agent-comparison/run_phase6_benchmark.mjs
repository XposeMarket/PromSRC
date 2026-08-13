#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const benchRoot = path.join(repoRoot, 'workspace', 'benchmarks', 'agent-comparison');
const model = 'gpt-5.6-luna';
const reasoning = 'high';
const openclawGatewayPort = 19089;

const laneDefs = {
  file_ops_basic_v1: {
    capability: 'workspace_files',
    passToken: 'FILE_OPS_BASIC_V1_PASS',
    prompt: 'file_ops_basic_v1.md',
  },
  shell_ops_basic_v1: {
    capability: 'shell',
    passToken: 'SHELL_OPS_BASIC_V1_PASS',
    prompt: 'shell_ops_basic_v1.md',
  },
  local_web_debug_v1: {
    capability: 'browser',
    passToken: 'LOCAL_WEB_DEBUG_V1_PASS',
    prompt: 'local_web_debug_v1.md',
  },
  browser_external_v1: {
    capability: 'browser',
    passToken: 'BROWSER_EXTERNAL_V1_PASS',
    prompt: 'browser_external_v1.md',
    evidencePattern: /browser|playwright|chrom(?:e|ium)|page\.goto|open_url/i,
  },
  browser_fixture_mock_captcha_v1: {
    capability: 'browser',
    passToken: 'BROWSER_FIXTURE_MOCK_CAPTCHA_V1_PASS',
    prompt: 'browser_fixture_mock_captcha_v1.md',
    evidencePattern: /browser|playwright|chrom(?:e|ium)|page\.goto|open_url|snapshot/i,
  },
  desktop_basic_v1: {
    capability: 'desktop',
    passToken: 'DESKTOP_BASIC_V1_PASS',
    prompt: 'desktop_basic_v1.md',
    evidencePattern: /desktop|screenshot|screen|window|computer/i,
  },
  website_creation_no_skills_v1: {
    capability: 'workspace_files',
    passToken: 'WEBSITE_CREATION_NO_SKILLS_V1_PASS',
    prompt: 'website_creation_no_skills_v1.md',
  },
  website_creation_with_skills_v1: {
    capability: 'workspace_files',
    passToken: 'WEBSITE_CREATION_WITH_SKILLS_V1_PASS',
    prompt: 'website_creation_with_skills_v1.md',
  },
  threejs_object_v1: {
    capability: 'workspace_files',
    passToken: 'THREEJS_OBJECT_V1_PASS',
    prompt: 'threejs_object_v1.md',
  },
  threejs_scene_v1: {
    capability: 'workspace_files',
    passToken: 'THREEJS_SCENE_V1_PASS',
    prompt: 'threejs_scene_v1.md',
  },
  threejs_game_v1: {
    capability: 'workspace_files',
    passToken: 'THREEJS_GAME_V1_PASS',
    prompt: 'threejs_game_v1.md',
  },
  threejs_cinematic_v1: {
    capability: 'workspace_files',
    passToken: 'THREEJS_CINEMATIC_V1_PASS',
    prompt: 'threejs_cinematic_v1.md',
  },
  research_x_readonly_v1: {
    capability: 'browser',
    passToken: 'RESEARCH_X_READONLY_V1_PASS',
    prompt: 'research_x_readonly_v1.md',
    evidencePattern: /x\.com/i,
  },
  research_reddit_readonly_v1: {
    capability: 'browser',
    passToken: 'RESEARCH_REDDIT_READONLY_V1_PASS',
    prompt: 'research_reddit_readonly_v1.md',
    evidencePattern: /reddit\.com/i,
  },
  research_news_readonly_v1: {
    capability: 'browser',
    passToken: 'RESEARCH_NEWS_READONLY_V1_PASS',
    prompt: 'research_news_readonly_v1.md',
    evidencePattern: /bbc\.com|reuters\.com|apnews\.com/i,
  },
  research_docs_readonly_v1: {
    capability: 'browser',
    passToken: 'RESEARCH_DOCS_READONLY_V1_PASS',
    prompt: 'research_docs_readonly_v1.md',
    evidencePattern: /developer\.mozilla\.org|docs\.python\.org/i,
  },
};

const runtimeLabels = {
  prometheus: 'prometheus_codex_http',
  hermes: 'hermes_codex_http',
  openclaw: 'openclaw_codex_app_server',
};

const stableWorkspaceRoots = {
  prometheus: path.join(repoRoot, '.tmp', 'phase6-workspaces', 'prometheus-benchmark'),
  hermes: path.join(repoRoot, '.tmp', 'phase6-workspaces', 'hermes-benchmark'),
  openclaw: path.join(repoRoot, '.tmp', 'phase6-workspaces', 'openclaw-benchmark'),
};

function parseArgs(argv) {
  const out = {
    lanes: ['file_ops_basic_v1', 'shell_ops_basic_v1'],
    agents: ['prometheus', 'hermes', 'openclaw'],
    timeoutMs: 12 * 60 * 1000,
    prometheusPort: 0,
    keepGateway: false,
    reportRun: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--lanes') out.lanes = String(next() || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--agents') out.agents = String(next() || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--timeout-ms') out.timeoutMs = Math.max(30_000, Number(next()) || out.timeoutMs);
    else if (arg === '--prometheus-port') out.prometheusPort = Math.max(0, Number(next()) || 0);
    else if (arg === '--keep-prometheus-gateway') out.keepGateway = true;
    else if (arg === '--report-run') out.reportRun = String(next() || '').trim();
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node run_phase6_benchmark.mjs [--lanes a,b] [--agents prometheus,hermes,openclaw] [--timeout-ms N] [--prometheus-port N] [--keep-prometheus-gateway]');
      process.exit(0);
    }
  }
  return out;
}

function stamp() {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return iso.slice(0, 15);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function rel(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(text ?? ''), 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function within(root, candidate) {
  const rootAbs = path.resolve(root);
  const candidateAbs = path.resolve(candidate);
  return candidateAbs === rootAbs || candidateAbs.startsWith(`${rootAbs}${path.sep}`);
}

async function resetLaneWorkspace(workspaceRoot, benchmarkId) {
  const fixtureRoot = path.join(workspaceRoot, 'benchmarks', 'agent-comparison', 'fixtures', benchmarkId);
  if (!within(workspaceRoot, fixtureRoot)) throw new Error(`Refusing to reset path outside benchmark workspace: ${fixtureRoot}`);
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.mkdir(fixtureRoot, { recursive: true });
  return fixtureRoot;
}

async function prepareWorkspace(workspaceRoot, benchmarkId) {
  await fs.mkdir(workspaceRoot, { recursive: true });
  const promptDest = path.join(workspaceRoot, 'benchmarks', 'agent-comparison', 'prompts');
  await fs.mkdir(promptDest, { recursive: true });
  const sourcePrompts = path.join(benchRoot, 'prompts');
  await fs.cp(sourcePrompts, promptDest, { recursive: true, force: true });
  const fixtureRoot = await resetLaneWorkspace(workspaceRoot, benchmarkId);
  const seededFixture = path.join(benchRoot, 'fixtures', benchmarkId);
  if (await exists(seededFixture)) await fs.cp(seededFixture, fixtureRoot, { recursive: true, force: true });
  return fixtureRoot;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnCapture(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 12 * 60 * 1000;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const started = Date.now();
    const terminateTree = () => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
        killer.on('error', () => {});
      } else {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref?.();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree();
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${error.stack || error.message}`, exitCode: -1, timedOut, wallMs: Date.now() - started });
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? -1, signal, timedOut, wallMs: Date.now() - started });
    });
  });
}

async function findFreePort(preferred = 0) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = preferred ? preferred + attempt : 0;
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(candidate, '127.0.0.1', () => {
        const chosen = server.address()?.port;
        server.close(() => resolve(chosen));
      });
    }).catch(() => null);
    if (port) return port;
  }
  throw new Error('Could not find a free local benchmark port');
}

async function fetchHealth(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

class PrometheusGateway {
  constructor(workspaceRoot, port, logDir) {
    this.workspaceRoot = workspaceRoot;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.logDir = logDir;
    this.child = null;
    this.stdout = '';
    this.stderr = '';
    this.startupMs = null;
  }

  async start() {
    await fs.mkdir(this.logDir, { recursive: true });
    const env = { ...process.env };
    env.PROMETHEUS_WORKSPACE_DIR = this.workspaceRoot;
    env.PROMETHEUS_GATEWAY_PORT = String(this.port);
    env.PROMETHEUS_PROVIDER = 'openai_codex';
    env.CODEX_MODEL = model;
    env.CODEX_REASONING_EFFORT = reasoning;
    env.PROMETHEUS_DISABLE_GATEWAY_SUPERVISOR = '1';
    const startedAt = Date.now();
    this.child = spawn(process.execPath, [path.join(repoRoot, 'dist', 'gateway', 'server-v2.js')], {
      cwd: repoRoot,
      env,
      windowsHide: true,
      shell: false,
    });
    this.child.stdout?.on('data', (chunk) => { this.stdout += chunk.toString(); });
    this.child.stderr?.on('data', (chunk) => { this.stderr += chunk.toString(); });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`Prometheus gateway exited before readiness (code ${this.child.exitCode})`);
      }
      if (await fetchHealth(this.url)) {
        this.startupMs = Date.now() - startedAt;
        await this.flushLogs();
        return;
      }
      await sleep(500);
    }
    await this.flushLogs();
    throw new Error(`Prometheus gateway did not become healthy at ${this.url}`);
  }

  async flushLogs() {
    await writeText(path.join(this.logDir, 'gateway.stdout.txt'), this.stdout);
    await writeText(path.join(this.logDir, 'gateway.stderr.txt'), this.stderr);
  }

  async stop() {
    if (this.child && this.child.exitCode === null) {
      try { this.child.kill(); } catch {}
      await sleep(500);
    }
    await this.flushLogs();
  }

  async request(benchmarkId, prompt, sessionId, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const events = [];
    let finalText = '';
    let responseError = '';
    try {
      const response = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId,
          message: prompt,
          callerContext: `[LOCAL BENCHMARK] Phase 6 lane ${benchmarkId}. Use only the isolated benchmark workspace.`,
          origin: {
            channel: 'terminal',
            surface: 'benchmark',
            device: 'computer',
            label: 'phase6 orchestrator',
            source: 'local_benchmark',
          },
        }),
      });
      if (!response.ok || !response.body) {
        responseError = `${response.status}: ${await response.text().catch(() => '')}`;
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const consume = (block) => {
          const dataLines = block.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (!dataLines.length) return;
          const raw = dataLines.join('\n').trim();
          if (!raw || raw === '[DONE]') return;
          try {
            const event = JSON.parse(raw);
            events.push(event);
            if (event.type === 'final' && typeof event.text === 'string') finalText = event.text;
            if (event.type === 'done' && !finalText && typeof event.reply === 'string') finalText = event.reply;
            if (event.type === 'error') responseError = String(event.message || event.error || 'gateway error');
          } catch {
            events.push({ type: 'unparsed', raw: raw.slice(0, 20_000) });
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || '';
          for (const block of blocks) consume(block);
        }
        consume(buffer);
      }
    } catch (error) {
      responseError = error?.name === 'AbortError' ? 'request timed out' : (error?.stack || error?.message || String(error));
    } finally {
      clearTimeout(timer);
    }
    return { events, finalText, responseError, wallMs: Date.now() - startedAt, sessionId };
  }
}

function extractBlockedReason(text) {
  const match = String(text || '').match(/[A-Z][A-Z0-9_]+_BLOCKED:\s*(.+)/i);
  if (!match) return null;
  const reason = match[1].trim().split(/\r?\n/)[0].replace(/[ `"'.,]+$/, '');
  if (!reason || /^<[^>]+>$/i.test(reason)) return null;
  return reason.slice(0, 500);
}

function likelyCapabilityBlocked(text, capability) {
  if (!['browser', 'desktop'].includes(capability)) return null;
  const value = String(text || '');
  const patterns = capability === 'browser'
    ? [/browser(?: tool| automation| access)?[^\n]{0,80}(?:unavailable|not available|missing|disabled)/i, /no browser/i, /cannot (?:open|use|access).{0,30}browser/i]
    : [/desktop(?: tool| automation| access)?[^\n]{0,80}(?:unavailable|not available|missing|disabled)/i, /no (?:host )?desktop/i, /cannot (?:observe|use|access).{0,30}(?:desktop|screen)/i];
  const hit = patterns.find((pattern) => pattern.test(value));
  return hit ? 'required capability unavailable' : null;
}

function providerSetupBlocked(text) {
  const value = String(text || '');
  if (!/(auth|credential|provider|model|codex|gateway)/i.test(value)) return null;
  if (/(not authenticated|authentication required|no refresh token|provider unavailable|provider not configured|unsupported model|failed to launch|command not found|not installed)/i.test(value)) {
    return 'harness/provider unavailable during setup';
  }
  return null;
}

async function verifyArtifacts(benchmarkId, workspaceRoot) {
  const fixtureRoot = path.join(workspaceRoot, 'benchmarks', 'agent-comparison', 'fixtures', benchmarkId);
  const artifacts = [];
  const notes = [];
  if (await exists(fixtureRoot)) artifacts.push(rel(fixtureRoot));
  if (benchmarkId === 'file_ops_basic_v1') {
    const input = await readText(path.join(fixtureRoot, 'input.txt'));
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const ok = input === 'alpha\nbravo\ncharlie\n'
      && /# file_ops_basic_v1 report/.test(report)
      && /found_bravo:\s*true/.test(report)
      && /line_count:\s*3/.test(report);
    notes.push(ok ? 'input and report contents verified' : 'input/report contents did not match the lane contract');
    return { ok, artifacts, notes };
  }
  if (benchmarkId === 'shell_ops_basic_v1') {
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const ok = /node/i.test(report) && /(command.?not.?found|not found|nonexistent|classification)/i.test(report);
    notes.push(ok ? 'shell report contains version and failure classification' : 'shell report missing required evidence');
    return { ok, artifacts, notes };
  }
  if (benchmarkId === 'local_web_debug_v1') {
    const html = await readText(path.join(fixtureRoot, 'index.html'));
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const ok = /local_web_debug_v1/.test(html)
      && /Increment/.test(html)
      && /count/i.test(html)
      && /(count\s*[:=]\s*1|count=1|final verification)/i.test(report);
    notes.push(ok ? 'counter source and final report evidence present' : 'counter source/report evidence missing');
    return { ok, artifacts, notes };
  }
  if (benchmarkId === 'browser_fixture_mock_captcha_v1') {
    const html = await readText(path.join(fixtureRoot, 'index.html'));
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const ok = /mock-captcha|mockCaptcha|I.{0,3}m not a robot \(mock\)/i.test(html)
      && /query(?: entered)?\s*:\s*.*Luna high/i.test(report)
      && /mock(?: captcha)?\s*status\s*:\s*.*(?:true|complete|checked|one click)/i.test(report)
      && /final\s+success\s+status\s*:\s*.*(?:visible|true|complete|passed)/i.test(report);
    notes.push(ok ? 'fixture contract and browser report verified' : 'fixture/report missing query, mock CAPTCHA, or completion evidence');
    return { ok, artifacts, notes };
  }
  if (benchmarkId.startsWith('website_creation_')) {
    const html = await readText(path.join(fixtureRoot, 'index.html'));
    const css = await readText(path.join(fixtureRoot, 'styles.css'));
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const ok = /Luna Benchmark Studio/.test(html)
      && /hero|feature|call[- ]?to[- ]?action/i.test(html)
      && /@media/i.test(css)
      && /report|verified|responsive/i.test(report);
    notes.push(ok ? 'website source, responsive CSS, and report verified' : 'website source/report missing required structure');
    return { ok, artifacts, notes };
  }
  if (benchmarkId.startsWith('threejs_')) {
    const html = await readText(path.join(fixtureRoot, 'index.html'));
    const scene = await readText(path.join(fixtureRoot, 'scene.js'));
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const common = /three|THREE|WebGLRenderer|PerspectiveCamera/i.test(`${html}\n${scene}`)
      && /report|verified|scene/i.test(report);
    const patterns = {
      threejs_object_v1: /Mesh|BoxGeometry|SphereGeometry|TorusKnotGeometry/i,
      threejs_scene_v1: /Scene|AmbientLight|DirectionalLight|add\s*\(/i,
      threejs_game_v1: /keydown|keyup|score|collision|velocity/i,
      threejs_cinematic_v1: /camera|timeline|lerp|keyframe|animation|duration/i,
    };
    const ok = common && patterns[benchmarkId].test(`${html}\n${scene}`);
    notes.push(ok ? 'Three.js source contract and report verified' : 'Three.js source/report missing required constructs');
    return { ok, artifacts, notes };
  }
  if (benchmarkId.startsWith('research_')) {
    const report = await readText(path.join(fixtureRoot, 'report.md'));
    const domains = {
      research_x_readonly_v1: /x\.com/i,
      research_reddit_readonly_v1: /reddit\.com/i,
      research_news_readonly_v1: /bbc\.com|reuters\.com|apnews\.com/i,
      research_docs_readonly_v1: /developer\.mozilla\.org|docs\.python\.org/i,
    };
    const ok = domains[benchmarkId].test(report)
      && /https?:\/\//i.test(report)
      && /read[- ]only|no login|without login/i.test(report)
      && report.length >= 180;
    notes.push(ok ? 'read-only source URL, findings, and report verified' : 'research report missing source/read-only evidence');
    return { ok, artifacts, notes };
  }
  return { ok: true, artifacts, notes: ['no filesystem artifact contract for this lane'] };
}

async function snapshotArtifacts(workspaceRoot, benchmarkId, outDir) {
  const source = path.join(workspaceRoot, 'benchmarks', 'agent-comparison', 'fixtures', benchmarkId);
  const destination = path.join(outDir, 'artifacts', 'fixture');
  if (await exists(source)) await fs.cp(source, destination, { recursive: true, force: true });
  const files = [];
  async function walk(dir) {
    if (!(await exists(dir))) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(rel(full));
    }
  }
  await walk(destination);
  return files;
}

function parseHermesTelemetry(raw) {
  const events = String(raw || '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const modelEnds = events.filter((event) => event.type === 'model_call_end');
  const toolEnds = events.filter((event) => event.type === 'tool_call_end');
  return {
    events,
    modelCalls: modelEnds.length,
    modelLatencyMs: modelEnds.reduce((sum, event) => sum + Number(event.latency_ms || 0), 0),
    toolCalls: toolEnds.length,
    toolLatencyMs: toolEnds.reduce((sum, event) => sum + Number(event.latency_ms || 0), 0),
    toolErrors: toolEnds.filter((event) => event.status !== 'ok').length,
    retries: events.filter((event) => event.type === 'model_call_end' && Number(event.attempt || 1) > 1).length,
    tokensInput: modelEnds.reduce((sum, event) => sum + Number(event.input_tokens || 0), 0),
    tokensOutput: modelEnds.reduce((sum, event) => sum + Number(event.output_tokens || 0), 0),
    evidenceText: JSON.stringify(events),
  };
}

function parseJsonOutput(raw) {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractOutcomeMarker(raw, passToken) {
  const pass = String(passToken || '');
  if (!pass) return '';
  const blocked = pass.replace(/_PASS$/, '_BLOCKED');
  const pattern = new RegExp(`(?:${escapeRegExp(pass)}|${escapeRegExp(blocked)}):[^\\r\\n]*`, 'gi');
  const matches = [...String(raw || '').matchAll(pattern)];
  return matches.length ? matches.at(-1)[0].trim() : '';
}

function collectTextCandidates(value, key = '') {
  const output = [];
  if (typeof value === 'string' && /text|reply|content|message|summary|final/i.test(key)) output.push(value);
  else if (Array.isArray(value)) for (const item of value) output.push(...collectTextCandidates(item, key));
  else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) output.push(...collectTextCandidates(childValue, childKey));
  }
  return output;
}

function openclawRunInfo(parsed, passToken) {
  const candidates = collectTextCandidates(parsed);
  const finalText = candidates.find((text) => text.includes(passToken) || /_BLOCKED:/i.test(text))
    || candidates.sort((a, b) => b.length - a.length)[0]
    || '';
  const result = parsed?.result || parsed?.response || parsed || {};
  const meta = result?.meta || parsed?.meta || {};
  const trace = meta?.executionTrace || result?.executionTrace || parsed?.executionTrace || {};
  const usage = meta?.agentMeta?.usage || meta?.usage || result?.usage || {};
  const inputTokens = Number(usage.promptTokens ?? usage.input ?? usage.inputTokens ?? usage.input_tokens ?? 0) || null;
  const outputTokens = Number(usage.output ?? usage.outputTokens ?? usage.output_tokens ?? 0) || null;
  const toolSummary = meta?.toolSummary || result?.toolSummary || parsed?.toolSummary || {};
  const toolCalls = Number(toolSummary.calls ?? meta?.agentMeta?.toolCalls ?? meta?.toolCalls ?? 0) || 0;
  return {
    finalText,
    durationMs: Number(meta.durationMs || result.durationMs || parsed?.durationMs || 0) || null,
    provider: trace.winnerProvider || meta.provider || result.provider || 'codex',
    actualModel: trace.winnerModel || meta.model || result.model || model,
    fallbackUsed: Boolean(trace.fallbackUsed || trace.fallback),
    toolCalls,
    toolErrors: Number(toolSummary.failures || 0) || 0,
    inputTokens,
    outputTokens,
    reasoningEffort: meta?.requestShaping?.thinking || parsed?.requestShaping?.thinking || reasoning,
    evidenceText: JSON.stringify(parsed),
  };
}

async function readPrometheusSession(sessionId) {
  const sessionFile = path.join(repoRoot, '.prometheus', 'sessions', `${sessionId}.json`);
  if (!(await exists(sessionFile))) return null;
  try { return JSON.parse(await fs.readFile(sessionFile, 'utf8')); } catch { return null; }
}

async function repairSummaryFromEvidence(file, summary, runDir) {
  const agentDir = path.join(runDir, summary.agent, summary.benchmark_id);
  if (summary.agent === 'openclaw') {
    const parsed = parseJsonOutput(await readText(path.join(agentDir, 'stdout.txt')));
    if (parsed) {
      const info = openclawRunInfo(parsed, laneDefs[summary.benchmark_id]?.passToken || '');
      summary.model_calls = info.provider ? 1 : summary.model_calls;
      summary.model_latency_ms = info.durationMs;
      summary.tool_calls = info.toolCalls;
      summary.tool_errors = info.toolErrors;
      summary.tokens_input = info.inputTokens;
      summary.tokens_output = info.outputTokens;
      summary.model = info.actualModel || summary.model;
    }
  }
  if (summary.agent === 'prometheus') {
    const sessionFiles = (await fs.readdir(path.join(repoRoot, '.prometheus', 'sessions')).catch(() => []))
      .filter((name) => name.startsWith(`p6_${summary.benchmark_id}_`) && name.endsWith('.json'))
      .sort();
    const sessionFile = sessionFiles.at(-1);
    const session = sessionFile ? await readPrometheusSession(sessionFile.slice(0, -5)) : null;
    const history = Array.isArray(session?.history) ? session.history : [];
    const assistant = [...history].reverse().find((item) => item?.role === 'assistant');
    const usage = assistant?.turnProviderUsage;
    if (usage) {
      summary.model_calls = Number(usage.calls || 0) || null;
      summary.model_latency_ms = Number(usage.lastCall?.durationMs || 0) || null;
      summary.tokens_input = Number(usage.inputTokens || 0) || null;
      summary.tokens_output = Number(usage.outputTokens || 0) || null;
    }
  }
  const passToken = laneDefs[summary.benchmark_id]?.passToken;
  if (passToken && String(summary.final_output || '').includes(passToken)) summary.blocked_reason = null;
  await writeJson(file, summary);
  return summary;
}

function prometheusRunInfo(events, session, finalText) {
  const route = events.find((event) => event.type === 'chat_model_route')?.effective || {};
  const history = Array.isArray(session?.history) ? session.history : [];
  const assistant = [...history].reverse().find((item) => item?.role === 'assistant') || {};
  const usage = assistant.turnProviderUsage || {};
  const lastCall = usage.lastCall || {};
  const toolEventCount = events.filter((event) => /tool/i.test(String(event.type || ''))).length;
  return {
    finalText,
    provider: route.providerId || lastCall.provider || 'openai_codex',
    actualModel: route.model || lastCall.actualModel || model,
    reasoningEffort: route.reasoningEffort || reasoning,
    modelCalls: Number(usage.calls || (lastCall.provider ? 1 : 0)) || null,
    modelLatencyMs: Number(lastCall.durationMs || 0) || null,
    toolCalls: Number(usage.toolResultBudget?.calls || toolEventCount || 0),
    toolErrors: Number(usage.toolResultBudget?.toolErrors || 0),
    inputTokens: Number(lastCall.inputTokens || usage.inputTokens || 0) || null,
    outputTokens: Number(lastCall.outputTokens || usage.outputTokens || 0) || null,
    durationMs: Number(lastCall.durationMs || 0) || null,
    evidenceText: `${JSON.stringify(events)} ${JSON.stringify(session || {})}`,
  };
}

async function assess({ benchmarkId, lane, agent, exitCode, timedOut, stdout, stderr, finalText, telemetry, extraInfo, verifier, artifacts }) {
  const decisionText = `${stdout}\n${stderr}\n${finalText}`;
  const combined = `${decisionText}\n${extraInfo?.evidenceText || ''}\n${telemetry?.evidenceText || ''}`;
  const explicitBlocked = extractBlockedReason(decisionText);
  const capabilityBlocked = finalText.includes(lane.passToken)
    ? null
    : likelyCapabilityBlocked(decisionText, lane.capability);
  const setupBlocked = providerSetupBlocked(`${stdout}\n${stderr}`);
  const evidenceOk = !lane.evidencePattern || lane.evidencePattern.test(extraInfo?.evidenceText || '') || lane.evidencePattern.test(telemetry?.evidenceText || '');
  let status = 'fail';
  let blockedReason = null;
  if (timedOut) {
    blockedReason = null;
  } else if (explicitBlocked || capabilityBlocked || (setupBlocked && !finalText)) {
    status = 'blocked';
    blockedReason = explicitBlocked || capabilityBlocked || setupBlocked;
  } else if (exitCode === 0 && finalText.includes(lane.passToken) && verifier.ok && evidenceOk) {
    status = 'pass';
  }
  const notes = [...(verifier.notes || [])];
  if (lane.evidencePattern && !evidenceOk) notes.push('required browser/desktop evidence was not observed in captured runtime data');
  if (timedOut) notes.push('process exceeded the benchmark timeout');
  if (exitCode !== 0) notes.push(`process exit code ${exitCode}`);
  return { status, blockedReason, notes, evidenceOk };
}

async function runHermes({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs, runId, lane }) {
  const hermesPython = path.join(repoRoot, 'workspace', 'oss agents', 'hermes-agent', '.venv', 'Scripts', 'python.exe');
  const hermesEntry = path.join(repoRoot, 'workspace', 'oss agents', 'hermes-agent-latest-v2026.8.3', 'hermes');
  const telemetryPath = path.join(outDir, 'events.jsonl');
  const env = { ...process.env,
    HERMES_TELEMETRY_PATH: telemetryPath,
    HERMES_BENCHMARK_RUN_ID: `${runId}_hermes_${benchmarkId}`,
    HERMES_BENCHMARK_ID: benchmarkId,
  };
  const outputMode = ['browser', 'desktop'].includes(lane?.capability) ? '--verbose' : '--quiet';
  const result = await spawnCapture(hermesPython, [hermesEntry, 'chat', '--provider', 'openai-codex', '--model', model, '--reasoning', reasoning, outputMode, '--no-restore-cwd', '--max-turns', '80', '--query', prompt, '--source', 'local_benchmark'], {
    cwd: workspaceRoot,
    env,
    timeoutMs,
  });
  await writeText(path.join(outDir, 'stdout.txt'), result.stdout);
  await writeText(path.join(outDir, 'stderr.txt'), result.stderr);
  const telemetry = parseHermesTelemetry(await readText(telemetryPath));
  const finalText = extractOutcomeMarker(result.stdout, laneDefs[benchmarkId].passToken) || result.stdout.trim();
  return {
    ...result,
    finalText,
    telemetry,
    extraInfo: { evidenceText: `${result.stdout}\n${result.stderr}\n${telemetry.evidenceText || ''}` },
    runtime: runtimeLabels.hermes,
    model,
    reasoning,
  };
}

async function runOpenclaw({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs, runId }) {
  const nodeDir = path.join(repoRoot, '.tmp', 'node-v24.15.0', 'node-v24.15.0-win-x64');
  const openclawRoot = path.join(repoRoot, 'workspace', 'oss agents', 'openclaw-latest-v2026.7.1-2');
  const openclawState = path.join(repoRoot, '.tmp', 'openclaw-benchmark-state');
  const gatewayTokenPath = path.join(repoRoot, '.tmp', 'openclaw-browser-gateway', 'gateway.token');
  const gatewayToken = await readText(gatewayTokenPath);
  const env = { ...process.env,
    PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}`,
    OPENCLAW_STATE_DIR: openclawState,
    OPENCLAW_PROFILE: 'prometheus-benchmark',
    OPENCLAW_WORKSPACE_DIR: workspaceRoot,
    ...(gatewayToken.trim() ? { OPENCLAW_GATEWAY_TOKEN: gatewayToken.trim(), OPENCLAW_GATEWAY_PORT: String(openclawGatewayPort) } : {}),
  };
  const sessionKey = `p6_${safeName(runId)}_${safeName(benchmarkId)}`;
  const openclawNode = path.join(nodeDir, 'node.exe');
  const result = await spawnCapture(openclawNode, [path.join(openclawRoot, 'openclaw.mjs'), 'agent', '--local', '--session-key', sessionKey, '--model', `codex/${model}`, '--thinking', reasoning, '--timeout', '600', '--json', '--message', prompt], {
    cwd: openclawRoot,
    env,
    timeoutMs,
  });
  await writeText(path.join(outDir, 'stdout.txt'), result.stdout);
  await writeText(path.join(outDir, 'stderr.txt'), result.stderr);
  const parsed = parseJsonOutput(result.stdout);
  const info = openclawRunInfo(parsed || {}, laneDefs[benchmarkId].passToken);
  const finalText = info.finalText || result.stdout.trim();
  return { ...result, finalText, parsed, telemetry: null, extraInfo: info, runtime: runtimeLabels.openclaw, model: info.actualModel || model, reasoning: info.reasoningEffort || reasoning };
}

async function runPrometheus({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs, gateway, lane }) {
  const sessionId = `p6_${safeName(benchmarkId)}_${Date.now()}`;
  const result = await gateway.request(benchmarkId, prompt, sessionId, timeoutMs);
  await writeText(path.join(outDir, 'stdout.txt'), result.finalText);
  await writeText(path.join(outDir, 'stderr.txt'), result.responseError);
  await writeText(path.join(outDir, 'events.jsonl'), result.events.map((event) => JSON.stringify(event)).join('\n') + (result.events.length ? '\n' : ''));
  const session = await readPrometheusSession(sessionId);
  const info = prometheusRunInfo(result.events, session, result.finalText);
  return {
    exitCode: result.responseError ? 1 : 0,
    timedOut: /timed out/i.test(result.responseError),
    wallMs: result.wallMs,
    stdout: result.finalText,
    stderr: result.responseError,
    finalText: result.finalText,
    telemetry: null,
    extraInfo: info,
    session,
    runtime: runtimeLabels.prometheus,
    model: info.actualModel || model,
    reasoning: info.reasoningEffort || reasoning,
    gatewayPort: gateway.port,
    gatewayStartupMs: gateway.startupMs,
    lane,
  };
}

async function writeReport(reportPath, payload) {
  const rows = payload.results.map((item) => `| ${item.agent} | ${item.benchmark_id} | ${item.status} | ${item.total_wall_ms} | ${item.tool_calls ?? '—'} | ${item.model} | ${item.runtime} |`);
  const notes = payload.results.flatMap((item) => {
    const values = Array.isArray(item.notes)
      ? item.notes
      : String(item.notes || '').split('; ').map((note) => note.trim()).filter(Boolean);
    return values.map((note) => `- ${item.agent}/${item.benchmark_id}: ${note}`);
  });
  const text = [
    `# Phase 6 benchmark — ${payload.run_id}`,
    '',
    `Date: ${payload.date}`, '',
    'All lanes used `gpt-5.6-luna` with `high` reasoning. Runtime labels are preserved because OpenClaw uses its Codex app-server provider plugin, while Prometheus and Hermes call the Codex Responses endpoint directly.',
    '',
    '| Agent | Lane | Status | Wall ms | Tool calls | Model | Runtime |',
    '|---|---|---:|---:|---:|---|---|',
    ...rows,
    '',
    '## Verification notes',
    '',
    ...(notes.length ? notes : ['- None']),
    '',
    '## Fairness rules',
    '',
    '- `pass` requires the exact lane token plus independent artifact/evidence checks.',
    '- `fail` means the agent attempted the task but the result was incorrect or unverifiable.',
    '- `blocked` means the required capability or provider was unavailable; it is not scored as a quality failure.',
    '- Public-site actions in this run are read-only. No login, posting, purchase, CAPTCHA, or destructive action is permitted.',
    '',
  ].join('\n');
  await writeText(reportPath, text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.reportRun) {
    const candidate = path.isAbsolute(options.reportRun)
      ? options.reportRun
      : path.join(benchRoot, 'runs', dateStamp(), options.reportRun);
    const summaryFiles = [];
    async function collect(dir) {
      if (!(await exists(dir))) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await collect(full);
        else if (entry.name === 'summary.json') summaryFiles.push(full);
      }
    }
    await collect(candidate);
    const results = [];
    for (const file of summaryFiles) {
      try {
        const summary = JSON.parse(await fs.readFile(file, 'utf8'));
        results.push(await repairSummaryFromEvidence(file, summary, candidate));
      } catch {}
    }
    const runId = path.basename(candidate);
    const payload = { run_id: runId, date: path.basename(path.dirname(candidate)), model, reasoning_effort: reasoning, results };
    const reportPath = path.join(benchRoot, 'reports', `phase6-${runId}.md`);
    await writeReport(reportPath, payload);
    await writeJson(path.join(candidate, 'index.json'), payload);
    console.log(JSON.stringify({ run_id: runId, report: rel(reportPath), result_count: results.length }, null, 2));
    return;
  }
  const unknownLanes = options.lanes.filter((lane) => !laneDefs[lane]);
  const unknownAgents = options.agents.filter((agent) => !runtimeLabels[agent]);
  if (unknownLanes.length) throw new Error(`Unknown benchmark lane(s): ${unknownLanes.join(', ')}`);
  if (unknownAgents.length) throw new Error(`Unknown agent(s): ${unknownAgents.join(', ')}`);

  const runId = `phase6_${stamp()}_${Math.random().toString(36).slice(2, 8)}`;
  const date = dateStamp();
  const runRoot = path.join(benchRoot, 'runs', date, runId);
  await fs.mkdir(runRoot, { recursive: true });
  const results = [];
  let gateway = null;

  console.log(`[phase6] run=${runId} model=${model} reasoning=${reasoning}`);
  console.log(`[phase6] agents=${options.agents.join(',')} lanes=${options.lanes.join(',')}`);

  try {
    if (options.agents.includes('prometheus')) {
      const port = await findFreePort(options.prometheusPort || 8898);
      gateway = new PrometheusGateway(stableWorkspaceRoots.prometheus, port, path.join(runRoot, 'prometheus'));
      console.log(`[phase6] starting Prometheus gateway on ${gateway.url}`);
      await gateway.start();
      console.log(`[phase6] Prometheus gateway ready in ${gateway.startupMs}ms`);
    }

    for (const agent of options.agents) {
      const workspaceRoot = stableWorkspaceRoots[agent];
      await prepareWorkspace(workspaceRoot, options.lanes[0]);
      for (const benchmarkId of options.lanes) {
        const lane = laneDefs[benchmarkId];
        await prepareWorkspace(workspaceRoot, benchmarkId);
        const prompt = await readText(path.join(benchRoot, 'prompts', lane.prompt));
        const outDir = path.join(runRoot, agent, benchmarkId);
        await fs.mkdir(outDir, { recursive: true });
        await writeText(path.join(outDir, 'prompt.txt'), prompt);
        console.log(`[phase6] start ${agent}/${benchmarkId}`);
        const startedAt = new Date().toISOString();
        let execution;
        if (agent === 'prometheus') execution = await runPrometheus({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs: options.timeoutMs, gateway, lane });
        else if (agent === 'hermes') execution = await runHermes({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs: options.timeoutMs, runId, lane });
        else execution = await runOpenclaw({ benchmarkId, prompt, workspaceRoot, outDir, timeoutMs: options.timeoutMs, runId });
        const verifier = await verifyArtifacts(benchmarkId, workspaceRoot);
        const artifacts = await snapshotArtifacts(workspaceRoot, benchmarkId, outDir);
        const assessed = await assess({
          benchmarkId,
          lane,
          agent,
          exitCode: execution.exitCode,
          timedOut: execution.timedOut,
          stdout: execution.stdout,
          stderr: execution.stderr,
          finalText: execution.finalText,
          telemetry: execution.telemetry,
          extraInfo: execution.extraInfo,
          verifier,
          artifacts,
        });
        const usage = execution.extraInfo || {};
        const summary = {
          run_id: `${runId}_${agent}_${benchmarkId}`,
          agent,
          benchmark_id: benchmarkId,
          runtime: execution.runtime,
          model: execution.model || model,
          reasoning_effort: execution.reasoning || reasoning,
          measurement_mode: agent === 'prometheus' ? 'gateway_sse_with_session_telemetry' : 'black_box_cli_with_internal_telemetry_when_available',
          status: assessed.status,
          blocked_reason: assessed.blockedReason,
          started_at: startedAt,
          ended_at: new Date().toISOString(),
          total_wall_ms: execution.wallMs,
          gateway_startup_ms: execution.gatewayStartupMs ?? null,
          exit_code: execution.exitCode,
          model_calls: execution.telemetry?.modelCalls ?? usage.modelCalls ?? null,
          model_latency_ms: execution.telemetry?.modelLatencyMs ?? usage.modelLatencyMs ?? null,
          tool_calls: execution.telemetry?.toolCalls ?? usage.toolCalls ?? null,
          tool_latency_ms: execution.telemetry?.toolLatencyMs ?? null,
          tool_errors: execution.telemetry?.toolErrors ?? usage.toolErrors ?? null,
          retries: execution.telemetry?.retries ?? null,
          tokens_input: execution.telemetry?.tokensInput || usage.inputTokens || null,
          tokens_output: execution.telemetry?.tokensOutput || usage.outputTokens || null,
          estimated_cost_usd: null,
          artifacts,
          final_output: String(execution.finalText || '').slice(-8000),
          notes: assessed.notes.join('; '),
        };
        await writeJson(path.join(outDir, 'summary.json'), summary);
        results.push(summary);
        console.log(`[phase6] done ${agent}/${benchmarkId} => ${summary.status} (${summary.total_wall_ms}ms)`);
      }
    }
  } finally {
    if (gateway && !options.keepGateway) await gateway.stop();
    else if (gateway) await gateway.flushLogs();
  }

  const aggregate = { run_id: runId, date, model, reasoning_effort: reasoning, results };
  await writeJson(path.join(runRoot, 'index.json'), aggregate);
  await writeReport(path.join(benchRoot, 'reports', `phase6-${runId}.md`), aggregate);
  console.log(JSON.stringify({ run_id: runId, report: rel(path.join(benchRoot, 'reports', `phase6-${runId}.md`)), results }, null, 2));
}

main().catch((error) => {
  console.error(`[phase6] fatal: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});
