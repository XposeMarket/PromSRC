/**
 * anthropic-cli-connect.ts
 * One-click "Connect Claude" for subscription (Pro/Max) users.
 *
 * Instead of asking users to open a terminal, run `claude setup-token`, and
 * paste the result, Prometheus drives the official Claude Code CLI itself:
 *
 *   1. Spawn `claude setup-token` in a hidden pseudo-terminal (node-pty).
 *   2. Point the CLI's BROWSER at a tiny shim script that only records the
 *      sign-in URL. The CLI then listens on a localhost callback port.
 *   3. The UI opens that URL in the user's real browser. The user approves.
 *   4. The browser redirects to the CLI's localhost callback, the CLI
 *      exchanges the code and prints the long-lived token.
 *   5. We read the token from the PTY output, store it in the vault via
 *      storeSetupToken(), and kill the PTY. The token never reaches the UI.
 *
 * Fallbacks: if the browser can't reach the localhost callback, the CLI asks
 * for a pasted code; submitAnthropicCliCode() forwards it to the PTY. If the
 * CLI is missing, installClaudeCli() runs Anthropic's official installer.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn as spawnChild } from 'child_process';
import { storeSetupToken } from './anthropic-oauth';

export type AnthropicCliConnectState =
  | 'idle'
  | 'starting'
  | 'awaiting_browser'
  | 'awaiting_code'
  | 'connected'
  | 'failed'
  | 'cancelled'
  | 'cli_missing'
  | 'installing'
  | 'install_failed';

export interface AnthropicCliConnectStatus {
  id: string | null;
  state: AnthropicCliConnectState;
  authUrl: string | null;
  manualUrl: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  cliPath: string | null;
}

interface Flow {
  id: string;
  state: AnthropicCliConnectState;
  authUrl: string | null;
  manualUrl: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  cliPath: string | null;
  term: any | null;
  tmpDir: string | null;
  output: string;
  timeout: NodeJS.Timeout | null;
  urlPoll: NodeJS.Timeout | null;
  tokenSettle: NodeJS.Timeout | null;
  configDir: string;
  accountId?: string;
}

const FLOW_TIMEOUT_MS = 10 * 60 * 1000;
const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/g;
const URL_RE = /https:\/\/[^\s"'<>\x07\x1b]+/g;

let flow: Flow | null = null;
let installState: { state: 'idle' | 'installing' | 'done' | 'failed'; error: string | null; log: string } = { state: 'idle', error: null, log: '' };

// ─── CLI discovery ──────────────────────────────────────────────────────────

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

export function findClaudeCli(): string | null {
  const override = String(process.env.PROMETHEUS_CLAUDE_CLI || '').trim();
  if (override && isFile(override)) return override;

  const home = os.homedir();
  const win = process.platform === 'win32';
  const known = win
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'claude', 'claude.exe'),
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        '/usr/bin/claude',
      ];
  for (const candidate of known) if (isFile(candidate)) return candidate;

  const exts = win ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, 'claude' + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// ─── Output parsing (exported for regression tests) ────────────────────────

/** Strip terminal control sequences. CSI sequences become a space so cursor
 *  moves never glue a token to the following word. */
export function cleanTerminalOutput(raw: string): string {
  return String(raw || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ')      // OSC (hyperlinks, titles)
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, ' ')          // CSI
    .replace(/\x1b[@-Z\\-_]/g, ' ')                           // other 2-byte escapes
    .replace(/[\b]/g, '');
}

export function extractSetupToken(raw: string): string | null {
  const flat = cleanTerminalOutput(raw).replace(/[\r\n]+/g, '');
  const matches = flat.match(TOKEN_RE);
  if (!matches || !matches.length) return null;
  // The longest match is the fully painted token.
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function extractAuthUrls(raw: string): string[] {
  const flat = cleanTerminalOutput(raw);
  return Array.from(new Set((flat.match(URL_RE) || []).filter(u => /oauth\/authorize/.test(u))));
}

export function needsPastedCode(raw: string): boolean {
  return /paste\s*code\s*here/i.test(cleanTerminalOutput(raw).replace(/\s+/g, ' ')) ||
    /pastecodehere/i.test(cleanTerminalOutput(raw).replace(/\s+/g, ''));
}

// ─── Flow control ───────────────────────────────────────────────────────────

function snapshot(): AnthropicCliConnectStatus {
  if (!flow) {
    return { id: null, state: installState.state === 'installing' ? 'installing' : 'idle', authUrl: null, manualUrl: null, error: installState.state === 'failed' ? installState.error : null, startedAt: null, finishedAt: null, cliPath: findClaudeCli() };
  }
  return {
    id: flow.id,
    state: flow.state,
    authUrl: flow.authUrl,
    manualUrl: flow.manualUrl,
    error: flow.error,
    startedAt: flow.startedAt,
    finishedAt: flow.finishedAt,
    cliPath: flow.cliPath,
  };
}

function cleanup(f: Flow): void {
  if (f.timeout) clearTimeout(f.timeout);
  if (f.urlPoll) clearInterval(f.urlPoll);
  if (f.tokenSettle) clearTimeout(f.tokenSettle);
  f.timeout = null; f.urlPoll = null; f.tokenSettle = null;
  try { f.term?.kill(); } catch { /* already gone */ }
  f.term = null;
  if (f.tmpDir) {
    try { fs.rmSync(f.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    f.tmpDir = null;
  }
  // Drop captured output: it may contain the token.
  f.output = '';
}

function finish(f: Flow, state: AnthropicCliConnectState, error: string | null = null): void {
  if (flow !== f) return;
  if (['connected', 'failed', 'cancelled', 'cli_missing'].includes(f.state)) return;
  f.state = state;
  f.error = error;
  f.finishedAt = Date.now();
  cleanup(f);
}

function tryStoreToken(f: Flow): boolean {
  const token = extractSetupToken(f.output);
  if (!token) return false;
  const result = storeSetupToken(f.configDir, token, f.accountId);
  if (result.success) finish(f, 'connected');
  else finish(f, 'failed', result.error || 'Could not store the Claude token.');
  return true;
}

function writeBrowserShim(dir: string): string {
  const urlFile = path.join(dir, 'auth-url.txt');
  if (process.platform === 'win32') {
    const shim = path.join(dir, 'open-url.cmd');
    fs.writeFileSync(shim, `@echo off\r\n>>"${urlFile}" echo %*\r\nexit /b 0\r\n`, 'utf8');
    return shim;
  }
  const shim = path.join(dir, 'open-url.sh');
  fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${urlFile}"\nexit 0\n`, 'utf8');
  fs.chmodSync(shim, 0o755);
  return shim;
}

function readShimUrl(dir: string | null): string | null {
  if (!dir) return null;
  try {
    const text = fs.readFileSync(path.join(dir, 'auth-url.txt'), 'utf8');
    const match = text.match(URL_RE);
    return match ? match[match.length - 1].replace(/["']+$/, '') : null;
  } catch {
    return null;
  }
}

export function getAnthropicCliConnectStatus(): AnthropicCliConnectStatus {
  return snapshot();
}

export function startAnthropicCliConnect(configDir: string, accountId?: string): AnthropicCliConnectStatus {
  if (flow && ['starting', 'awaiting_browser', 'awaiting_code'].includes(flow.state)) {
    return snapshot();
  }
  if (flow) cleanup(flow);

  const cliPath = findClaudeCli();
  const f: Flow = {
    id: `claude_${Date.now().toString(36)}`,
    state: 'starting',
    authUrl: null,
    manualUrl: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    cliPath,
    term: null,
    tmpDir: null,
    output: '',
    timeout: null,
    urlPoll: null,
    tokenSettle: null,
    configDir,
    accountId,
  };
  flow = f;

  if (!cliPath) {
    f.state = 'cli_missing';
    f.error = 'Claude Code is not installed on this computer.';
    f.finishedAt = Date.now();
    return snapshot();
  }

  let pty: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pty = require('node-pty');
  } catch (err: any) {
    finish(f, 'failed', 'Terminal support (node-pty) is unavailable: ' + (err?.message || err));
    return snapshot();
  }

  try {
    f.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-claude-connect-'));
    const shim = writeBrowserShim(f.tmpDir);
    const isCmd = /\.(cmd|bat)$/i.test(cliPath);
    const file = isCmd ? (process.env.ComSpec || 'cmd.exe') : cliPath;
    const args = isCmd ? ['/d', '/s', '/c', cliPath, 'setup-token'] : ['setup-token'];
    f.term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 400,
      rows: 60,
      cwd: os.homedir(),
      env: { ...process.env, BROWSER: shim, FORCE_COLOR: '0', CI: '' },
    });
  } catch (err: any) {
    finish(f, 'failed', 'Could not start Claude Code: ' + (err?.message || err));
    return snapshot();
  }

  f.term.onData((chunk: string) => {
    if (flow !== f) return;
    f.output += chunk;
    if (f.output.length > 200_000) f.output = f.output.slice(-100_000);
    if (!f.manualUrl) {
      const urls = extractAuthUrls(f.output);
      const manual = urls.find(u => /platform\.claude\.com|console\.anthropic\.com/.test(decodeURIComponent(u)));
      if (manual) f.manualUrl = manual;
    }
    if (f.state === 'awaiting_browser' && needsPastedCode(f.output) && !f.authUrl) {
      // No localhost callback URL was produced: the CLI wants a pasted code.
      f.authUrl = f.manualUrl;
      f.state = 'awaiting_code';
    }
    if (extractSetupToken(f.output) && !f.tokenSettle) {
      // Give the TUI a moment to finish painting the whole token.
      f.tokenSettle = setTimeout(() => { if (flow === f) tryStoreToken(f); }, 1200);
    }
  });

  f.term.onExit(({ exitCode }: { exitCode: number }) => {
    if (flow !== f) return;
    if (tryStoreToken(f)) return;
    if (f.state === 'cancelled') return;
    finish(f, 'failed', exitCode === 0
      ? 'Claude Code finished without returning a token. A Claude Pro or Max subscription is required.'
      : `Claude Code exited before connecting (code ${exitCode}).`);
  });

  f.urlPoll = setInterval(() => {
    if (flow !== f) return;
    const url = readShimUrl(f.tmpDir);
    if (url && url !== f.authUrl) {
      f.authUrl = url;
      if (f.state === 'starting' || f.state === 'awaiting_code') f.state = 'awaiting_browser';
    } else if (f.state === 'starting' && f.manualUrl && Date.now() - f.startedAt > 8000) {
      // The CLI printed a manual URL but never invoked the browser shim.
      f.authUrl = f.manualUrl;
      f.state = 'awaiting_code';
    }
  }, 300);

  f.timeout = setTimeout(() => finish(f, 'failed', 'Timed out waiting for Claude approval. Try again.'), FLOW_TIMEOUT_MS);
  return snapshot();
}

export function submitAnthropicCliCode(code: string): AnthropicCliConnectStatus {
  const trimmed = String(code || '').trim();
  if (!flow || !flow.term || !['awaiting_browser', 'awaiting_code'].includes(flow.state)) {
    return { ...snapshot(), error: 'No Claude connection is waiting for a code. Start again.' };
  }
  if (!trimmed) return { ...snapshot(), error: 'Paste the code from the Claude page.' };
  // A pasted setup-token (manual terminal flow) is accepted directly.
  if (/^sk-ant-(oat|api)/.test(trimmed)) {
    const f = flow;
    const result = storeSetupToken(f.configDir, trimmed, f.accountId);
    if (result.success) finish(f, 'connected');
    else return { ...snapshot(), error: result.error || 'Invalid token.' };
    return snapshot();
  }
  try { flow.term.write(trimmed + '\r'); } catch { /* exit handler reports */ }
  return snapshot();
}

export function cancelAnthropicCliConnect(): AnthropicCliConnectStatus {
  if (flow && !['connected', 'failed', 'cancelled'].includes(flow.state)) {
    const f = flow;
    f.state = 'cancelled';
    f.finishedAt = Date.now();
    cleanup(f);
  }
  return snapshot();
}

// ─── Installer ──────────────────────────────────────────────────────────────

export function getClaudeInstallStatus() {
  return { ...installState, log: installState.log.slice(-2000), cliPath: findClaudeCli() };
}

/** Run Anthropic's official native installer for Claude Code. */
export function installClaudeCli(): ReturnType<typeof getClaudeInstallStatus> {
  if (installState.state === 'installing') return getClaudeInstallStatus();
  installState = { state: 'installing', error: null, log: '' };
  const win = process.platform === 'win32';
  const child = win
    ? spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { windowsHide: true })
    : spawnChild('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], {});
  const onData = (d: Buffer) => { installState.log = (installState.log + d.toString()).slice(-20_000); };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 5 * 60 * 1000);
  child.on('error', (err) => {
    clearTimeout(timer);
    installState.state = 'failed';
    installState.error = err.message;
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (installState.state !== 'installing') return;
    if (code === 0 && findClaudeCli()) {
      installState.state = 'done';
      if (flow?.state === 'cli_missing') flow = null;
    } else {
      installState.state = 'failed';
      installState.error = code === 0
        ? 'The installer finished but Claude Code was not found. Restart Prometheus and try again.'
        : `The installer exited with code ${code}.`;
    }
  });
  return getClaudeInstallStatus();
}
