/**
 * terminal-ui.ts - Prometheus Gateway Terminal UI
 *
 * 3-phase experience:
 *   Phase 1: Animated loading screen — torch flickers immediately on launch
 *   Phase 2: Welcome panel — replaces the loading box in-place (same rows, no flash)
 *   Phase 3: Interactive REPL — boxed input, history, multiline, live streaming
 *
 * REPL features:
 *   - Persistent input history  (~/.prometheus/cli_history, up/down navigation)
 *   - Multiline input           (\ at end of line + Enter to continue)
 *   - Thinking spinner          (Braille spinner while awaiting first token)
 *   - Table stream buffering    (markdown tables flush all-at-once for alignment)
 *   - Cursor movement           (←/→/Home/End, reverse-video block cursor)
 *   - /model /tools /steer /resume (Ctrl+V preview, Ctrl+R rename, Ctrl+A clear)
 *
 * Design rules:
 *   - Gateway logs suppressed for entire process lifetime (accessible via /logs)
 *   - NO alternate screen buffer (breaks Windows Terminal + leaks logs)
 *   - Loading box and welcome panel share the same fixed row region → no flash
 *   - Responsive box width: scales between 50–110 chars based on terminal width
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import http from 'http';
import { randomUUID } from 'crypto';
import packageJson from '../../package.json';
import { setSessionChannelHint } from './comms/broadcaster.js';

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  orange:   '\x1b[38;2;255;159;67m',
  yellow:   '\x1b[38;2;255;214;165m',
  green:    '\x1b[38;2;107;203;119m',
  white:    '\x1b[97m',
  gray:     '\x1b[90m',
  red:      '\x1b[91m',
  amber:    '\x1b[38;2;255;180;50m',
  silver:   '\x1b[38;2;210;210;210m',
  lgray:    '\x1b[38;2;175;175;175m',
  mgray:    '\x1b[38;2;130;130;130m',
};
const co    = (color: string, text: string) => `${color}${text}${C.reset}`;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ─── Log suppression ──────────────────────────────────────────────────────────

let _logBuffer: string[] = [];
const _origLog   = console.log;
const _origWarn  = console.warn;
const _origError = console.error;

let _devlogLiveCb: ((line: string) => void) | null = null;

export function setDevlogLiveCallback(cb: ((line: string) => void) | null): void {
  _devlogLiveCb = cb;
}

export function suppressStartupLogs(): void {
  const intercept = (...args: any[]) => {
    const line = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    _logBuffer.push(line);
    _devlogLiveCb?.(line);
    if (line.includes('EADDRINUSE')) _origLog(line);
  };
  console.log   = intercept;
  console.warn  = intercept;
  console.error = intercept;
}

export function restoreConsole(): void { /* intentionally suppressed forever */ }
export function getStartupLogs(): string[] { return [..._logBuffer]; }
export function captureStartupLog(line: string): void {
  const text = String(line || '').trim();
  if (text) {
    _logBuffer.push(text);
    _devlogLiveCb?.(text);
  }
}

function isDevMode(): boolean {
  try { return fs.existsSync(path.join(process.cwd(), 'src', 'gateway', 'terminal-ui.ts')); }
  catch { return false; }
}

// ─── Server-ready signal ──────────────────────────────────────────────────────

export interface StatusBoardOptions {
  host: string;
  port: number;
  model: string;
  workspace: string;
  skillsTotal: number;
  skillsEnabled: number;
  searchStatus: string;
  memoryFiles: string;
  gpuInfo: string;
  cronJobCount: number;
  updateNotice?: string;
}

let _serverReady     = false;
let _serverReadyOpts: StatusBoardOptions | null = null;

// ─── Status bar counts (refreshed every 60s while idle) ───────────────────────
let _sbCounts = { teams: 0, tasks: 0, proposals: 0 };

// ─── Notification banner ──────────────────────────────────────────────────────
let _notifBanner: string | null = null;
let _notifBannerTimer: ReturnType<typeof setTimeout> | null = null;
let _idleRedrawFn: (() => void) | null = null;
let _lastNotifTeamId: string | null = null; // team ID of most-recent banner, for 'r' quick-reply

// ─── Response tracking ────────────────────────────────────────────────────────
let _lastResponse = ''; // last full AI response, available for Ctrl+Y clipboard copy

// ─── Code fence streaming state ──────────────────────────────────────────────
let _inCodeFence   = false;
let _codeFenceLang = '';

export function notifyServerReady(opts: StatusBoardOptions): void {
  _serverReadyOpts = opts;
  _serverReady     = true;
}

// ─── Terminal helpers ─────────────────────────────────────────────────────────

const out        = (s: string) => process.stdout.write(s);
const hideCursor = () => out('\x1b[?25l');
const showCursor = () => out('\x1b[?25h');
const moveTo     = (row: number, col: number) => out(`\x1b[${row};${col}H`);
const eraseLine  = () => out('\x1b[2K');
const clearScr   = () => out('\x1b[2J\x1b[H');
const sleep      = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const cols       = () => process.stdout.columns || 100;

// ─── Torch frames ─────────────────────────────────────────────────────────────

const FRAMES: string[][] = [
  ['      )          ', '     ) \\         ', '   / ) (  \\      ', '   \\(_)/         ', '   ▐  |  ▌       ', '   ▐█████▌       ', '   ▐█████▌       '],
  ['     (           ', '   ( ) )         ', '  ( \\(  /        ', '   \\(_)/         ', '   ▐  |  ▌       ', '   ▐█████▌       ', '   ▐█████▌       '],
  ['    )  )         ', '   ( ) (         ', '  /  ) \\  )      ', '   \\(_)/         ', '   ▐  |  ▌       ', '   ▐█████▌       ', '   ▐█████▌       '],
  ['     ) )         ', '    ( )(          ', '   / )(  \\       ', '   \\(_)/         ', '   ▐  |  ▌       ', '   ▐█████▌       ', '   ▐█████▌       '],
];

let _frame = 0, _tick = 0;
let _torchTimer: ReturnType<typeof setInterval> | null = null;
let _torchFn: (() => void) | null = null;

function torchRow(row: string, ri: number, flicker: number): string {
  if (ri >= 5) return `${C.mgray}${row}${C.reset}`;   // lighter body: medium grey
  if (ri === 4) return `${C.lgray}${row}${C.reset}`;  // wick cap: light grey
  if (ri === 3) return `${C.silver}${row}${C.reset}`; // bowl: silver/white
  // ri 0-2: flame with flicker
  if (flicker > 0.7) return `\x1b[93m${row}${C.reset}`;
  if (flicker > 0.3) return co(C.amber, row);
  return co(C.orange, row);
}

function getTorch(): string[] {
  const f = 0.4 + 0.6 * Math.abs(Math.sin(_tick * 0.7));
  return FRAMES[_frame].map((r, i) => torchRow(r, i, f));
}

function startTorch(fn: () => void): void {
  if (_torchTimer) return;
  _torchFn = fn;
  _torchTimer = setInterval(() => {
    _frame = (_frame + 1) % FRAMES.length;
    _tick++;
    _torchFn?.();
  }, 120);
  (_torchTimer as any).unref?.();
}

function setTorchFn(fn: () => void): void { _torchFn = fn; }
function stopTorch(): void {
  if (_torchTimer) { clearInterval(_torchTimer); _torchTimer = null; }
  _torchFn = null;
}

// ─── USER.md name ─────────────────────────────────────────────────────────────

function readName(workspace: string): string {
  try {
    const p = path.join(workspace, 'USER.md');
    if (!fs.existsSync(p)) return '';
    const m = fs.readFileSync(p, 'utf-8').match(/[-*]\s*Name:\s*(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

// ─── Responsive box dimensions ────────────────────────────────────────────────

let BOX_W    = 62;
let BOX_LEFT = 2;
const BOX_TOP_ROW = 2;
const TORCH_H     = 7;
let LEFT_W   = 26;
const DIV_COL     = 1;
let RIGHT_W  = BOX_W - LEFT_W - DIV_COL;

function refreshBoxDims(): void {
  const termCols = cols();
  BOX_W   = Math.min(Math.max(50, termCols - 6), 110);
  BOX_LEFT = Math.max(2, Math.floor((termCols - BOX_W - 2) / 2));
  LEFT_W  = Math.min(26, Math.floor(BOX_W * 0.42));
  RIGHT_W = BOX_W - LEFT_W - DIV_COL;
}

// ─── Phase 1: Loading screen ──────────────────────────────────────────────────

const STATUS_MSGS = [
  'Loading configuration...',
  'Initializing skills...',
  'Setting up task scheduler...',
  'Connecting memory systems...',
  'Preparing error response layer...',
  'Warming up AI reactor...',
  'Almost ready...',
];
const SPARKLES = ['✦', '✧', '✦', '✧', '★'];

function latestStartupStatus(): string {
  const recent = _logBuffer
    .slice(-20)
    .map((line) => strip(String(line || '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('> prometheus@') && !line.startsWith('> tsx ') && !line.startsWith('> node '));
  const last = recent[recent.length - 1] || '';
  if (!last) return '';
  return last.length > 56 ? `${last.slice(0, 53)}...` : last;
}

export async function runLoadingScreen(): Promise<void> {
  refreshBoxDims();

  if (!process.stdout.isTTY) {
    out(co(C.orange, '⚡ Prometheus Gateway starting...\n'));
    while (!_serverReady) await sleep(50);
    if (_serverReadyOpts) await runWelcomePanel(_serverReadyOpts);
    return;
  }

  clearScr();
  hideCursor();

  let spinIdx = 0, msgIdx = 0, progress = 0;
  const start = Date.now();

  const boxRow = (screenRow: number, content: string) => {
    const vis = strip(content);
    const pad = Math.max(0, BOX_W - vis.length);
    moveTo(screenRow, BOX_LEFT);
    eraseLine();
    out(`${co(C.orange, '│')}${content}${' '.repeat(pad)}${co(C.orange, '│')}`);
  };

  const render = () => {
    const elapsed = Date.now() - start;
    const raw     = Math.min(elapsed / 6000, 0.95);
    progress      = _serverReady ? 1.0 : raw;
    msgIdx        = Math.min(Math.floor(raw * STATUS_MSGS.length), STATUS_MSGS.length - 1);
    spinIdx++;
    const statusMessage = !_serverReady && elapsed > 8000
      ? (latestStartupStatus() || 'Still starting gateway...')
      : STATUS_MSGS[msgIdx];

    const filled = Math.floor(progress * 30);
    const bar    = co(C.orange, '█'.repeat(filled)) + co(C.gray, '░'.repeat(30 - filled));
    const pct    = Math.floor(progress * 100);
    const spin   = co(C.yellow, SPARKLES[spinIdx % SPARKLES.length]);

    moveTo(BOX_TOP_ROW, BOX_LEFT); eraseLine();
    const _ltL = '─ Prometheus ─';
    const _ltR = '─ Gateway: Starting... ─';
    const _ltM = '─'.repeat(Math.max(0, BOX_W - _ltL.length - _ltR.length));
    out(co(C.orange, '┌' + _ltL + _ltM + _ltR + '┐'));

    const torch = getTorch();
    for (let i = 0; i < TORCH_H; i++) {
      const t   = torch[i];
      const vis = strip(t);
      boxRow(BOX_TOP_ROW + 1 + i, ` ${t}${' '.repeat(Math.max(0, BOX_W - 1 - vis.length))}`);
    }

    moveTo(BOX_TOP_ROW + 1 + TORCH_H, BOX_LEFT); eraseLine();
    out(co(C.orange, '├' + '─'.repeat(BOX_W) + '┤'));

    const verText = ` ${spin} ${C.bold}${C.white}Prometheus Gateway v${packageJson.version}${C.reset}${C.gray} — initializing${C.reset}`;
    boxRow(BOX_TOP_ROW + 2 + TORCH_H, verText);
    boxRow(BOX_TOP_ROW + 3 + TORCH_H, '');

    const barText = ` [${bar}${co(C.gray, `] ${String(pct).padStart(3)}%`)}`;
    boxRow(BOX_TOP_ROW + 4 + TORCH_H, barText);
    boxRow(BOX_TOP_ROW + 5 + TORCH_H, ` ${co(C.gray, statusMessage)}`);

    moveTo(BOX_TOP_ROW + 6 + TORCH_H, BOX_LEFT); eraseLine();
    out(co(C.orange, '└' + '─'.repeat(BOX_W) + '┘'));
  };

  render();
  startTorch(render);

  const MIN_MS = 2000;
  while (true) {
    const el = Date.now() - start;
    if (_serverReady && el >= MIN_MS) break;
    await sleep(50);
  }

  render();
  await sleep(400);

  if (_serverReadyOpts) await runWelcomePanel(_serverReadyOpts);
}

// ─── Phase 2: Welcome panel ───────────────────────────────────────────────────

async function runWelcomePanel(opts: StatusBoardOptions): Promise<void> {
  const name      = readName(opts.workspace);
  const greeting  = name ? `Welcome back, ${name}!` : 'Prometheus is ready.';
  const url       = `http://${opts.host}:${opts.port}`;
  const modelLine = `${opts.model} · ${opts.gpuInfo || 'CPU'}`;
  const wsShort   = opts.workspace.length > 24 ? '...' + opts.workspace.slice(-21) : opts.workspace;

  const CONTENT_ROWS = Math.max(TORCH_H + 5, 12);

  const tips: Array<{ t: string; h: boolean }> = [
    { t: 'Tips for getting started',       h: true  },
    { t: `/help  — see all commands`,      h: false },
    { t: `Web UI — ${url}`,               h: false },
    { t: '',                               h: false },
    { t: 'Quick actions',                  h: true  },
    { t: '/model  — view or switch model', h: false },
    { t: '/tools  — list active skills',   h: false },
    { t: '/status — system info',          h: false },
    { t: '/resume — previous sessions',    h: false },
    { t: '/open   — open Web UI',          h: false },
  ];

  const center = (s: string, w: number): string => {
    const pad = Math.max(0, Math.floor((w - s.length) / 2));
    return ' '.repeat(pad) + s + ' '.repeat(Math.max(0, w - pad - s.length));
  };

  const leftCell = (r: number): string => {
    if (r < TORCH_H) {
      const t   = getTorch()[r];
      const vis = strip(t);
      return ` ${t}${' '.repeat(Math.max(0, LEFT_W - 1 - vis.length))}`;
    }
    const offset = r - TORCH_H;
    let raw = '';
    if      (offset === 0) raw = center(greeting,                    LEFT_W);
    else if (offset === 2) raw = center('Prometheus',                LEFT_W);
    else if (offset === 3) raw = center(modelLine.slice(0, LEFT_W),  LEFT_W);
    else if (offset === 4) raw = center(wsShort.slice(0, LEFT_W),    LEFT_W);
    else                   raw = ' '.repeat(LEFT_W);

    if (offset === 0) return `${C.bold}${C.white}${raw}${C.reset}`;
    if (offset === 2) return `${C.bold}${C.orange}${raw}${C.reset}`;
    if (offset === 3 || offset === 4) return `${C.gray}${raw}${C.reset}`;
    return raw;
  };

  const rightCell = (r: number): string => {
    if (r >= tips.length || !tips[r].t) return ' '.repeat(RIGHT_W);
    const raw = ` ${tips[r].t.slice(0, RIGHT_W - 1)}`;
    const vis = raw.length;
    const pad = ' '.repeat(Math.max(0, RIGHT_W - vis));
    return tips[r].h
      ? `${C.orange}${raw}${C.reset}${pad}`
      : `${C.gray}${raw}${C.reset}${pad}`;
  };

  const drawPanel = () => {
    moveTo(BOX_TOP_ROW, BOX_LEFT); eraseLine();
    {
      const _wL   = '─ Prometheus ─';
      const _wRvis = 21; // visible: '─ Gateway: ● Online ─' = 21 chars
      const _wM   = '─'.repeat(Math.max(0, BOX_W - _wL.length - _wRvis));
      out(co(C.orange, '┌' + _wL + _wM + '─ Gateway: ') + co(C.green, '●') + co(C.orange, ' Online ─┐'));
    }

    for (let r = 0; r < CONTENT_ROWS; r++) {
      moveTo(BOX_TOP_ROW + 1 + r, BOX_LEFT); eraseLine();
      const lc    = leftCell(r);
      const rc    = rightCell(r);
      const lcVis = strip(lc);
      const lcPad = ' '.repeat(Math.max(0, LEFT_W - lcVis.length));
      out(`${co(C.orange, '│')}${lc}${lcPad}${co(C.orange, '│')}${rc}${co(C.orange, '│')}`);
    }

    moveTo(BOX_TOP_ROW + 1 + CONTENT_ROWS, BOX_LEFT); eraseLine();
    out(co(C.orange, '└' + '─'.repeat(LEFT_W) + '┴' + '─'.repeat(RIGHT_W) + '┘'));
  };

  drawPanel();

  setTorchFn(() => {
    const torch = getTorch();
    for (let r = 0; r < TORCH_H; r++) {
      const t     = torch[r];
      const vis   = strip(t);
      const lc    = ` ${t}${' '.repeat(Math.max(0, LEFT_W - 1 - vis.length))}`;
      const lcVis = strip(lc);
      const lcPad = ' '.repeat(Math.max(0, LEFT_W - lcVis.length));
      moveTo(BOX_TOP_ROW + 1 + r, BOX_LEFT);
      out(`${co(C.orange, '│')}${lc}${lcPad}${co(C.orange, '│')}`);
    }
  });

  moveTo(BOX_TOP_ROW + CONTENT_ROWS + 2, 1);
  showCursor();

  await sleep(700);
  await runREPL(opts);
}

// ─── Phase 3: REPL ───────────────────────────────────────────────────────────

interface PlanStep {
  id:     string;
  label:  string;
  status: 'pending' | 'running' | 'done' | 'error';
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _spinTick    = 0;
let _plan: PlanStep[] = [];
let _planRendered = 0;
let _linesAfterPlan = 0;
let _planShownOnce = false;              // true after the initial plan board is printed
let _planLastStatuses: string[] = [];    // per-step status at last onPlanUpdate render

// ── History ───────────────────────────────────────────────────────────────────

function historyFilePath(): string {
  return path.join(os.homedir(), '.prometheus', 'cli_history');
}

function loadHistory(): string[] {
  try {
    const p = historyFilePath();
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(-1000);
  } catch { return []; }
}

function saveHistory(history: string[], entry: string): string[] {
  try {
    if (!entry.trim()) return history;
    // Deduplicate: remove identical recent entry, push to end
    const deduped = history.filter(h => h !== entry);
    deduped.push(entry);
    const trimmed = deduped.slice(-1000);
    const p = historyFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, trimmed.join('\n') + '\n', 'utf-8');
    return trimmed;
  } catch { return history; }
}

// ── Input box ─────────────────────────────────────────────────────────────────
// cursorPos:        insertion point within buffer
// continuationLines: number of accumulated multiline prefix lines (0 = normal)

function drawInputBox(model: string, buffer: string, cursorPos?: number, continuationLines?: number): void {
  const cp     = cursorPos ?? buffer.length;
  const w      = Math.max(40, cols() - 4);
  const maxBuf = w - 4;

  // Scroll window so cursor stays visible
  const displayStart = buffer.length > maxBuf
    ? Math.max(0, Math.min(cp - Math.floor(maxBuf * 0.7), buffer.length - maxBuf))
    : 0;
  const display    = buffer.slice(displayStart, displayStart + maxBuf);
  const dispCursor = Math.max(0, Math.min(cp - displayStart, display.length));

  // Reverse-video block cursor
  const before      = display.slice(0, dispCursor);
  const atChar      = display[dispCursor] ?? ' ';
  const after       = display.slice(dispCursor + 1);
  const cursorBlock = `\x1b[7m${atChar}\x1b[27m`;
  const inputDisplay = before + cursorBlock + after;

  out('\n');
  out(co(C.orange, `  ┌${'─'.repeat(w)}┐`) + '\n');
  out(co(C.orange, '  │') + ' ' + co(C.orange, '❯ ') + C.reset + inputDisplay + '\n');
  out(co(C.orange, `  └${'─'.repeat(w)}┘`) + '\n');

  // Status bar: continuation > notification > shortcuts
  let leftHint: string;
  if (continuationLines && continuationLines > 0) {
    leftHint = co(C.amber, `  ↵ ${continuationLines} line${continuationLines > 1 ? 's' : ''} pending · Enter to send · Esc to cancel`);
  } else if (_notifBanner) {
    leftHint = co(C.amber, `  🔔 ${_notifBanner}`);
  } else {
    leftHint = co(C.gray, '? for shortcuts  ·  \\ + Enter for multiline');
  }
  const countBits: string[] = [];
  if (_sbCounts.teams > 0)     countBits.push(`👥${_sbCounts.teams}`);
  if (_sbCounts.tasks > 0)     countBits.push(`📋${_sbCounts.tasks}`);
  if (_sbCounts.proposals > 0) countBits.push(`📬${_sbCounts.proposals}`);
  const countsStr = countBits.length ? co(C.gray, '  ' + countBits.join(' ')) : '';
  const minfo   = co(C.gray, `◉ ${model}`) + countsStr;
  const lv      = strip(leftHint), mv = strip(minfo);
  const gap     = Math.max(1, w + 4 - lv.length - mv.length);
  out(leftHint + ' '.repeat(gap) + minfo + '\n');
}

function eraseInputBox(): void {
  for (let i = 0; i < 5; i++) out('\x1b[1A\x1b[2K');
}

// ── Plan block ────────────────────────────────────────────────────────────────

function printPlan(): void {
  const rows: string[] = [];
  for (const s of _plan) {
    if (s.status === 'pending') continue; // don't show pending steps upfront
    const icon = s.status === 'done'    ? co(C.green,  '✓')
               : s.status === 'error'   ? co(C.red,    '✗')
               : s.status === 'running' ? co(C.orange, SPIN[_spinTick % SPIN.length])
               :                         co(C.gray,    '·');
    const label = s.status === 'running' ? co(C.white, s.label) : co(C.gray, s.label);
    rows.push(`  ${icon}  ${label}`);
  }
  if (rows.length) rows.push('');
  _planRendered = rows.length;
  _linesAfterPlan = 0;
  if (rows.length) out(rows.join('\n') + '\n');
}

function erasePlan(): void {
  const total = _planRendered + _linesAfterPlan;
  for (let i = 0; i < total; i++) out('\x1b[1A\x1b[2K');
  _planRendered = 0;
  _linesAfterPlan = 0;
}

function refreshPlan(): void {
  if (_plan.length === 0) return;
  erasePlan();
  printPlan();
}

// ── Thinking spinner ──────────────────────────────────────────────────────────
// Shown after the "Prometheus 🔥:" header until the first token arrives.

let _thinkingTimer: ReturnType<typeof setInterval> | null = null;
let _thinkingActive = false;
let _thinkingTick   = 0;

function showThinkingSpinner(): void {
  if (_thinkingActive) return;
  _thinkingActive = true;
  _thinkingTick   = 0;
  out(`  ${co(C.gray, SPIN[0])}  ${co(C.gray, 'Thinking...')}\n`);
  _thinkingTimer = setInterval(() => {
    if (!_thinkingActive) return;
    _thinkingTick++;
    out('\x1b[1A\x1b[2K');
    out(`  ${co(C.gray, SPIN[_thinkingTick % SPIN.length])}  ${co(C.gray, 'Thinking...')}\n`);
  }, 80);
  (_thinkingTimer as any).unref?.();
}

function hideThinkingSpinner(): void {
  if (!_thinkingActive) return;
  _thinkingActive = false;
  if (_thinkingTimer) { clearInterval(_thinkingTimer); _thinkingTimer = null; }
  out('\x1b[1A\x1b[2K'); // erase the spinner line
}

// ── Stream output helpers (table buffering) ───────────────────────────────────
// We accumulate characters into _streamLine. On each '\n' we check if the
// completed line is a markdown table row. If yes, we erase the partial chars
// we already printed and buffer the row. When the table ends (non-table line
// follows), we flush all buffered rows at once for clean column alignment.

let _streamLine    = '';      // characters received since last '\n'
let _tableBuf: string[] = []; // buffered table rows
let _inTable       = false;   // currently buffering table rows
let _suppressChars = false;   // suppress char-by-char output (inside table or code fence)

function resetStreamState(): void {
  _streamLine    = '';
  _tableBuf      = [];
  _inTable       = false;
  _suppressChars = false;
  _inCodeFence   = false;
  _codeFenceLang = '';
}

function flushTableBuf(): void {
  for (const row of _tableBuf) out(`  ${co(C.white, row)}\n`);
  _tableBuf      = [];
  _inTable       = false;
  _suppressChars = false;
}

function flushStreamRemainder(): void {
  if (_streamLine) {
    if (_suppressChars) {
      // Content was suppressed (code fence / table), not yet on screen — output it now
      out((_inCodeFence ? highlightCode(_streamLine, _codeFenceLang) : co(C.white, _streamLine)) + '\n');
    } else {
      // Content was already printed char-by-char — just terminate the line
      out('\n');
    }
    _streamLine = '';
  }
  if (_inCodeFence) {
    out(`  ${co(C.gray, '```')}\n`);
    _inCodeFence = false; _codeFenceLang = ''; _suppressChars = false;
  }
  if (_inTable && _tableBuf.length > 0) flushTableBuf();
}

// ─── Syntax highlighter ───────────────────────────────────────────────────────
// VS Code Dark+ palette approximation via ANSI 24-bit color.

const HL = {
  kw:    '\x1b[38;2;197;134;192m', // purple  — keywords
  str:   '\x1b[38;2;206;145;120m', // salmon  — strings
  cmt:   '\x1b[38;2;106;153;85m',  // green   — comments
  num:   '\x1b[38;2;181;206;168m', // mint    — numbers
  fn:    '\x1b[38;2;220;220;170m', // yellow  — function names
  type:  '\x1b[38;2;78;201;176m',  // teal    — types/classes
  var:   '\x1b[38;2;156;220;254m', // blue    — variables/identifiers
  plain: '\x1b[38;2;212;212;212m', // near-white — default
};

function highlightCode(line: string, lang: string): string {
  const l = lang.toLowerCase();
  let s = line;

  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh') {
    s = s
      .replace(/(#.*)$/, `${HL.cmt}$1${C.reset}`)
      .replace(/\$\{?[\w]+\}?/g, `${HL.var}$&${C.reset}`)
      .replace(/(['"])((?:(?!\1).)*)\1/g, `${HL.str}$1$2$1${C.reset}`)
      .replace(/\b(if|then|else|elif|fi|for|do|done|while|case|esac|in|function|return|export|echo|local|source|set)\b/g, `${HL.kw}$1${C.reset}`);
  } else if (l === 'python' || l === 'py') {
    s = s
      .replace(/(#.*)$/, `${HL.cmt}$1${C.reset}`)
      .replace(/(['"`]{3}|['"`])(?:(?!\1).)*\1/g, `${HL.str}$&${C.reset}`)
      .replace(/\b(def|class|import|from|return|if|else|elif|for|while|try|except|finally|with|as|in|not|and|or|lambda|yield|pass|break|continue|raise|True|False|None|async|await|self|super)\b/g, `${HL.kw}$1${C.reset}`)
      .replace(/\b(\d+(?:\.\d+)?)\b/g, `${HL.num}$1${C.reset}`)
      .replace(/\bclass\s+(\w+)/g, `${HL.kw}class ${C.reset}${HL.type}$1${C.reset}`)
      .replace(/\bdef\s+(\w+)/g, `${HL.kw}def ${C.reset}${HL.fn}$1${C.reset}`);
  } else if (l === 'json') {
    s = s
      .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, `${HL.fn}$1${C.reset}$2`)
      .replace(/(?<=:\s*)("(?:[^"\\]|\\.)*")/g, `${HL.str}$1${C.reset}`)
      .replace(/(?<=:\s*)(\d+(?:\.\d+)?)/g, `${HL.num}$1${C.reset}`)
      .replace(/(?<=:\s*)(true|false|null)/g, `${HL.kw}$1${C.reset}`);
  } else if (l === 'css' || l === 'scss') {
    s = s
      .replace(/(\/\*.*?\*\/)/g, `${HL.cmt}$1${C.reset}`)
      .replace(/([\w-]+)\s*:/g, `${HL.fn}$1${C.reset}:`)
      .replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, `${HL.str}$1${C.reset}`)
      .replace(/#[0-9a-fA-F]{3,8}\b/g, `${HL.num}$&${C.reset}`)
      .replace(/\b(\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms)?)\b/g, `${HL.num}$1${C.reset}`);
  } else {
    // JS / TS / Go / Rust / general C-like
    s = s
      .replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/g, `${HL.cmt}$1${C.reset}`)
      .replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g, `${HL.str}$1${C.reset}`)
      .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|default|new|this|typeof|instanceof|async|await|try|catch|finally|throw|void|null|undefined|true|false|of|in|from|interface|type|enum|public|private|protected|static|readonly|override|abstract|fn|mut|impl|struct|pub|use|mod|crate|defer|go|func|package|chan|select)\b/g, `${HL.kw}$1${C.reset}`)
      .replace(/\b(\d+(?:\.\d+)?(?:n|f32|f64|i32|i64|u8|u32|u64)?)\b/g, `${HL.num}$1${C.reset}`)
      .replace(/\bclass\s+(\w+)/g, `${HL.kw}class ${C.reset}${HL.type}$1${C.reset}`)
      .replace(/\binterface\s+(\w+)/g, `${HL.kw}interface ${C.reset}${HL.type}$1${C.reset}`)
      .replace(/\btype\s+(\w+)/g, `${HL.kw}type ${C.reset}${HL.type}$1${C.reset}`)
      .replace(/\b(function\s+)?(\w+)\s*(?=\()/g, (m, fn, name) =>
        /^(if|else|for|while|switch|catch|return)$/.test(name) ? m
          : fn ? `${HL.kw}function ${C.reset}${HL.fn}${name}${C.reset}`
               : `${HL.fn}${name}${C.reset}`)
      .replace(/:\s*([A-Z]\w+)/g, `: ${HL.type}$1${C.reset}`);
  }

  return `  ${HL.plain}${s}${C.reset}`;
}

function processStreamChar(ch: string): void {
  if (ch === '\n') {
    const line = _streamLine;
    _streamLine = '';

    // ── Code fence open/close ─────────────────────────────────────────────
    const fenceMatch = line.match(/^(```+)(\w*)$/);
    if (fenceMatch) {
      if (!_inCodeFence) {
        if (!_suppressChars) out('\r\x1b[2K'); // erase partial char-stream
        _inCodeFence   = true;
        _codeFenceLang = fenceMatch[2] || '';
        _suppressChars = true;
        out(`\n  ${co(C.gray, fenceMatch[1] + _codeFenceLang)}\n`);
        return;
      } else {
        _inCodeFence   = false;
        _codeFenceLang = '';
        _suppressChars = false;
        out(`  ${co(C.gray, fenceMatch[1])}\n  `);
        return;
      }
    }

    // ── Inside code fence — syntax highlight the completed line ───────────
    if (_inCodeFence) {
      out(highlightCode(line, _codeFenceLang) + '\n');
      return;
    }

    // ── Markdown table row ────────────────────────────────────────────────
    const isTableRow = /^\s*\|/.test(line);
    if (isTableRow) {
      if (!_inTable) {
        out('\r\x1b[2K');
        _inTable       = true;
        _suppressChars = true;
      }
      _tableBuf.push(line);
    } else {
      if (_inTable && _tableBuf.length > 0) {
        flushTableBuf();
        out(`  ${co(C.white, line)}\n`);
        out('  ');
      } else {
        out('\n  ');
      }
    }
  } else {
    _streamLine += ch;
    if (!_suppressChars) out(co(C.white, ch));
  }
}

// ── Relative time formatter ───────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Main REPL loop ────────────────────────────────────────────────────────────

async function runREPL(opts: StatusBoardOptions): Promise<void> {
  const url       = `http://${opts.host}:${opts.port}`;
  let   sessionId = `cli_${randomUUID()}`;
  let   sessionRegistered = false;

  let   abort      = { aborted: false };
  let   inFlight   = false;
  let   ctrlCCount = 0;
  let   ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  let   devlogMode           = false;
  let   queuedMessage        = '';   // message typed during in-flight, auto-loaded after response
  let   inFlightTypingShown  = false; // one-shot "typing buffered" notice per turn
  let   inFlightBoxActive    = false; // true while the buffered-input box is on screen during in-flight

  // ── Approval dialog state ────────────────────────────────────────────────────
  let approvalActive    = false;
  let approvalSelected  = 0;
  let approvalLines     = 0;
  let approvalData: any = null;
  let approvalOnDone: ((decision: string, scope?: string) => void) | null = null;
  let approvalPollTimer: ReturnType<typeof setInterval> | null = null;
  const approvalHandledIds = new Set<string>();

  // ── Input state ─────────────────────────────────────────────────────────────
  let lineBuffer       = '';   // current line being typed
  let cursorPos        = 0;    // insertion point within lineBuffer
  let multiLinePending: string[] = []; // accumulated lines for multiline mode

  // ── History state ────────────────────────────────────────────────────────────
  let history     = loadHistory();
  let historyIdx  = -1;        // -1 = not browsing; ≥0 = index into history[]
  let historySnap = '';        // snapshot of lineBuffer before browsing started

  if (!process.stdin.isTTY) {
    _origLog(co(C.gray, 'Non-TTY — REPL unavailable. Gateway running.'));
    return;
  }

  setTorchFn(() => {});

  const spinTimer = setInterval(() => {
    _spinTick++;
    if (_plan.some(s => s.status === 'running') && _planRendered > 0) refreshPlan();
  }, 80);
  (spinTimer as any).unref?.();

  // ── Background: notification listener + status count refresh ─────────────
  startNotifListener(url);

  _idleRedrawFn = () => {
    if (inFlight) return; // don't interrupt active chat
    eraseInputBox();
    drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
  };

  // Initial count fetch + periodic refresh every 60s
  refreshSbCounts(url).catch(() => {});
  const countTimer = setInterval(() => refreshSbCounts(url).catch(() => {}), 60_000);
  (countTimer as any).unref?.();

  out('\n\n\n\n\n\n\n\n');
  drawInputBox(opts.model, lineBuffer, cursorPos);

  hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  // ── Approval helpers ──────────────────────────────────────────────────────────

  function approvalCanSave(a: any): boolean {
    const kind = String(a.approvalKind || '');
    const tool = String(a.toolName || '');
    return kind !== 'dev_source_edit' && kind !== 'final_action'
      && tool !== 'request_dev_source_edit' && tool !== 'request_final_action_approval'
      && !!a.commandPermissionCandidate;
  }

  function drawApprovalDialog(selected: number): number {
    const a   = approvalData;
    if (!a) return 0;
    const W   = Math.min(66, cols() - 8);
    const canSave = approvalCanSave(a);
    const opts = canSave
      ? ['Yes', "Yes, and don't ask again", 'No']
      : ['Yes', 'No'];

    const lines: string[] = [];
    lines.push('');

    const kindLabel: Record<string, string> = {
      command:         'Shell command',
      tool:            'Tool action',
      dev_source_edit: 'Source code edit',
      final_action:    'Final action',
    };
    lines.push(`  ${co(C.orange, kindLabel[String(a.approvalKind || '')] || String(a.toolName || 'Action'))}`);
    lines.push('');

    for (const l of String(a.action || a.summary || '').split('\n').slice(0, 6))
      lines.push(`  ${co(C.white, l.slice(0, W))}`);

    const reason = String(a.reason || '').trim();
    if (reason) {
      lines.push('');
      for (const l of reason.split('\n').slice(0, 3))
        if (l.trim()) lines.push(`  ${co(C.gray, l.slice(0, W))}`);
    }

    const risk     = Number(a.riskScore || 0);
    const boundary = String(a.commandBoundary?.scope || (a.affectedSystems || [])[0] || '');
    if (risk > 0 || boundary) {
      const rColor = risk > 7 ? C.red : risk > 4 ? C.amber : C.gray;
      const parts  = [];
      if (risk > 0) parts.push(co(rColor, `Risk: ${risk}/10`));
      if (boundary) parts.push(co(C.gray, boundary));
      lines.push('');
      lines.push('  ' + parts.join(co(C.gray, ' · ')));
    }

    lines.push('');
    lines.push(`  ${co(C.white, 'Do you want to proceed?')}`);
    opts.forEach((opt, i) => {
      const active = i === selected;
      lines.push(`  ${active ? co(C.orange, '❯') : ' '} ${active ? co(C.white, `${i + 1}. ${opt}`) : co(C.gray, `${i + 1}. ${opt}`)}`);
    });
    lines.push('');
    lines.push(`  ${co(C.gray, '↑↓ navigate · Enter select · Esc to deny')}`);
    lines.push('');

    for (const l of lines) out(l + '\n');
    return lines.length;
  }

  function redrawApprovalDialog(selected: number): void {
    for (let i = 0; i < approvalLines; i++) out('\x1b[1A\x1b[2K');
    approvalLines = drawApprovalDialog(selected);
  }

  function handleApprovalKey(key: string): void {
    if (!approvalActive || !approvalData || !approvalOnDone) return;
    const canSave  = approvalCanSave(approvalData);
    const optCount = canSave ? 3 : 2;

    if (key === '\x1b[A') {
      approvalSelected = (approvalSelected - 1 + optCount) % optCount;
      redrawApprovalDialog(approvalSelected);
    } else if (key === '\x1b[B') {
      approvalSelected = (approvalSelected + 1) % optCount;
      redrawApprovalDialog(approvalSelected);
    } else if (key === '1') { approvalSelected = 0; redrawApprovalDialog(0);
    } else if (key === '2') { approvalSelected = 1; redrawApprovalDialog(1);
    } else if (key === '3' && canSave) { approvalSelected = 2; redrawApprovalDialog(2);
    } else if (key === '\r' || key === '\n') {
      const sel = approvalSelected;
      const done = approvalOnDone;
      approvalActive = false; approvalData = null; approvalOnDone = null;
      if (canSave) {
        if (sel === 0)      done('approved');
        else if (sel === 1) done('approved', 'always');
        else                done('rejected');
      } else {
        done(sel === 0 ? 'approved' : 'rejected');
      }
    } else if (key === '\x1b' || key === '\x03') {
      const done = approvalOnDone;
      approvalActive = false; approvalData = null; approvalOnDone = null;
      done('rejected');
    }
  }

  function showApprovalInline(approval: any): void {
    hideThinkingSpinner();
    flushStreamRemainder();
    approvalData     = approval;
    approvalSelected = 0;
    approvalActive   = true;
    const hrWidth = Math.max(20, cols() - 4);
    out(`\n${co(C.gray, '  ' + '─'.repeat(hrWidth))}\n`);
    out(`  ${co(C.amber, '⚠')}  ${co(C.amber, 'Approval required — AI is paused')}\n`);
    approvalLines = drawApprovalDialog(0);

    approvalOnDone = async (decision: string, grantScope?: string) => {
      const label = decision === 'approved'
        ? co(C.green, '✓ Approved') + (grantScope === 'always' ? co(C.gray, ' — saved as always-allow') : '')
        : co(C.red, '✗ Denied');
      out(`  ${label}\n\n`);
      try {
        const body: any = { decision };
        if (grantScope) body.grantScope = grantScope;
        await httpPost(`${url}/api/approvals/${encodeURIComponent(approval.id)}`, body);
      } catch (e: any) {
        out(co(C.red, `  ✗ Could not send decision: ${e.message || e}\n`));
      }
    };
  }

  function startApprovalPoll(): void {
    if (approvalPollTimer) return;
    approvalPollTimer = setInterval(async () => {
      if (!inFlight || approvalActive) return;
      try {
        const raw  = await httpGet(`${url}/api/approvals?status=pending`);
        const data = JSON.parse(raw) as any;
        const list: any[] = data.approvals || [];
        const pending = list.find(a =>
          !approvalHandledIds.has(String(a.id)) &&
          (!a.sessionId || a.sessionId === sessionId || a.sourceSessionId === sessionId),
        );
        if (pending) {
          approvalHandledIds.add(String(pending.id));
          showApprovalInline(pending);
        }
      } catch { /* non-fatal */ }
    }, 1500);
    (approvalPollTimer as any).unref?.();
  }

  function stopApprovalPoll(): void {
    if (approvalPollTimer) { clearInterval(approvalPollTimer); approvalPollTimer = null; }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const cleanup = () => {
    clearInterval(spinTimer);
    clearInterval(countTimer);
    _idleRedrawFn = null;
    stopTorch();
    hideThinkingSpinner();
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
    process.stdin.removeListener('data', onKey);
    showCursor();
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = async (input: string) => {
    const text = input.trim();
    if (!text) {
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      return;
    }

    eraseInputBox();

    // ── Slash commands ──────────────────────────────────────────────────────
    if (text.startsWith('/')) {
      const [cmd] = text.slice(1).split(' ');
      switch (cmd.toLowerCase()) {

        case 'help':
          out('\n');
          ([
            ['/help',      'Show this list'],
            ['/new',       'Start a fresh chat session'],
            ['/resume',    'Browse & resume previous sessions'],
            ['/model',     'View or switch the active model'],
            ['/tools',     'List active skills & tools'],
            ['/steer',     'Inject context into current session'],
            ['/status',    'Model & system info'],
            ['/browse',    'Navigate workspace files'],
            ['/teams',     'Team browser — view chat, dispatch, pause/resume'],
            ['/tasks',     'Background task list — view, pause, restart, delete'],
            ['/schedule',  'Cron schedules — enable/disable, trigger, run log'],
            ['/proposals', 'Proposals inbox — view, approve, deny'],
            ['/restart',   'Restart the gateway (quick or full rebuild)'],
            ['/dash',      'Live dashboard — teams, tasks, events (split-pane)'],
            ['/watch [t]', 'Stream live events for a team (or pick from list)'],
            ['/inbox',     'Unified attention view — proposals + failed tasks'],
            ['/export',    'Export current session to a Markdown file'],
            ['/run <name>','Trigger a named cron schedule immediately'],
            ['/clear',     'Clear the screen'],
            ['/logs',      'Show startup logs'],
            ['/open',      'Open Web UI in browser'],
            ['/exit',      'Exit REPL (gateway keeps running)'],
          ] as [string, string][]).forEach(([c, d]) =>
            out(`  ${co(C.orange, c.padEnd(16))}${co(C.gray, d)}\n`),
          );
          out('\n');
          out(co(C.gray, '  Hotkeys:\n'));
          ([
            ['Ctrl+K', 'Command palette — fuzzy search all commands'],
            ['Ctrl+R', 'Reverse history search'],
            ['Ctrl+T', 'Jump to /teams'],
            ['Ctrl+D', 'Jump to /dash'],
            ['Ctrl+P', 'Jump to /proposals'],
            ['Ctrl+B', 'Jump to /browse'],
            ['Ctrl+Y', 'Copy last response to clipboard'],
          ] as [string, string][]).forEach(([k, d]) =>
            out(`  ${co(C.amber, k.padEnd(10))}${co(C.gray, d)}\n`),
          );
          out('\n' + co(C.gray, '  Multiline: end a line with \\ then Enter to continue.\n'));
          out(co(C.gray,         '  History:   ↑ / ↓ arrows to navigate previous inputs.\n'));
          break;

        case 'status':
          try {
            const s = JSON.parse(await httpGet(`${url}/api/status`)) as any;
            out('\n');
            out(`  ${co(C.gray, 'Model:    ')}${co(C.white, s.currentModel || 'unknown')}\n`);
            out(`  ${co(C.gray, 'Provider: ')}${co(C.white, s.provider || 'unknown')}\n`);
            out(`  ${co(C.gray, 'GPU:      ')}${co(C.white, opts.gpuInfo || 'not detected')}\n`);
            out(`  ${co(C.gray, 'Web UI:   ')}${co(C.green, url)}\n`);
            out(`  ${co(C.gray, 'Skills:   ')}${co(C.white, `${opts.skillsTotal} loaded`)}\n`);
          } catch { out(co(C.red, '  Could not reach gateway.\n')); }
          break;

        // ── /model ────────────────────────────────────────────────────────────
        case 'model': {
          const modelArgs = text.slice('/model'.length).trim().split(/\s+/).filter(Boolean);
          const sub = modelArgs[0] || '';
          if (!sub) {
            try {
              const s = JSON.parse(await httpGet(`${url}/api/status`)) as any;
              out('\n');
              out(`  ${co(C.gray, 'Active model:  ')}${co(C.white, s.currentModel || 'unknown')}\n`);
              out(`  ${co(C.gray, 'Provider:      ')}${co(C.white, s.provider || 'unknown')}\n`);
              out(`  ${co(C.gray, 'Usage:         ')}${co(C.gray, '/model list  ·  /model <name>')}\n`);
            } catch { out(co(C.red, '  Could not reach gateway.\n')); }
          } else if (sub === 'list') {
            try {
              let models: string[] = [];
              const raw = await httpGet(`${url}/api/models`).catch(() => '');
              if (raw) {
                const p = JSON.parse(raw) as any;
                models = p.models || p.available || [];
              }
              const stRaw = await httpGet(`${url}/api/status`).catch(() => '{}');
              const st    = JSON.parse(stRaw) as any;
              const cur   = st.currentModel || '';
              out('\n');
              if (!models.length) {
                out(`  ${co(C.orange, cur || 'unknown')} ${co(C.gray, '(current — no model list available)')}\n`);
              } else {
                models.forEach((m: string) => {
                  const active = m === cur ? ` ${co(C.orange, '← active')}` : '';
                  out(`  ${co(C.gray, '·')} ${co(C.white, m)}${active}\n`);
                });
              }
            } catch { out(co(C.red, '  Could not reach gateway.\n')); }
          } else {
            const modelName = modelArgs.join(' ');
            try {
              await httpPost(`${url}/api/settings/model`, { model: modelName });
              out(`\n  ${co(C.green, '✓')} ${co(C.white, `Switched to ${modelName}`)}\n`);
            } catch (e: any) {
              out(co(C.red, `  ✗ ${e.message || 'Could not switch model'}\n`));
            }
          }
          break;
        }

        // ── /tools ────────────────────────────────────────────────────────────
        case 'tools': {
          try {
            const s = JSON.parse(await httpGet(`${url}/api/status`)) as any;
            out('\n');
            out(`  ${co(C.orange, 'Skills & Tools')}\n`);
            out(`  ${co(C.gray, '─'.repeat(36))}\n`);
            const total   = s.skillsTotal   ?? opts.skillsTotal;
            const enabled = s.skillsEnabled ?? opts.skillsEnabled;
            out(`  ${co(C.gray, 'Skills loaded:')} ${co(C.white, String(total))}${total !== enabled ? co(C.gray, `  (${enabled} enabled)`) : ''}\n`);
            if (Array.isArray(s.skills) && s.skills.length) {
              out('\n');
              (s.skills as any[]).forEach((sk: any) => {
                const name = typeof sk === 'string' ? sk : (sk.name || sk.id || '?');
                const desc = typeof sk === 'object' ? (sk.description || sk.desc || '') : '';
                out(`  ${co(C.gray, '·')} ${co(C.white, name)}${desc ? co(C.gray, `  — ${String(desc).slice(0, 48)}`) : ''}\n`);
              });
            }
            if (s.toolCount) out(`\n  ${co(C.gray, 'Tools available:')} ${co(C.white, String(s.toolCount))}\n`);
          } catch { out(co(C.red, '  Could not reach gateway.\n')); }
          break;
        }

        // ── /steer ────────────────────────────────────────────────────────────
        case 'steer': {
          const steerText = text.slice('/steer'.length).trim();
          if (!steerText) {
            out(co(C.gray, '  Usage: /steer <context to inject into this session>\n'));
          } else {
            try {
              await httpPost(`${url}/api/sessions/${encodeURIComponent(sessionId)}/steer`, { text: steerText });
              out(`\n  ${co(C.green, '✓')} ${co(C.gray, 'Context injected into session.')}\n`);
            } catch {
              out(`\n  ${co(C.green, '✓')} ${co(C.gray, 'Noted — will be included in your next message.')}\n`);
            }
          }
          break;
        }

        case 'clear':
          out('\x1b[2J\x1b[H');
          break;

        case 'new':
          sessionId         = `cli_${randomUUID()}`;
          sessionRegistered = false;
          lineBuffer        = '';
          cursorPos         = 0;
          multiLinePending  = [];
          historyIdx        = -1;
          out('\x1b[2J\x1b[H\x1b[3J');
          out(co(C.green, '  ✓ New chat session started\n\n'));
          break;

        // ── /resume ───────────────────────────────────────────────────────────
        case 'resume':
          out('\x1b[2J\x1b[H\x1b[3J');
          out('\n' + co(C.orange, '  Resume Session') + '\n\n');
          out('  ' + co(C.gray, 'Loading sessions...') + '\n');
          process.stdin.removeListener('data', onKey);
          (async () => {
            try {
              const sessionsResp = await httpGet(`${url}/api/sessions?channel=terminal`);
              let sessionList: any[];
              try {
                const parsed = JSON.parse(sessionsResp) as any;
                sessionList  = parsed.sessions || [];
              } catch {
                out('\x1b[2J\x1b[H');
                out(co(C.red, '  ✗ Server returned invalid JSON\n\n'));
                process.stdin.on('data', onKey);
                drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
                return;
              }

              out('\x1b[2J\x1b[H');
              out('\n' + co(C.orange, '  Resume Session') + '\n\n');

              if (!sessionList || sessionList.length === 0) {
                out(co(C.gray, '  No previous terminal sessions found.\n\n'));
                process.stdin.on('data', onKey);
                drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
                return;
              }

              let selected    = 0;
              let searchQuery = '';

              const filteredList = () => sessionList.filter((s: any) => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (s.preview || '').toLowerCase().includes(q)
                  || (s.title || '').toLowerCase().includes(q);
              });

              const renderMenu = () => {
                out('\x1b[2J\x1b[H\x1b[3J');
                out('\n' + co(C.orange, '  Resume Session') + '\n\n');

                const sbW = Math.max(30, Math.min(60, (process.stdout.columns || 80) - 8));
                out('  ' + co(C.gray, '┌' + '─'.repeat(sbW) + '┐') + '\n');
                out('  ' + co(C.gray, '│') + ' 🔍 ' + searchQuery + ' '.repeat(Math.max(0, sbW - 3 - searchQuery.length)) + co(C.gray, '│') + '\n');
                out('  ' + co(C.gray, '└' + '─'.repeat(sbW) + '┘') + '\n\n');

                const list = filteredList();
                if (!list.length) {
                  out(co(C.gray, '  No matching sessions.\n'));
                } else {
                  list.forEach((s: any, i: number) => {
                    const marker   = i === selected ? co(C.orange, '❯') : ' ';
                    const title    = (s.title || s.preview || '(empty)');
                    const preview  = title.slice(0, 48);
                    const ts       = s.createdAt || s.timestamp || Date.now();
                    const rel      = relativeTime(new Date(ts).getTime());
                    const msgCount = s.messageCount != null ? co(C.gray, `  ${s.messageCount} msgs`) : '';
                    const modelTag = s.model ? co(C.gray, `  ${String(s.model).split('/').pop()?.slice(0, 16)}`) : '';
                    out(
                      `  ${marker} ${co(C.gray, rel.padEnd(10))}` +
                      ` ${i === selected ? co(C.white, preview) : co(C.gray, preview)}` +
                      `${msgCount}${modelTag}\n`,
                    );
                  });
                }

                out('\n' + co(C.gray,
                  `  ↑↓ navigate · Enter select · Type to search · ` +
                  `${co(C.orange, 'Ctrl+V')}${co(C.gray, ' preview · ')}` +
                  `${co(C.orange, 'Ctrl+R')}${co(C.gray, ' rename · ')}` +
                  `${co(C.orange, 'Ctrl+A')}${co(C.gray, ' clear filter · Esc cancel')}`,
                ) + '\n');
              };

              renderMenu();

              const menuHandler = (chunk: string | Buffer) => {
                const key  = chunk.toString();
                const list = filteredList();

                if (key === '\x1b[A') { // Up
                  selected = Math.max(0, selected - 1);
                  renderMenu();
                } else if (key === '\x1b[B') { // Down
                  selected = Math.min(Math.max(0, list.length - 1), selected + 1);
                  renderMenu();

                } else if (key === '\r' || key === '\n') {
                  process.stdin.removeListener('data', menuHandler);
                  const chosen = list[selected];
                  out('\x1b[2J\x1b[H\x1b[3J');
                  lineBuffer       = '';
                  cursorPos        = 0;
                  multiLinePending = [];
                  historyIdx       = -1;
                  if (chosen) {
                    sessionId         = chosen.id;
                    sessionRegistered = true;
                    printSessionHistory(url, chosen.id, opts.model).then(() => {
                      process.stdin.on('data', onKey);
                      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
                    }).catch(() => {
                      process.stdin.on('data', onKey);
                      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
                    });
                  } else {
                    process.stdin.on('data', onKey);
                    drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
                  }

                } else if (key === '\x1b' || key === 'q' || key === 'Q' || key === '\x02') {
                  process.stdin.removeListener('data', menuHandler);
                  out('\x1b[2J\x1b[H\x1b[3J');
                  process.stdin.on('data', onKey);
                  drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);

                } else if (key === '\x01') { // Ctrl+A — clear search
                  if (searchQuery) { searchQuery = ''; selected = 0; renderMenu(); }

                } else if (key === '\x16') { // Ctrl+V — preview
                  const item = list[selected];
                  if (!item) return;
                  process.stdin.removeListener('data', menuHandler);
                  out('\x1b[2J\x1b[H\x1b[3J');
                  out('\n' + co(C.orange, '  Session Preview') + co(C.gray, `  — ${(item.title || item.preview || '').slice(0, 50)}`) + '\n\n');
                  (async () => {
                    try {
                      const raw  = await httpGet(`${url}/api/sessions/${encodeURIComponent(item.id)}`);
                      const data = JSON.parse(raw) as any;
                      const hist: any[] = data?.session?.history || data?.history || [];
                      const visible = hist.filter((m: any) => {
                        const c = String(m.content || '');
                        return !(m.role === 'user' && (c.startsWith('SYSTEM:') || c.startsWith('Before continuing:')));
                      });
                      const preview = visible.slice(-4);
                      if (!preview.length) {
                        out(co(C.gray, '  (no messages)\n'));
                      } else {
                        for (const msg of preview) {
                          if (msg.role === 'user') {
                            out(`  ${co(C.white, C.bold + 'You:')} ${String(msg.content || '').replace(/\n/g, ' ').slice(0, 120)}\n\n`);
                          } else if (msg.role === 'assistant') {
                            out(`  ${co(C.orange, 'Prometheus:')} ${String(msg.content || '').replace(/\n/g, ' ').slice(0, 200)}\n\n`);
                          }
                        }
                      }
                    } catch { out(co(C.gray, '  Could not load preview.\n')); }
                    out('\n' + co(C.gray, '  Press any key to return...') + '\n');
                    process.stdin.once('data', () => {
                      renderMenu();
                      process.stdin.on('data', menuHandler);
                    });
                  })();

                } else if (key === '\x12') { // Ctrl+R — rename
                  const item = list[selected];
                  if (!item) return;
                  process.stdin.removeListener('data', menuHandler);
                  out('\x1b[2J\x1b[H\x1b[3J');
                  out('\n' + co(C.orange, '  Rename Session') + '\n\n');
                  out(`  ${co(C.gray, 'Current: ')}${co(C.white, (item.title || item.preview || '').slice(0, 60))}\n`);
                  out(`  ${co(C.gray, 'New name')} ${co(C.orange, '❯ ')}`);
                  let renameBuf = '';
                  const renameHandler = (rc: string | Buffer) => {
                    const rk = rc.toString();
                    if (rk === '\r' || rk === '\n') {
                      process.stdin.removeListener('data', renameHandler);
                      const newTitle = renameBuf.trim();
                      (async () => {
                        if (newTitle) {
                          try {
                            await httpPost(`${url}/api/sessions/${encodeURIComponent(item.id)}`, { title: newTitle });
                            item.title = newTitle;
                            out('\n' + co(C.green, '  ✓ Renamed') + '\n');
                          } catch { out('\n' + co(C.red, '  ✗ Could not rename') + '\n'); }
                        }
                        await sleep(500);
                        renderMenu();
                        process.stdin.on('data', menuHandler);
                      })();
                    } else if (rk === '\x1b') {
                      process.stdin.removeListener('data', renameHandler);
                      renderMenu(); process.stdin.on('data', menuHandler);
                    } else if (rk === '\x7f' || rk === '\b') {
                      if (renameBuf.length > 0) { renameBuf = renameBuf.slice(0, -1); out('\b \b'); }
                    } else if (rk >= ' ') { renameBuf += rk; out(rk); }
                  };
                  process.stdin.on('data', renameHandler);

                } else if (key === '\x7f' || key === '\b') {
                  if (searchQuery.length > 0) { searchQuery = searchQuery.slice(0, -1); selected = 0; renderMenu(); }
                } else if (key >= ' ' && key.length === 1) {
                  searchQuery += key; selected = 0; renderMenu();
                }
              };

              process.stdin.on('data', menuHandler);
            } catch (err: any) {
              out('\x1b[2J\x1b[H\x1b[3J');
              out(co(C.red, `  ✗ Error loading sessions: ${err.message}\n\n`));
              process.stdin.on('data', onKey);
              drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
            }
          })();
          return;

        case 'logs': {
          const logs = getStartupLogs();
          out('\n' + co(C.orange, '  ─── Startup Logs ') + co(C.gray, '─'.repeat(28)) + '\n');
          if (!logs.length) out(co(C.gray, '  (none captured)\n'));
          else logs.slice(-60).forEach(l => out(co(C.gray, '  ' + l + '\n')));
          break;
        }

        case 'devlog': {
          if (!isDevMode()) {
            out(co(C.red, '  /devlog is only available in dev mode\n'));
            break;
          }
          devlogMode = true;
          const devLogs = getStartupLogs();
          out('\n' + co(C.orange, '  ─── Startup Logs (full) ') + co(C.gray, '─'.repeat(21)) + '\n');
          if (!devLogs.length) out(co(C.gray, '  (none captured)\n'));
          else devLogs.forEach(l => out(co(C.gray, '  ' + l + '\n')));
          out('\n');
          out(co(C.yellow, '  ┌─ DEV LOG MODE ──────────────────────────────────────────┐') + '\n');
          out(co(C.yellow, '  │  Every SSE event + gateway log printed during chat.     │') + '\n');
          out(co(C.yellow, '  └──────────────────────────────────────────────────────────┘') + '\n\n');
          break;
        }

        case 'open': {
          const { exec } = require('child_process') as typeof import('child_process');
          const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          exec(`${opener} ${url}`);
          out(co(C.green, `  ✓ Opening ${url}\n`));
          break;
        }

        // ── /browse ───────────────────────────────────────────────────────────
        case 'browse': {
          const browseArg = text.slice('/browse'.length).trim();
          process.stdin.removeListener('data', onKey);
          handleBrowse(opts.workspace, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          }, browseArg || undefined);
          return;
        }

        // ── /teams ────────────────────────────────────────────────────────────
        case 'teams':
          process.stdin.removeListener('data', onKey);
          handleTeams(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /tasks ────────────────────────────────────────────────────────────
        case 'tasks':
          process.stdin.removeListener('data', onKey);
          handleTasks(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /schedule ─────────────────────────────────────────────────────────
        case 'schedule':
          process.stdin.removeListener('data', onKey);
          handleSchedule(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /proposals ────────────────────────────────────────────────────────
        case 'proposals':
          process.stdin.removeListener('data', onKey);
          handleProposals(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /restart ──────────────────────────────────────────────────────────
        case 'restart':
          process.stdin.removeListener('data', onKey);
          handleRestart(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /dash ─────────────────────────────────────────────────────────────
        case 'dash':
          process.stdin.removeListener('data', onKey);
          handleDash(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /watch ────────────────────────────────────────────────────────────
        case 'watch': {
          const watchArg = text.slice(1).split(' ')[1] || undefined;
          process.stdin.removeListener('data', onKey);
          handleWatch(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          }, watchArg);
          return;
        }

        // ── /inbox ────────────────────────────────────────────────────────────
        case 'inbox':
          process.stdin.removeListener('data', onKey);
          handleInbox(url, opts.model, () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /export ───────────────────────────────────────────────────────────
        case 'export':
          process.stdin.removeListener('data', onKey);
          handleExport(url, sessionId, opts.workspace || process.cwd(), () => {
            process.stdin.on('data', onKey);
            drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
          });
          return;

        // ── /run <schedule-name> ──────────────────────────────────────────────
        case 'run': {
          const runName = text.slice(1).split(' ')[1];
          if (!runName) {
            out(co(C.red, '  Usage: /run <schedule-name>\n'));
            break;
          }
          out(co(C.gray, `  Triggering schedule: ${runName}...\n`));
          httpPost(`${url}/api/schedules/${encodeURIComponent(runName)}/run`, {})
            .then(() => out(co(C.green, `  ✓ Schedule "${runName}" triggered.\n\n`)))
            .catch(() => out(co(C.red, `  ✗ Failed to trigger "${runName}".\n\n`)))
            .finally(() => drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length));
          return;
        }

        case 'exit':
        case 'quit':
          out('\n' + co(C.gray, `  Gateway still running at ${url}\n\n`));
          cleanup();
          process.exit(0);
          return;

        default:
          out(co(C.red, `  Unknown command: /${cmd}. Type /help.\n`));
      }
      out('\n');
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      return;
    }

    // ── Chat request ──────────────────────────────────────────────────────────
    if (inFlight) {
      queuedMessage = text;
      lineBuffer = ''; cursorPos = 0; multiLinePending = [];
      inFlightTypingShown = false;
      out(co(C.gray, '  ✉  Queued — will send after this response\n'));
      return;
    }

    // Save to history (use the full multi-line text if applicable)
    history = saveHistory(history, text);
    historyIdx = -1;
    historySnap = '';

    inFlight = true;
    startApprovalPoll();
    ctrlCCount = 0;
    abort = { aborted: false };
    _plan = [];
    _planRendered = 0;
    _linesAfterPlan = 0;
    _planShownOnce = false;
    _planLastStatuses = [];
    resetStreamState();

    if (!sessionRegistered) {
      setSessionChannelHint(sessionId, { channel: 'terminal', timestamp: Date.now() });
      sessionRegistered = true;
    }

    const hrWidth = Math.max(20, cols() - 4);
    out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
    // Display multiline input nicely
    const displayText = text.split('\n');
    out(`  ${co(C.white, C.bold + 'You:')} ${displayText[0]}\n`);
    for (let i = 1; i < displayText.length; i++) {
      out(`       ${co(C.gray, displayText[i])}\n`);
    }
    out(`\n  ${co(C.orange, 'Prometheus 🔥:')}\n`);

    if (devlogMode) {
      const hrFill = '─'.repeat(Math.max(0, cols() - 38));
      out(co(C.gray, `  ─── TURN ${new Date().toISOString()} ${hrFill}\n`));
      setDevlogLiveCallback(line => out(co(C.gray, `  [GW] ${line}\n`)));
    }

    showThinkingSpinner();

    let responsePrinted = false;
    let responseAccum   = '';

    try {
      const eraseInFlightBox = () => {
        if (inFlightBoxActive) { eraseInputBox(); inFlightBoxActive = false; }
      };

      await streamChat(url, sessionId, text, abort, {
        onToken: (tok) => {
          eraseInFlightBox();
          if (!responsePrinted) {
            hideThinkingSpinner();
            responsePrinted = true;
            out('  ');
          }
          responseAccum += tok;
          for (const ch of tok) processStreamChar(ch);
        },
        onToolCall: (name, rawArgs) => {
          eraseInFlightBox();
          hideThinkingSpinner();
          flushStreamRemainder();
          // Extract a meaningful detail snippet from raw args JSON
          let detail = '';
          if (rawArgs) {
            try {
              const a = JSON.parse(rawArgs);
              const info = a.filename || a.path || a.file_path || a.url || a.query
                        || a.command || a.selector || a.pattern || a.text || a.name || '';
              if (info) detail = co(C.mgray, '(' + String(info).replace(/\n/g, ' ').slice(0, 60) + ')');
            } catch { /* ignore */ }
          }
          out(`\n  ${co(C.orange, '●')} ${co(C.white, prettify(name))}${detail ? ' ' + detail : ''}\n`);
          // Track lines appended below the plan so erasePlan reaches the right row
          if (_planRendered > 0) _linesAfterPlan += 2; // leading \n + tool line
          resetStreamState();
        },
        onToolResult: (_name, isErr, result) => {
          eraseInFlightBox();
          const icon    = isErr ? co(C.red, '✗') : co(C.green, '✓');
          const snippet = result
            ? co(C.mgray, ' ' + result.replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 72))
            : '';
          out(`  ${co(C.gray, '└')}  ${icon}${snippet}\n`);
        },
        onPlanUpdate: () => {
          if (!_planShownOnce) {
            // Print the plan board once as a persistent header
            printPlan();
            _planRendered = 0;       // prevent spinner from doing in-place refresh
            _linesAfterPlan = 0;
            _planShownOnce = true;
            _planLastStatuses = _plan.map(s => s.status);
            return;
          }
          // Suppress plan step labels — tool calls (● / L) convey the same info.
          _planLastStatuses = _plan.map(s => s.status);
        },
        onFinal: (finalText) => {
          eraseInFlightBox();
          if (!responsePrinted && finalText) {
            hideThinkingSpinner();
            responsePrinted = true;
            out('  ');
            const parts = finalText.split('\n');
            for (let i = 0; i < parts.length; i++) {
              out(co(C.white, parts[i]));
              if (i < parts.length - 1) out('\n  ');
            }
          }
        },
        onDone: () => {},
        onError: (msg) => {
          eraseInFlightBox();
          hideThinkingSpinner();
          flushStreamRemainder();
          out('\n' + co(C.red, `  ✗ ${msg}`) + '\n');
        },
        onRawEvent: devlogMode ? (type, raw) => {
          // Skip streaming-text events — they're already visible as flowing output
          if (type === 'token' || type === 'model_stream_event') return;
          const DEV_COLORS: Record<string, string> = {
            tool_call:      '\x1b[38;2;100;180;255m',
            tool_result:    C.green,
            thinking_delta: '\x1b[35m',
            progress_state: C.orange,
            ui_preflight:   C.gray,
            info:           C.gray,
            final:          '\x1b[96m',
            done:           '\x1b[96m',
            error:          C.red,
          };
          const color   = DEV_COLORS[type] ?? C.gray;
          const label   = `[${type.toUpperCase()}]`.padEnd(22);
          const payload = ' ' + JSON.stringify(raw).slice(0, 240);
          out(co(color, `\n  ${label}${payload}\n`));
        } : undefined,
      });
    } catch (e: any) {
      hideThinkingSpinner();
      if (!abort.aborted) {
        flushStreamRemainder();
        out('\n' + co(C.red, `  Error: ${e.message || e}`) + '\n');
      }
    } finally {
      stopApprovalPoll();
      if (devlogMode) setDevlogLiveCallback(null);
      hideThinkingSpinner();
      flushStreamRemainder();
      resetStreamState();
      inFlight = false;
      if (responseAccum) _lastResponse = responseAccum; // save for Ctrl+Y
      // Plan display stays on screen as permanent turn history — just reset state
      _plan = [];
      _planRendered = 0;
      _linesAfterPlan = 0;
      _planShownOnce = false;
      _planLastStatuses = [];
      inFlightTypingShown = false;
      inFlightBoxActive   = false;
      if (responsePrinted) out('\n');
      out('\n');
      if (queuedMessage) {
        lineBuffer = queuedMessage;
        cursorPos = lineBuffer.length;
        queuedMessage = '';
      }
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
    }
  };

  // ── Key handler ──────────────────────────────────────────────────────────────

  const onKey = (chunk: string | Buffer) => {
    const key = chunk.toString();

    // ── Approval dialog takes priority ───────────────────────────────────────
    if (approvalActive) {
      handleApprovalKey(key);
      return;
    }

    // ── Ctrl+C ──────────────────────────────────────────────────────────────
    if (key === '\x03') {
      if (inFlight) {
        abort.aborted = true;
        inFlight = false;
        stopApprovalPoll();
        approvalActive = false; approvalData = null; approvalOnDone = null;
        if (inFlightBoxActive) { eraseInputBox(); inFlightBoxActive = false; }
        hideThinkingSpinner();
        flushStreamRemainder();
        resetStreamState();
        _plan = [];
        _planRendered = 0;
        _linesAfterPlan = 0;
        _planShownOnce = false;
        _planLastStatuses = [];
        out('\n' + co(C.gray, '  Cancelled.\n\n'));
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
        return;
      }
      // Cancel multiline accumulation on Ctrl+C
      if (multiLinePending.length > 0) {
        multiLinePending = [];
        eraseInputBox();
        out(co(C.gray, '  Multiline cancelled.\n\n'));
        drawInputBox(opts.model, lineBuffer, cursorPos, 0);
        return;
      }
      ctrlCCount++;
      if (ctrlCCount === 1) {
        eraseInputBox();
        out(co(C.gray, '  Press Ctrl+C again to exit. Gateway keeps running.\n\n'));
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
        if (ctrlCTimer) clearTimeout(ctrlCTimer);
        ctrlCTimer = setTimeout(() => { ctrlCCount = 0; }, 2000);
        return;
      }
      eraseInputBox();
      out(co(C.gray, `  Gateway still running at ${url}\n\n`));
      cleanup();
      process.exit(0);
      return;
    }

    // ── Escape — cancel multiline accumulation ───────────────────────────────
    if (key === '\x1b' && multiLinePending.length > 0) {
      multiLinePending = [];
      eraseInputBox();
      out(co(C.gray, '  Multiline cancelled.\n\n'));
      drawInputBox(opts.model, lineBuffer, cursorPos, 0);
      return;
    }

    // ── In-flight: show buffered-input box, queue on Enter ───────────────────
    if (inFlight) {
      if (key === '\r' || key === '\n') {
        const fullText = multiLinePending.length > 0
          ? [...multiLinePending, lineBuffer].join('\n')
          : lineBuffer;
        if (fullText.trim()) {
          if (inFlightBoxActive) { eraseInputBox(); inFlightBoxActive = false; }
          queuedMessage = fullText.trim();
          lineBuffer = ''; cursorPos = 0; multiLinePending = []; historyIdx = -1;
          inFlightTypingShown = false;
          out(co(C.gray, '\n  ✉  Queued — will send after this response\n'));
        }
        return;
      }
      if (key === '\x7f' || key === '\b') {
        if (cursorPos > 0) {
          lineBuffer = lineBuffer.slice(0, cursorPos - 1) + lineBuffer.slice(cursorPos);
          cursorPos--; historyIdx = -1;
          if (inFlightBoxActive) { eraseInputBox(); drawInputBox(opts.model, lineBuffer, cursorPos, 0); }
        }
        return;
      }
      if (key >= ' ') {
        lineBuffer = lineBuffer.slice(0, cursorPos) + key + lineBuffer.slice(cursorPos);
        cursorPos += key.length; historyIdx = -1;
        if (!inFlightBoxActive) {
          if (!inFlightTypingShown) {
            out(co(C.gray, '\n  ⌨  Type your message below — Enter to queue\n'));
            inFlightTypingShown = true;
          }
          drawInputBox(opts.model, lineBuffer, cursorPos, 0);
          inFlightBoxActive = true;
        } else {
          eraseInputBox();
          drawInputBox(opts.model, lineBuffer, cursorPos, 0);
        }
      }
      return;
    }

    // ── Enter ────────────────────────────────────────────────────────────────
    if (key === '\r' || key === '\n') {
      // Multiline continuation: line ends with backslash
      if (lineBuffer.endsWith('\\')) {
        multiLinePending.push(lineBuffer.slice(0, -1)); // strip trailing \
        lineBuffer = '';
        cursorPos  = 0;
        historyIdx = -1;
        eraseInputBox();
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
        return;
      }
      // Normal submit
      const fullText = multiLinePending.length > 0
        ? [...multiLinePending, lineBuffer].join('\n')
        : lineBuffer;
      lineBuffer       = '';
      cursorPos        = 0;
      multiLinePending = [];
      historyIdx       = -1;
      historySnap      = '';
      submit(fullText);
      return;
    }

    // ── History navigation (up/down arrows) ──────────────────────────────────
    if (key === '\x1b[A') { // Up arrow — older history
      if (history.length === 0) return;
      if (historyIdx === -1) {
        historySnap = lineBuffer; // snapshot current buffer
        historyIdx  = history.length - 1;
      } else if (historyIdx > 0) {
        historyIdx--;
      }
      lineBuffer = history[historyIdx];
      cursorPos  = lineBuffer.length;
      eraseInputBox();
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      return;
    }
    if (key === '\x1b[B') { // Down arrow — newer history
      if (historyIdx === -1) return;
      if (historyIdx < history.length - 1) {
        historyIdx++;
        lineBuffer = history[historyIdx];
      } else {
        // Past the end — restore the snapshot
        historyIdx = -1;
        lineBuffer = historySnap;
        historySnap = '';
      }
      cursorPos = lineBuffer.length;
      eraseInputBox();
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      return;
    }

    // ── Cursor movement ──────────────────────────────────────────────────────
    if (key === '\x1b[D') { // Left
      if (cursorPos > 0) { cursorPos--; eraseInputBox(); drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length); }
      return;
    }
    if (key === '\x1b[C') { // Right
      if (cursorPos < lineBuffer.length) { cursorPos++; eraseInputBox(); drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length); }
      return;
    }
    if (key === '\x1b[H' || key === '\x1b[1~' || key === '\x01') { // Home / Ctrl+A
      if (cursorPos !== 0) { cursorPos = 0; eraseInputBox(); drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length); }
      return;
    }
    if (key === '\x1b[F' || key === '\x1b[4~' || key === '\x05') { // End / Ctrl+E
      if (cursorPos !== lineBuffer.length) { cursorPos = lineBuffer.length; eraseInputBox(); drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length); }
      return;
    }

    // Ignore remaining escape sequences
    if (key.startsWith('\x1b')) return;

    // ── Global hotkeys ──────────────────────────────────────────────────────
    if (key === '\x0b' && !inFlight) { // Ctrl+K — command palette
      process.stdin.removeListener('data', onKey);
      showCommandPalette(url, opts, () => {
        process.stdin.on('data', onKey);
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      }, (cmd) => submit(cmd));
      return;
    }
    if (key === '\x12' && !inFlight) { // Ctrl+R — history search
      process.stdin.removeListener('data', onKey);
      showHistorySearch(history, () => {
        process.stdin.on('data', onKey);
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      }, (entry) => {
        lineBuffer = entry; cursorPos = lineBuffer.length;
        process.stdin.on('data', onKey);
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      });
      return;
    }
    if (key === '\x14' && !inFlight) { eraseInputBox(); submit('/teams'); return; }      // Ctrl+T
    if (key === '\x04' && !inFlight) { eraseInputBox(); submit('/dash'); return; }        // Ctrl+D
    if (key === '\x10' && !inFlight) { eraseInputBox(); submit('/proposals'); return; }   // Ctrl+P
    if (key === '\x02' && !inFlight) { eraseInputBox(); submit('/browse'); return; }      // Ctrl+B
    if (key === '\x19' && _lastResponse) { // Ctrl+Y — copy last response to clipboard
      const { exec } = require('child_process');
      exec(`echo ${JSON.stringify(_lastResponse)} | clip`);
      eraseInputBox();
      out(co(C.green, '  ✓ Response copied to clipboard\n\n'));
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      return;
    }

    // ── Backspace ────────────────────────────────────────────────────────────
    if (key === '\x7f' || key === '\b') {
      if (cursorPos > 0) {
        lineBuffer = lineBuffer.slice(0, cursorPos - 1) + lineBuffer.slice(cursorPos);
        cursorPos--;
        historyIdx = -1; // typing cancels history browse
        eraseInputBox();
        drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
      }
      return;
    }

    // ── Printable input / paste ──────────────────────────────────────────────
    if (key >= ' ') {
      lineBuffer  = lineBuffer.slice(0, cursorPos) + key + lineBuffer.slice(cursorPos);
      cursorPos  += key.length;
      historyIdx  = -1; // typing cancels history browse
      eraseInputBox();
      drawInputBox(opts.model, lineBuffer, cursorPos, multiLinePending.length);
    }
  };

  process.stdin.on('data', onKey);
}

// ─── Session history renderer ─────────────────────────────────────────────────

async function printSessionHistory(gatewayUrl: string, sid: string, _model: string): Promise<void> {
  try {
    const raw  = await httpGet(`${gatewayUrl}/api/sessions/${encodeURIComponent(sid)}`);
    const data = JSON.parse(raw) as any;
    const history: Array<{ role: string; content: string }> =
      data?.session?.history || data?.history || [];

    const visible = history.filter((m: any) => {
      if (m.role !== 'user') return true;
      const c = String(m.content || '');
      return !c.startsWith('SYSTEM:') && !c.startsWith('Before continuing:');
    });

    if (!visible.length) { out(co(C.gray, '  (no messages in this session)\n\n')); return; }

    const hrWidth  = Math.max(20, cols() - 4);
    const SHOW_MAX = 20;
    const slice    = visible.slice(-SHOW_MAX);
    if (visible.length > SHOW_MAX) {
      out(co(C.gray, `  ··· ${visible.length - SHOW_MAX} earlier messages hidden ···\n\n`));
    }

    for (const msg of slice) {
      if (msg.role === 'user') {
        out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
        out(`  ${co(C.white, C.bold + 'You:')} ${String(msg.content || '').split('\n').join('\n  ')}\n`);
      } else if (msg.role === 'assistant') {
        out(`\n  ${co(C.orange, 'Prometheus 🔥:')}\n`);
        String(msg.content || '').split('\n').forEach(l => out(`  ${co(C.white, l)}\n`));
      }
    }
    out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
    out(co(C.gray, `  ↑ Resumed session · ${slice.length} messages shown · Continue below\n\n`));
  } catch {
    out(co(C.gray, '  (could not load history)\n\n'));
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url: string, body: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const urlObj = new URL(url);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 80,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () =>
        res.statusCode && res.statusCode < 400
          ? resolve(d)
          : reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function httpDelete(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 80,
      path:     urlObj.pathname + (urlObj.search || ''),
      method:   'DELETE',
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () =>
        res.statusCode && res.statusCode < 400 ? resolve(d) : reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpPatch(url: string, body: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const urlObj = new URL(url);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 80,
      path:     urlObj.pathname + (urlObj.search || ''),
      method:   'PATCH',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () =>
        res.statusCode && res.statusCode < 400 ? resolve(d) : reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ─── Status counts refresh ────────────────────────────────────────────────────

async function refreshSbCounts(url: string): Promise<void> {
  try {
    const [teamsRaw, tasksRaw, propsRaw] = await Promise.all([
      httpGet(`${url}/api/teams`).catch(() => '{}'),
      httpGet(`${url}/api/bg-tasks`).catch(() => '[]'),
      httpGet(`${url}/api/proposals?status=pending`).catch(() => '{}'),
    ]);
    const teamsData = JSON.parse(teamsRaw);
    _sbCounts.teams = (teamsData.teams || teamsData || []).length;
    const tasksData = JSON.parse(tasksRaw);
    const tasksList = tasksData.tasks || tasksData || [];
    _sbCounts.tasks = tasksList.filter((t: any) => t.status === 'running' || t.status === 'queued' || t.status === 'paused').length;
    const propsData = JSON.parse(propsRaw);
    _sbCounts.proposals = (propsData.proposals || propsData || []).filter((p: any) => p.status === 'pending').length;
  } catch { /* non-fatal */ }
}

// ─── Notification banner push ─────────────────────────────────────────────────

function pushNotifBanner(text: string): void {
  _notifBanner = text.slice(0, 80);
  if (_notifBannerTimer) clearTimeout(_notifBannerTimer);
  _notifBannerTimer = setTimeout(() => {
    _notifBanner = null;
    _notifBannerTimer = null;
    _idleRedrawFn?.();
  }, 8000);
  _idleRedrawFn?.();
}

// ─── SSE notification listener ────────────────────────────────────────────────
// Opens a persistent connection to /api/teams/events and surfaces key events
// as notification banners in the idle REPL status bar.

function startNotifListener(url: string): void {
  const connect = () => {
    try {
      const urlObj = new URL(`${url}/api/teams/events`);
      const options: http.RequestOptions = {
        hostname: urlObj.hostname,
        port:     Number(urlObj.port) || 80,
        path:     urlObj.pathname,
        method:   'GET',
        headers:  { Accept: 'text/event-stream' },
      };
      const req = http.request(options, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const raw of parts) {
            const dl = raw.split('\n').find(l => l.startsWith('data:'));
            if (!dl) continue;
            let e: any;
            try { e = JSON.parse(dl.slice(5).trim()); } catch { continue; }
            if (!e?.type) continue;
            switch (e.type) {
              case 'team_chat_message':
                if (e.teamName && e.text) {
                  const preview = String(e.text).replace(/\n/g, ' ').slice(0, 60);
                  pushNotifBanner(`[${e.teamName}] ${preview}`);
                  if (e.teamId) _lastNotifTeamId = e.teamId;
                }
                break;
              case 'team_dispatch':
                if (e.teamName && e.agentId) {
                  pushNotifBanner(`[${e.teamName}] dispatched ${e.agentId}`);
                  if (e.teamId) _lastNotifTeamId = e.teamId;
                }
                break;
              case 'manager_review_done':
                if (e.teamName)
                  pushNotifBanner(`[${e.teamName}] manager review complete`);
                break;
              case 'team_updated':
                // quiet — don't spam on config changes
                break;
            }
          }
        });
        res.on('error', () => setTimeout(connect, 5000));
        res.on('end',   () => setTimeout(connect, 5000));
      });
      req.on('error', () => setTimeout(connect, 5000));
      req.end();
    } catch { setTimeout(connect, 10000); }
  };
  setTimeout(connect, 3000); // give gateway time to fully boot
}

// ─── SSE streaming ────────────────────────────────────────────────────────────

interface CB {
  onToken:      (tok: string) => void;
  onToolCall:   (name: string, args: string) => void;
  onToolResult: (name: string, isErr: boolean, result: string) => void;
  onPlanUpdate: () => void;
  onFinal:      (text: string) => void;
  onDone:       () => void;
  onError:      (msg: string) => void;
  onRawEvent?:  (type: string, raw: Record<string, unknown>) => void;
}

function streamChat(
  gatewayUrl: string, sessionId: string, message: string,
  abort: { aborted: boolean }, cb: CB,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({
      message,
      sessionId,
      origin: {
        channel: 'terminal',
        surface: 'terminal',
        device: 'computer',
        label: 'CLI',
        source: 'terminal_ui',
      },
    });
    const urlObj  = new URL(`${gatewayUrl}/api/chat`);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 80,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept':         'text/event-stream',
      },
    };

    const req = http.request(options, res => {
      let buf = '', printed = false;
      res.setEncoding('utf8');

      res.on('data', (chunk: string) => {
        if (abort.aborted) { req.destroy(); return; }
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const raw of parts) {
          const dl = raw.split('\n').find(l => l.startsWith('data:'));
          if (!dl) continue;
          let e: any;
          try { e = JSON.parse(dl.slice(5).trim()); } catch { continue; }
          if (!e?.type) continue;

          cb.onRawEvent?.(e.type, e);

          switch (e.type) {
            case 'token': {
              const t = String(e.text || e.token || '');
              if (t) { printed = true; cb.onToken(t); }
              break;
            }
            case 'tool_call': {
              cb.onToolCall(
                String(e.action || e.tool || ''),
                e.args ? JSON.stringify(e.args) : '', // full args — caller slices
              );
              break;
            }
            case 'tool_result': {
              cb.onToolResult(String(e.action || ''), !!e.error, String(e.result || ''));
              break;
            }
            case 'progress_state': {
              const items: any[] = e.items || [];
              if (items.length >= 1) {
                _plan = items.map((it: any) => ({
                  id:     String(it.id || it.label || Math.random()),
                  label:  String(it.text || it.label || it.title || it.name || 'Step'),
                  status: it.status === 'done'        ? 'done'
                        : it.status === 'in_progress' ? 'running'
                        : it.status === 'running'     ? 'running'
                        : it.status === 'error'       ? 'error'
                        : 'pending',
                }));
                cb.onPlanUpdate();
              }
              break;
            }
            case 'final': {
              if (!printed && e.text) cb.onFinal(e.text);
              break;
            }
            case 'done':  { cb.onDone();  resolve(); break; }
            case 'error': { cb.onError(e.message || 'Unknown error'); resolve(); break; }
          }
        }
      });

      res.on('end',   () => resolve());
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Interactive menu handler utilities ──────────────────────────────────────
// All handlers follow the same contract:
//   - caller removes 'data' listener for onKey before calling
//   - handler registers its own menuHandler
//   - when done, handler calls restore() which re-adds onKey and redraws input

type RestoreFn = () => void;

function menuHeader(title: string, subtitle?: string): void {
  out('\x1b[2J\x1b[H\x1b[3J');
  out('\n' + co(C.orange, `  ${title}`) + (subtitle ? co(C.gray, `  ${subtitle}`) : '') + '\n\n');
}

function menuFooter(hint: string): void {
  out('\n' + co(C.gray, `  ${hint}`) + '\n');
}

function menuSeparator(): void {
  out(co(C.gray, '  ' + '─'.repeat(Math.min(60, cols() - 6))) + '\n');
}

function menuSpinner(label: string): ReturnType<typeof setInterval> {
  let t = 0;
  out(`  ${co(C.gray, SPIN[0])}  ${co(C.gray, label)}\n`);
  const timer = setInterval(() => {
    out('\x1b[1A\x1b[2K');
    out(`  ${co(C.gray, SPIN[++t % SPIN.length])}  ${co(C.gray, label)}\n`);
  }, 80);
  (timer as any).unref?.();
  return timer;
}

async function menuAction(
  label: string,
  fn: () => Promise<void>,
  renderMenu: () => void,
  addHandler: (chunk: string | Buffer) => void,
): Promise<void> {
  const sp = menuSpinner(label);
  try {
    await fn();
    clearInterval(sp);
    out('\x1b[1A\x1b[2K');
    out(`  ${co(C.green, '✓')} ${co(C.gray, label + ' — done')}\n`);
  } catch (e: any) {
    clearInterval(sp);
    out('\x1b[1A\x1b[2K');
    out(`  ${co(C.red, '✗')} ${co(C.gray, e.message || 'failed')}\n`);
  }
  await sleep(900);
  renderMenu();
  process.stdin.on('data', addHandler);
}

// ── /browse ───────────────────────────────────────────────────────────────────

function handleBrowse(startPath: string, model: string, restore: RestoreFn, argPath?: string): void {
  let currentDir = argPath
    ? (path.isAbsolute(argPath) ? argPath : path.resolve(startPath, argPath))
    : startPath;
  let selected   = 0;
  let inPreview  = false;
  let previewLines: string[] = [];

  interface DirEntry { name: string; isDir: boolean; size?: number }

  const listDir = (dir: string): DirEntry[] => {
    try {
      const raw = fs.readdirSync(dir, { withFileTypes: true });
      return raw
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
    } catch { return []; }
  };

  const getItems = (): DirEntry[] => {
    const entries = listDir(currentDir);
    const canGoUp = currentDir !== path.parse(currentDir).root;
    return canGoUp ? [{ name: '..', isDir: true }, ...entries] : entries;
  };

  const render = () => {
    const short = currentDir.length > 56 ? '...' + currentDir.slice(-53) : currentDir;
    menuHeader('Browse Files', short);

    if (inPreview) {
      menuSeparator();
      previewLines.slice(0, Math.min(30, process.stdout.rows ? process.stdout.rows - 8 : 24)).forEach(l =>
        out('  ' + co(C.white, l.slice(0, cols() - 4)) + '\n'),
      );
      menuFooter('Any key → back · Esc exit');
      return;
    }

    const items = getItems();
    if (!items.length) {
      out(co(C.gray, '  (empty directory)\n'));
    } else {
      const maxVis = Math.min(items.length, process.stdout.rows ? process.stdout.rows - 10 : 20);
      const winStart = Math.max(0, Math.min(selected - Math.floor(maxVis / 2), items.length - maxVis));
      for (let i = winStart; i < Math.min(winStart + maxVis, items.length); i++) {
        const item   = items[i];
        const marker = i === selected ? co(C.orange, '❯') : ' ';
        const icon   = item.name === '..' ? co(C.gray, '↑') : item.isDir ? co(C.orange, '📁') : co(C.gray, '📄');
        const label  = i === selected ? co(C.white, item.name) : co(C.gray, item.name);
        out(`  ${marker} ${icon}  ${label}\n`);
      }
      if (items.length > maxVis) out(co(C.gray, `  ··· ${items.length - maxVis} more\n`));
    }
    menuFooter('↑↓ navigate · Enter open/preview · ← parent dir · Esc exit');
  };

  render();

  const handler = (chunk: string | Buffer) => {
    const key = chunk.toString();

    if (inPreview) {
      if (key === '\x1b') {
        process.stdin.removeListener('data', handler);
        out('\x1b[2J\x1b[H\x1b[3J');
        restore(); return;
      }
      inPreview = false; selected = 0; render(); return;
    }

    const items = getItems();

    if (key === '\x1b[A') {                                    // Up
      selected = Math.max(0, selected - 1); render();
    } else if (key === '\x1b[B') {                             // Down
      selected = Math.min(Math.max(0, items.length - 1), selected + 1); render();
    } else if (key === '\r' || key === '\n') {                 // Enter
      const item = items[selected];
      if (!item) return;
      if (item.isDir) {
        currentDir = item.name === '..' ? path.dirname(currentDir) : path.join(currentDir, item.name);
        selected = 0; render();
      } else {
        const full = path.join(currentDir, item.name);
        try {
          const stat = fs.statSync(full);
          if (stat.size > 200_000) {
            previewLines = [`(file too large to preview — ${Math.round(stat.size / 1024)} KB)`];
          } else {
            previewLines = fs.readFileSync(full, 'utf-8').split('\n').slice(0, 80);
          }
        } catch { previewLines = ['(could not read file)']; }
        inPreview = true; render();
      }
    } else if (key === '\x1b[D') {                             // Left — go up
      if (currentDir !== path.parse(currentDir).root) {
        currentDir = path.dirname(currentDir); selected = 0; render();
      }
    } else if (key === '\x1b' || key === 'q' || key === 'Q') { // Esc/q — exit
      process.stdin.removeListener('data', handler);
      out('\x1b[2J\x1b[H\x1b[3J');
      restore();
    }
  };

  process.stdin.on('data', handler);
}

// ── /teams ────────────────────────────────────────────────────────────────────

function handleTeams(url: string, model: string, restore: RestoreFn): void {
  type Team = { id: string; name: string; status?: string; agents?: any[]; mode?: string };
  let teams: Team[] = [];
  let selected = 0;
  let level: 'list' | 'actions' = 'list';
  let actionSel = 0;
  let loading = true;

  const ACTIONS = [
    { key: 'chat',     label: 'View Team Chat'  },
    { key: 'trigger',  label: 'Trigger Manager Review' },
    { key: 'dispatch', label: 'Dispatch Agent'  },
    { key: 'pause',    label: 'Pause Team'      },
    { key: 'resume',   label: 'Resume Team'     },
    { key: 'back',     label: '← Back'          },
  ];

  const renderList = () => {
    menuHeader('Teams');
    if (loading) { out(co(C.gray, '  Loading...\n')); return; }
    if (!teams.length) {
      out(co(C.gray, '  No teams configured.\n'));
      menuFooter('Esc exit');
      return;
    }
    teams.forEach((t, i) => {
      const marker  = i === selected ? co(C.orange, '❯') : ' ';
      const status  = t.status === 'paused' ? co(C.amber, ' paused') : t.status === 'active' ? co(C.green, ' active') : co(C.gray, ` ${t.status || 'idle'}`);
      const agents  = t.agents?.length ? co(C.gray, ` · ${t.agents.length} agents`) : '';
      const name    = i === selected ? co(C.white, t.name) : co(C.gray, t.name);
      out(`  ${marker}  ${name}${status}${agents}\n`);
    });
    menuFooter('↑↓ navigate · Enter actions · Esc exit');
  };

  const renderActions = () => {
    const team = teams[selected];
    if (!team) return;
    menuHeader('Teams', team.name);
    ACTIONS.forEach((a, i) => {
      const marker = i === actionSel ? co(C.orange, '❯') : ' ';
      const label  = i === actionSel ? co(C.white, a.label) : co(C.gray, a.label);
      out(`  ${marker}  ${label}\n`);
    });
    menuFooter('↑↓ navigate · Enter select · Esc back');
  };

  const render = () => level === 'list' ? renderList() : renderActions();

  // Load teams first
  (async () => {
    try {
      const raw  = await httpGet(`${url}/api/teams`);
      const data = JSON.parse(raw);
      teams = data.teams || data || [];
    } catch { teams = []; }
    loading = false;
    render();
  })();

  const handler = async (chunk: string | Buffer) => {
    const key = chunk.toString();

    if (level === 'list') {
      if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
      else if (key === '\x1b[B') { selected = Math.min(Math.max(0, teams.length - 1), selected + 1); render(); }
      else if ((key === '\r' || key === '\n') && teams.length) { level = 'actions'; actionSel = 0; render(); }
      else if (key === '\x1b' || key === 'q' || key === 'Q') {
        process.stdin.removeListener('data', handler);
        out('\x1b[2J\x1b[H\x1b[3J');
        restore();
      }
    } else {
      // Action submenu
      if (key === '\x1b[A') { actionSel = Math.max(0, actionSel - 1); render(); }
      else if (key === '\x1b[B') { actionSel = Math.min(ACTIONS.length - 1, actionSel + 1); render(); }
      else if (key === '\x1b' || key === '\x1b[D') { level = 'list'; render(); }
      else if (key === '\r' || key === '\n') {
        const team   = teams[selected];
        const action = ACTIONS[actionSel];
        if (!action || !team) return;

        if (action.key === 'back') { level = 'list'; render(); return; }

        if (action.key === 'chat') {
          process.stdin.removeListener('data', handler);
          menuHeader('Team Chat', team.name);
          try {
            const raw  = await httpGet(`${url}/api/teams/${encodeURIComponent(team.id)}/chat`);
            const data = JSON.parse(raw);
            const msgs: any[] = data.messages || data || [];
            if (!msgs.length) { out(co(C.gray, '  (no messages)\n')); }
            else {
              msgs.slice(-20).forEach((m: any) => {
                const role = m.role === 'manager' || m.agentId === 'manager' ? co(C.orange, 'Manager') : co(C.gray, m.agentId || m.role || 'Agent');
                const text = String(m.content || m.text || '').replace(/\n/g, ' ').slice(0, 120);
                out(`  ${role}: ${co(C.white, text)}\n`);
              });
            }
          } catch { out(co(C.red, '  Could not load chat.\n')); }
          menuFooter('Any key → back');
          process.stdin.once('data', () => {
            level = 'list'; render(); process.stdin.on('data', handler);
          });
          return;
        }

        if (action.key === 'trigger') {
          process.stdin.removeListener('data', handler);
          menuHeader('Teams', `Triggering manager review for ${team.name}...`);
          const sp = menuSpinner('Running manager review...');
          try {
            await httpPost(`${url}/api/teams/${encodeURIComponent(team.id)}/manager/trigger`, {});
            clearInterval(sp); out('\x1b[1A\x1b[2K');
            out(`  ${co(C.green, '✓')} Manager review triggered.\n`);
          } catch (e: any) {
            clearInterval(sp); out('\x1b[1A\x1b[2K');
            out(`  ${co(C.red, '✗')} ${e.message || 'failed'}\n`);
          }
          await sleep(1200);
          level = 'list'; render(); process.stdin.on('data', handler);
          return;
        }

        if (action.key === 'dispatch') {
          process.stdin.removeListener('data', handler);
          menuHeader('Teams', `Dispatch agent to ${team.name}`);
          out(`  ${co(C.gray, 'Agent ID')} ${co(C.orange, '❯ ')}`);
          let agentBuf = '';
          const agentInput = (rc: string | Buffer) => {
            const rk = rc.toString();
            if (rk === '\r' || rk === '\n') {
              process.stdin.removeListener('data', agentInput);
              out('\n');
              out(`  ${co(C.gray, 'Task')} ${co(C.orange, '❯ ')}`);
              let taskBuf = '';
              const taskInput = async (tc: string | Buffer) => {
                const tk = tc.toString();
                if (tk === '\r' || tk === '\n') {
                  process.stdin.removeListener('data', taskInput);
                  out('\n');
                  if (agentBuf.trim() && taskBuf.trim()) {
                    await menuAction(
                      `Dispatching ${agentBuf.trim()}...`,
                      () => httpPost(`${url}/api/teams/${encodeURIComponent(team.id)}/dispatch`, {
                        agentId: agentBuf.trim(), task: taskBuf.trim(),
                      }).then(() => {}),
                      () => { level = 'list'; render(); },
                      handler,
                    );
                  } else {
                    level = 'list'; render(); process.stdin.on('data', handler);
                  }
                } else if (tk === '\x1b') {
                  process.stdin.removeListener('data', taskInput);
                  level = 'list'; render(); process.stdin.on('data', handler);
                } else if (tk === '\x7f' || tk === '\b') {
                  if (taskBuf.length) { taskBuf = taskBuf.slice(0, -1); out('\b \b'); }
                } else if (tk >= ' ') { taskBuf += tk; out(tk); }
              };
              process.stdin.on('data', taskInput);
            } else if (rk === '\x1b') {
              process.stdin.removeListener('data', agentInput);
              level = 'list'; render(); process.stdin.on('data', handler);
            } else if (rk === '\x7f' || rk === '\b') {
              if (agentBuf.length) { agentBuf = agentBuf.slice(0, -1); out('\b \b'); }
            } else if (rk >= ' ') { agentBuf += rk; out(rk); }
          };
          process.stdin.on('data', agentInput);
          return;
        }

        if (action.key === 'pause' || action.key === 'resume') {
          process.stdin.removeListener('data', handler);
          await menuAction(
            `${action.key === 'pause' ? 'Pausing' : 'Resuming'} ${team.name}...`,
            () => httpPost(`${url}/api/teams/${encodeURIComponent(team.id)}/${action.key}`, {}).then(() => {}),
            () => { level = 'list'; render(); },
            handler,
          );
          return;
        }
      }
    }
  };

  render();
  process.stdin.on('data', handler);
}

// ── /tasks ────────────────────────────────────────────────────────────────────

function handleTasks(url: string, model: string, restore: RestoreFn): void {
  type Task = { id: string; name?: string; status: string; createdAt?: string; title?: string };
  let tasks: Task[] = [];
  let selected  = 0;
  let filter: 'all' | 'running' | 'paused' | 'failed' = 'all';
  let level: 'list' | 'actions' = 'list';
  let actionSel = 0;
  let loading   = true;

  const ACTIONS = [
    { key: 'log',     label: 'View Journal'    },
    { key: 'pause',   label: 'Pause Task'      },
    { key: 'resume',  label: 'Resume Task'     },
    { key: 'restart', label: 'Restart Task'    },
    { key: 'delete',  label: 'Delete Task'     },
    { key: 'back',    label: '← Back'          },
  ];

  const filtered = () => {
    if (filter === 'all') return tasks;
    return tasks.filter(t => t.status === filter);
  };

  const statusColor = (s: string) => {
    if (s === 'running')   return co(C.green, s);
    if (s === 'paused')    return co(C.amber, s);
    if (s === 'failed' || s === 'error') return co(C.red, s);
    if (s === 'completed') return co(C.gray, s);
    return co(C.gray, s);
  };

  const tabs = (['all', 'running', 'paused', 'failed'] as const);
  const renderTabBar = () => {
    const bar = tabs.map(t =>
      t === filter ? co(C.orange, `[${t}]`) : co(C.gray, ` ${t} `),
    ).join('  ');
    out(`  ${bar}\n\n`);
  };

  const renderList = () => {
    menuHeader('Background Tasks');
    renderTabBar();
    if (loading) { out(co(C.gray, '  Loading...\n')); return; }
    const list = filtered();
    if (!list.length) { out(co(C.gray, '  No tasks.\n')); menuFooter('Tab filter · Esc exit'); return; }
    list.forEach((t, i) => {
      const marker = i === selected ? co(C.orange, '❯') : ' ';
      const name   = (t.name || t.title || t.id).slice(0, 50);
      const label  = i === selected ? co(C.white, name) : co(C.gray, name);
      const ts     = t.createdAt ? co(C.gray, `  ${relativeTime(new Date(t.createdAt).getTime())}`) : '';
      out(`  ${marker}  ${label}  ${statusColor(t.status)}${ts}\n`);
    });
    menuFooter('↑↓ navigate · Enter actions · Tab filter · Esc exit');
  };

  const renderActions = () => {
    const list = filtered();
    const task = list[selected];
    if (!task) return;
    menuHeader('Tasks', (task.name || task.title || task.id).slice(0, 50));
    out(`  ${co(C.gray, 'Status:')} ${statusColor(task.status)}\n\n`);
    ACTIONS.forEach((a, i) => {
      const marker = i === actionSel ? co(C.orange, '❯') : ' ';
      const label  = i === actionSel ? co(C.white, a.label) : co(C.gray, a.label);
      out(`  ${marker}  ${label}\n`);
    });
    menuFooter('↑↓ navigate · Enter select · Esc back');
  };

  const render = () => level === 'list' ? renderList() : renderActions();

  (async () => {
    try {
      const raw  = await httpGet(`${url}/api/bg-tasks`);
      const data = JSON.parse(raw);
      tasks = data.tasks || data || [];
    } catch { tasks = []; }
    loading = false;
    render();
  })();

  const handler = async (chunk: string | Buffer) => {
    const key  = chunk.toString();
    const list = filtered();

    if (level === 'list') {
      if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
      else if (key === '\x1b[B') { selected = Math.min(Math.max(0, list.length - 1), selected + 1); render(); }
      else if (key === '\t') { // Tab — cycle filter
        const idx = tabs.indexOf(filter);
        filter = tabs[(idx + 1) % tabs.length];
        selected = 0; render();
      } else if ((key === '\r' || key === '\n') && list.length) { level = 'actions'; actionSel = 0; render(); }
      else if (key === 'r' || key === 'R') {
        loading = true; render();
        const raw = await httpGet(`${url}/api/bg-tasks`).catch(() => '[]');
        const data = JSON.parse(raw);
        tasks = data.tasks || data || []; loading = false; render();
      } else if (key === '\x1b' || key === 'q' || key === 'Q') {
        process.stdin.removeListener('data', handler);
        out('\x1b[2J\x1b[H\x1b[3J'); restore();
      }
    } else {
      if (key === '\x1b[A') { actionSel = Math.max(0, actionSel - 1); render(); }
      else if (key === '\x1b[B') { actionSel = Math.min(ACTIONS.length - 1, actionSel + 1); render(); }
      else if (key === '\x1b' || key === '\x1b[D') { level = 'list'; render(); }
      else if (key === '\r' || key === '\n') {
        const task   = list[selected];
        const action = ACTIONS[actionSel];
        if (!action || !task) return;

        if (action.key === 'back') { level = 'list'; render(); return; }

        if (action.key === 'log') {
          process.stdin.removeListener('data', handler);
          menuHeader('Task Journal', (task.name || task.id).slice(0, 50));
          try {
            const raw  = await httpGet(`${url}/api/bg-tasks/${encodeURIComponent(task.id)}`);
            const data = JSON.parse(raw);
            const journal: any[] = data.task?.journal || data.journal || [];
            if (!journal.length) out(co(C.gray, '  (no journal entries)\n'));
            else journal.slice(-20).forEach((e: any) => {
              const t = e.timestamp ? co(C.gray, new Date(e.timestamp).toLocaleTimeString() + ' ') : '';
              out(`  ${t}${co(C.white, String(e.content || e.message || e).slice(0, 120))}\n`);
            });
          } catch { out(co(C.red, '  Could not load journal.\n')); }
          menuFooter('Any key → back');
          process.stdin.once('data', () => { level = 'list'; render(); process.stdin.on('data', handler); });
          return;
        }

        if (action.key === 'delete') {
          process.stdin.removeListener('data', handler);
          await menuAction(
            `Deleting task...`,
            async () => { await httpDelete(`${url}/api/bg-tasks/${encodeURIComponent(task.id)}`); tasks = tasks.filter(t => t.id !== task.id); selected = 0; },
            () => { level = 'list'; render(); },
            handler,
          );
          return;
        }

        // pause / resume / restart
        process.stdin.removeListener('data', handler);
        await menuAction(
          `${action.key.charAt(0).toUpperCase() + action.key.slice(1)}ing task...`,
          () => httpPost(`${url}/api/bg-tasks/${encodeURIComponent(task.id)}/${action.key}`, {}).then(() => {}),
          () => { level = 'list'; render(); },
          handler,
        );
      }
    }
  };

  render();
  process.stdin.on('data', handler);
}

// ── /schedule ─────────────────────────────────────────────────────────────────

function handleSchedule(url: string, model: string, restore: RestoreFn): void {
  type Schedule = { id: string; name: string; schedule?: string; enabled: boolean; status?: string; next_run?: string; last_run?: string; last_result?: string };
  let schedules: Schedule[] = [];
  let selected  = 0;
  let level: 'list' | 'actions' | 'log' = 'list';
  let actionSel = 0;
  let loading   = true;
  let logLines: string[] = [];

  const ACTIONS = [
    { key: 'toggle',  label: '' }, // label set dynamically
    { key: 'run',     label: 'Trigger Now'   },
    { key: 'log',     label: 'View Run Log'  },
    { key: 'back',    label: '← Back'        },
  ];

  const renderList = () => {
    menuHeader('Schedules');
    if (loading) { out(co(C.gray, '  Loading...\n')); return; }
    if (!schedules.length) { out(co(C.gray, '  No schedules configured.\n')); menuFooter('Esc exit'); return; }
    schedules.forEach((s, i) => {
      const marker  = i === selected ? co(C.orange, '❯') : ' ';
      const enabled = s.enabled ? co(C.green, '●') : co(C.gray, '○');
      const name    = i === selected ? co(C.white, s.name) : co(C.gray, s.name);
      const sched   = s.schedule ? co(C.gray, `  ${s.schedule}`) : '';
      const next    = s.next_run ? co(C.gray, `  next ${relativeTime(new Date(s.next_run).getTime())}`) : '';
      out(`  ${marker}  ${enabled}  ${name}${sched}${next}\n`);
    });
    menuFooter('↑↓ navigate · Enter actions · Esc exit');
  };

  const renderActions = () => {
    const s = schedules[selected];
    if (!s) return;
    menuHeader('Schedules', s.name);
    out(`  ${co(C.gray, 'Schedule:')} ${co(C.white, s.schedule || 'one-shot')}  ${s.enabled ? co(C.green, 'enabled') : co(C.amber, 'disabled')}\n`);
    if (s.last_run) out(`  ${co(C.gray, 'Last run:')} ${co(C.white, relativeTime(new Date(s.last_run).getTime()))}\n`);
    out('\n');
    ACTIONS[0].label = s.enabled ? 'Disable Schedule' : 'Enable Schedule';
    ACTIONS.forEach((a, i) => {
      const marker = i === actionSel ? co(C.orange, '❯') : ' ';
      const label  = i === actionSel ? co(C.white, a.label) : co(C.gray, a.label);
      out(`  ${marker}  ${label}\n`);
    });
    menuFooter('↑↓ navigate · Enter select · Esc back');
  };

  const renderLog = () => {
    const s = schedules[selected];
    menuHeader('Run Log', s?.name || '');
    if (!logLines.length) { out(co(C.gray, '  (no log entries)\n')); }
    else logLines.slice(-25).forEach(l => out(`  ${co(C.white, l.slice(0, cols() - 4))}\n`));
    menuFooter('Any key → back');
  };

  const render = () => {
    if (level === 'list') renderList();
    else if (level === 'actions') renderActions();
    else renderLog();
  };

  (async () => {
    try {
      const raw = await httpGet(`${url}/api/schedules`);
      schedules = JSON.parse(raw) || [];
    } catch { schedules = []; }
    loading = false; render();
  })();

  const handler = async (chunk: string | Buffer) => {
    const key = chunk.toString();

    if (level === 'log') {
      level = 'actions'; render(); return;
    }

    if (level === 'list') {
      if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
      else if (key === '\x1b[B') { selected = Math.min(Math.max(0, schedules.length - 1), selected + 1); render(); }
      else if ((key === '\r' || key === '\n') && schedules.length) { level = 'actions'; actionSel = 0; render(); }
      else if (key === '\x1b' || key === 'q' || key === 'Q') {
        process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
      }
    } else {
      if (key === '\x1b[A') { actionSel = Math.max(0, actionSel - 1); render(); }
      else if (key === '\x1b[B') { actionSel = Math.min(ACTIONS.length - 1, actionSel + 1); render(); }
      else if (key === '\x1b' || key === '\x1b[D') { level = 'list'; render(); }
      else if (key === '\r' || key === '\n') {
        const sched  = schedules[selected];
        const action = ACTIONS[actionSel];
        if (!action || !sched) return;

        if (action.key === 'back') { level = 'list'; render(); return; }

        if (action.key === 'toggle') {
          process.stdin.removeListener('data', handler);
          const newEnabled = !sched.enabled;
          await menuAction(
            `${newEnabled ? 'Enabling' : 'Disabling'} schedule...`,
            async () => {
              await httpPatch(`${url}/api/schedules/${encodeURIComponent(sched.id)}`, { enabled: newEnabled });
              sched.enabled = newEnabled;
            },
            () => { level = 'actions'; render(); },
            handler,
          );
          return;
        }

        if (action.key === 'run') {
          process.stdin.removeListener('data', handler);
          await menuAction(
            'Triggering schedule...',
            () => httpPost(`${url}/api/schedules/${encodeURIComponent(sched.id)}/run`, {}).then(() => {}),
            () => { level = 'actions'; render(); },
            handler,
          );
          return;
        }

        if (action.key === 'log') {
          menuHeader('Run Log', sched.name);
          out(co(C.gray, '  Loading...\n'));
          try {
            const raw  = await httpGet(`${url}/api/schedules/${encodeURIComponent(sched.id)}/run-log`);
            const data = JSON.parse(raw);
            const entries: any[] = data.entries || data || [];
            logLines = entries.flatMap((e: any) => {
              const header = `[${e.ranAt ? new Date(e.ranAt).toLocaleString() : '?'}] ${e.status || ''}`;
              const body   = String(e.summary || e.result || '').split('\n').slice(0, 5);
              return [header, ...body, ''];
            });
            if (!logLines.length) logLines = ['(no entries)'];
          } catch { logLines = ['(could not load log)']; }
          level = 'log'; render();
        }
      }
    }
  };

  render();
  process.stdin.on('data', handler);
}

// ── /proposals ────────────────────────────────────────────────────────────────

function handleProposals(url: string, model: string, restore: RestoreFn): void {
  type Proposal = { id: string; title?: string; status: string; createdAt?: string; summary?: string; affectedFiles?: string[]; executorPrompt?: string };
  let proposals: Proposal[] = [];
  let selected  = 0;
  let tab: 'pending' | 'done' = 'pending';
  let level: 'list' | 'actions' | 'detail' = 'list';
  let actionSel = 0;
  let loading   = true;

  const ACTIONS = [
    { key: 'detail',  label: 'View Details'   },
    { key: 'approve', label: 'Approve ✓'      },
    { key: 'deny',    label: 'Deny ✗'         },
    { key: 'back',    label: '← Back'         },
  ];

  const filtered = () => tab === 'pending'
    ? proposals.filter(p => p.status === 'pending')
    : proposals.filter(p => p.status !== 'pending');

  const load = async () => {
    loading = true;
    try {
      const raw  = await httpGet(`${url}/api/proposals?status=all`);
      const data = JSON.parse(raw);
      proposals = data.proposals || data || [];
    } catch { proposals = []; }
    loading = false;
  };

  const renderList = () => {
    menuHeader('Proposals');
    const tabBar = (['pending', 'done'] as const).map(t =>
      t === tab ? co(C.orange, `[${t}]`) : co(C.gray, ` ${t} `),
    ).join('  ');
    out(`  ${tabBar}\n\n`);
    if (loading) { out(co(C.gray, '  Loading...\n')); return; }
    const list = filtered();
    if (!list.length) { out(co(C.gray, `  No ${tab} proposals.\n`)); menuFooter('Tab switch · Esc exit'); return; }
    list.forEach((p, i) => {
      const marker = i === selected ? co(C.orange, '❯') : ' ';
      const title  = (p.title || p.id).slice(0, 55);
      const label  = i === selected ? co(C.white, title) : co(C.gray, title);
      const ts     = p.createdAt ? co(C.gray, `  ${relativeTime(new Date(p.createdAt).getTime())}`) : '';
      out(`  ${marker}  ${label}${ts}\n`);
    });
    menuFooter('↑↓ navigate · Enter actions · Tab switch · Esc exit');
  };

  const renderActions = () => {
    const list = filtered();
    const p = list[selected];
    if (!p) return;
    menuHeader('Proposals', (p.title || p.id).slice(0, 50));
    out(`  ${co(C.gray, 'Status:')} ${p.status === 'pending' ? co(C.amber, 'pending') : co(C.gray, p.status)}\n`);
    if (p.affectedFiles?.length) out(`  ${co(C.gray, 'Files:')} ${co(C.white, p.affectedFiles.slice(0, 3).join(', '))}\n`);
    out('\n');
    ACTIONS.filter(a => p.status !== 'pending' ? a.key === 'detail' || a.key === 'back' : true).forEach((a, i) => {
      const marker = i === actionSel ? co(C.orange, '❯') : ' ';
      const label  = i === actionSel ? co(C.white, a.label) : co(C.gray, a.label);
      out(`  ${marker}  ${label}\n`);
    });
    menuFooter('↑↓ navigate · Enter select · Esc back');
  };

  const renderDetail = () => {
    const list = filtered();
    const p = list[selected];
    if (!p) return;
    menuHeader('Proposal Detail', (p.title || p.id).slice(0, 50));
    if (p.summary) {
      out(co(C.gray, '  Summary\n'));
      menuSeparator();
      p.summary.split('\n').slice(0, 15).forEach(l => out(`  ${co(C.white, l.slice(0, cols() - 4))}\n`));
      out('\n');
    }
    if (p.executorPrompt) {
      out(co(C.gray, '  Executor Prompt\n'));
      menuSeparator();
      p.executorPrompt.split('\n').slice(0, 10).forEach(l => out(`  ${co(C.gray, l.slice(0, cols() - 4))}\n`));
    }
    menuFooter('Any key → back');
  };

  const render = () => {
    if (level === 'list') renderList();
    else if (level === 'actions') renderActions();
    else renderDetail();
  };

  (async () => { await load(); render(); })();

  const handler = async (chunk: string | Buffer) => {
    const key  = chunk.toString();
    const list = filtered();

    if (level === 'detail') { level = 'actions'; render(); return; }

    if (level === 'list') {
      if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
      else if (key === '\x1b[B') { selected = Math.min(Math.max(0, list.length - 1), selected + 1); render(); }
      else if (key === '\t') {
        tab = tab === 'pending' ? 'done' : 'pending'; selected = 0; render();
      } else if ((key === '\r' || key === '\n') && list.length) { level = 'actions'; actionSel = 0; render(); }
      else if (key === '\x1b' || key === 'q' || key === 'Q') {
        process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
      }
    } else {
      const visActions = ACTIONS.filter(a => list[selected]?.status !== 'pending' ? a.key === 'detail' || a.key === 'back' : true);
      if (key === '\x1b[A') { actionSel = Math.max(0, actionSel - 1); render(); }
      else if (key === '\x1b[B') { actionSel = Math.min(visActions.length - 1, actionSel + 1); render(); }
      else if (key === '\x1b' || key === '\x1b[D') { level = 'list'; render(); }
      else if (key === '\r' || key === '\n') {
        const prop   = list[selected];
        const action = visActions[actionSel];
        if (!action || !prop) return;

        if (action.key === 'back') { level = 'list'; render(); return; }
        if (action.key === 'detail') { level = 'detail'; render(); return; }

        if (action.key === 'approve' || action.key === 'deny') {
          process.stdin.removeListener('data', handler);
          await menuAction(
            `${action.key === 'approve' ? 'Approving' : 'Denying'} proposal...`,
            async () => {
              await httpPost(`${url}/api/proposals/${encodeURIComponent(prop.id)}/${action.key}`, {});
              prop.status = action.key === 'approve' ? 'approved' : 'denied';
            },
            () => { level = 'list'; render(); },
            handler,
          );
          return;
        }
      }
    }
  };

  render();
  process.stdin.on('data', handler);
}

// ── /restart ──────────────────────────────────────────────────────────────────

function handleRestart(url: string, model: string, restore: RestoreFn): void {
  const OPTIONS = [
    { key: 'quick', label: 'Quick Restart',        desc: 'Restart gateway (reuse existing build)' },
    { key: 'full',  label: 'Full Rebuild + Restart', desc: 'npm run build then restart'            },
    { key: 'cancel', label: '← Cancel',             desc: ''                                       },
  ];
  let selected = 0;

  const render = () => {
    menuHeader('Restart Gateway');
    OPTIONS.forEach((o, i) => {
      const marker = i === selected ? co(C.orange, '❯') : ' ';
      const label  = i === selected ? co(C.white, o.label) : co(C.gray, o.label);
      const desc   = o.desc ? co(C.gray, `  — ${o.desc}`) : '';
      out(`  ${marker}  ${label}${desc}\n`);
    });
    menuFooter('↑↓ navigate · Enter select · Esc cancel');
  };

  render();

  const handler = async (chunk: string | Buffer) => {
    const key = chunk.toString();
    if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
    else if (key === '\x1b[B') { selected = Math.min(OPTIONS.length - 1, selected + 1); render(); }
    else if (key === '\x1b' || key === 'q' || key === 'Q') {
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
    } else if (key === '\r' || key === '\n') {
      const opt = OPTIONS[selected];
      if (opt.key === 'cancel') {
        process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore(); return;
      }
      process.stdin.removeListener('data', handler);
      menuHeader('Restarting...');
      out(co(C.orange, `  ${opt.label}\n\n`));
      out(co(C.gray, '  The gateway will restart. The REPL will reconnect automatically.\n'));
      out(co(C.gray, '  If it does not, run `prom` again to reconnect.\n\n'));
      try {
        await httpPost(`${url}/api/lifecycle/restart`, { rebuild: opt.key === 'full' });
        out(co(C.green, '  ✓ Restart signal sent.\n'));
      } catch (e: any) {
        out(co(C.red, `  ✗ ${e.message || 'Could not reach gateway.'}\n`));
        await sleep(2000);
        out('\x1b[2J\x1b[H\x1b[3J');
        restore();
        return;
      }
      // Give it time then exit REPL — user can re-run `prom` to reconnect
      await sleep(2000);
      out('\x1b[2J\x1b[H\x1b[3J');
      restore();
    }
  };

  process.stdin.on('data', handler);
}

// ── /dash ─────────────────────────────────────────────────────────────────────

function handleDash(url: string, model: string, restore: RestoreFn): void {
  type Panel = 'teams' | 'tasks' | 'notifs';
  let focused: Panel = 'teams';
  let teamSel = 0, taskSel = 0;
  let teams: any[] = [], tasks: any[] = [], dashNotifs: string[] = [];
  let loading = true;
  let refreshTimer: ReturnType<typeof setInterval>;

  const addDashNotif = (msg: string) => {
    dashNotifs.unshift(`${co(C.gray, new Date().toLocaleTimeString())}  ${msg}`);
    if (dashNotifs.length > 30) dashNotifs.pop();
  };

  const load = async () => {
    try {
      const [tr, tkr] = await Promise.all([
        httpGet(`${url}/api/teams`).catch(() => '{}'),
        httpGet(`${url}/api/bg-tasks`).catch(() => '[]'),
      ]);
      const td = JSON.parse(tr); teams = td.teams || td || [];
      const tkd = JSON.parse(tkr);
      tasks = (tkd.tasks || tkd || []).filter((t: any) => t.status !== 'completed' && t.status !== 'done');
    } catch {}
    loading = false;
  };

  const render = () => {
    const W    = cols();
    const rows = Math.max(4, (process.stdout.rows || 24) - 10);
    const hw   = Math.floor((W - 5) / 2);

    out('\x1b[2J\x1b[H\x1b[3J');
    out(`\n  ${co(C.bold + C.orange, '⚡ Prometheus Dashboard')}${co(C.gray, `  Tab→panel  Enter→open  r→refresh  q→exit  — auto-refreshes every 8s`)}\n`);
    out(co(C.gray, '  ' + '═'.repeat(W - 4)) + '\n\n');

    if (loading) { out(co(C.gray, '  Loading...\n')); return; }

    const teamHdr = focused === 'teams' ? co(C.orange, '▶ Teams') : co(C.gray, '  Teams');
    const taskHdr = focused === 'tasks' ? co(C.orange, '▶ Tasks') : co(C.gray, '  Tasks');
    out(`  ${teamHdr}${' '.repeat(Math.max(1, hw - 7))}  ${taskHdr}\n`);
    out(co(C.gray, `  ${'─'.repeat(hw)}  ${'─'.repeat(hw)}\n`));

    const rowCount = Math.min(rows, Math.max(teams.length, tasks.length, 1));
    for (let i = 0; i < rowCount; i++) {
      const t  = teams[i];
      const tk = tasks[i];

      let tCell = ' '.repeat(hw);
      if (t) {
        const dot  = t.status === 'active' ? co(C.green, '●') : t.status === 'paused' ? co(C.amber, '●') : co(C.gray, '○');
        const name = (t.name || t.id).slice(0, hw - 6);
        const hi   = i === teamSel && focused === 'teams';
        const m    = hi ? co(C.orange, '❯') : ' ';
        tCell = `${m} ${dot} ${hi ? co(C.white, name) : co(C.gray, name)}`;
      }

      let tkCell = '';
      if (tk) {
        const spin = tk.status === 'running' ? co(C.green, SPIN[_spinTick % SPIN.length]) : tk.status === 'paused' ? co(C.amber, '⏸') : co(C.red, '✗');
        const name = (tk.name || tk.title || tk.id).slice(0, hw - 10);
        const age  = tk.createdAt ? co(C.gray, ` ${relativeTime(new Date(tk.createdAt).getTime())}`) : '';
        const hi   = i === taskSel && focused === 'tasks';
        const m    = hi ? co(C.orange, '❯') : ' ';
        tkCell = `${m} ${spin} ${hi ? co(C.white, name) : co(C.gray, name)}${age}`;
      }

      out(`  ${tCell}${' '.repeat(Math.max(0, hw - strip(tCell).length))}  ${tkCell}\n`);
    }
    if (!teams.length && !tasks.length) out(co(C.gray, '  (nothing running)\n'));

    const notifHdr = focused === 'notifs' ? co(C.orange, '▶ Recent Events') : co(C.gray, '  Recent Events');
    out('\n' + co(C.gray, `  ${'─'.repeat(W - 4)}\n`));
    out(`  ${notifHdr}\n`);
    if (!dashNotifs.length) out(co(C.gray, '  Watching for events...\n'));
    else dashNotifs.slice(0, 5).forEach(n => out(`  ${n.slice(0, W - 4)}\n`));
  };

  // SSE feed for the dashboard event panel
  const sseConnect = () => {
    try {
      const urlObj = new URL(`${url}/api/teams/events`);
      const req = http.request({ hostname: urlObj.hostname, port: Number(urlObj.port) || 80, path: urlObj.pathname, method: 'GET', headers: { Accept: 'text/event-stream' } }, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
          for (const raw of parts) {
            const dl = raw.split('\n').find(l => l.startsWith('data:'));
            if (!dl) continue;
            let e: any; try { e = JSON.parse(dl.slice(5).trim()); } catch { continue; }
            if (!e?.type || e.type === 'heartbeat' || e.type === 'team_snapshot') continue;
            const who = e.teamName ? `[${e.teamName}]` : '';
            const txt = e.type === 'team_chat_message' ? `${who} ${String(e.text || '').replace(/\n/g, ' ').slice(0, 70)}`
                      : e.type === 'team_dispatch'      ? `${who} → dispatched ${e.agentId || ''}`
                      : e.type === 'manager_review_done'? `${who} ✓ review done`
                      : `${who} ${e.type}`;
            addDashNotif(txt);
            render();
          }
        });
        res.on('error', () => {}); res.on('end', () => {});
      });
      req.on('error', () => {}); req.end();
    } catch {}
  };

  (async () => {
    await load(); render(); sseConnect();
    refreshTimer = setInterval(async () => { await load(); render(); }, 8000);
    (refreshTimer as any).unref?.();
  })();

  const handler = async (chunk: string | Buffer) => {
    const key = chunk.toString();
    if (key === 'q' || key === 'Q' || key === '\x1b') {
      clearInterval(refreshTimer);
      process.stdin.removeListener('data', handler);
      out('\x1b[2J\x1b[H\x1b[3J'); restore();
    } else if (key === '\t') {
      focused = focused === 'teams' ? 'tasks' : focused === 'tasks' ? 'notifs' : 'teams'; render();
    } else if (key === '\x1b[A') {
      if (focused === 'teams') teamSel = Math.max(0, teamSel - 1);
      else if (focused === 'tasks') taskSel = Math.max(0, taskSel - 1);
      render();
    } else if (key === '\x1b[B') {
      if (focused === 'teams') teamSel = Math.min(Math.max(0, teams.length - 1), teamSel + 1);
      else if (focused === 'tasks') taskSel = Math.min(Math.max(0, tasks.length - 1), taskSel + 1);
      render();
    } else if (key === 'r' || key === 'R') {
      loading = true; render(); await load(); render();
    } else if (key === '\r' || key === '\n') {
      clearInterval(refreshTimer);
      process.stdin.removeListener('data', handler);
      if (focused === 'teams') {
        handleTeams(url, model, () => { out('\x1b[2J\x1b[H\x1b[3J'); restore(); });
      } else if (focused === 'tasks') {
        handleTasks(url, model, () => { out('\x1b[2J\x1b[H\x1b[3J'); restore(); });
      } else {
        out('\x1b[2J\x1b[H\x1b[3J'); restore();
      }
    }
  };

  process.stdin.on('data', handler);
}

// ── /watch <team> ─────────────────────────────────────────────────────────────

function handleWatch(url: string, model: string, restore: RestoreFn, teamArg?: string): void {
  let teamId   = teamArg || '';
  let teamName = teamId;
  const lines: string[] = [];
  const maxLines = () => Math.max(4, (process.stdout.rows || 24) - 6);

  const addLine = (text: string) => {
    const ts = co(C.gray, new Date().toLocaleTimeString());
    lines.push(`${ts}  ${text}`);
    if (lines.length > 300) lines.shift();
    renderLines();
  };

  const renderLines = () => {
    out('\x1b[2J\x1b[H\x1b[3J');
    out(`\n  ${co(C.orange, `/watch ${teamName || 'all teams'}`)}${co(C.gray, '  live event stream  ·  q/Esc exit')}\n`);
    out(co(C.gray, '  ' + '─'.repeat(cols() - 4)) + '\n\n');
    const visible = lines.slice(-maxLines());
    for (const l of visible) out(`  ${l}\n`);
    if (!lines.length) out(co(C.gray, '  Connecting, waiting for events...\n'));
  };

  const connectWatch = () => {
    const endpoint = teamId
      ? `${url}/api/teams/${encodeURIComponent(teamId)}/events`
      : `${url}/api/teams/events`;
    try {
      const urlObj = new URL(endpoint);
      const req = http.request({ hostname: urlObj.hostname, port: Number(urlObj.port) || 80, path: urlObj.pathname, method: 'GET', headers: { Accept: 'text/event-stream' } }, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
          for (const raw of parts) {
            const dl = raw.split('\n').find(l => l.startsWith('data:'));
            if (!dl) continue;
            let e: any; try { e = JSON.parse(dl.slice(5).trim()); } catch { continue; }
            if (!e?.type || e.type === 'heartbeat') continue;
            if (e.type === 'team_snapshot') { if (e.team?.name) { teamName = e.team.name; renderLines(); } continue; }
            const pre = e.teamName && !teamId ? co(C.orange, `[${e.teamName}] `) : '';
            switch (e.type) {
              case 'team_chat_message':
                addLine(`${pre}${co(C.white, String(e.text || '').replace(/\n/g, ' ').slice(0, 140))}`); break;
              case 'team_dispatch':
                addLine(`${pre}${co(C.amber, '→ ')}${co(C.white, e.agentId || '')}${e.task ? co(C.gray, `  ${String(e.task).slice(0, 60)}`) : ''}`); break;
              case 'manager_review_done':
                addLine(`${pre}${co(C.green, '✓ manager review complete')}`); break;
              case 'team_updated':
                addLine(`${pre}${co(C.gray, 'config updated')}`); break;
              default:
                addLine(`${pre}${co(C.gray, e.type)}`);
            }
          }
        });
        res.on('error', () => { addLine(co(C.red, 'connection lost — reconnecting...')); setTimeout(connectWatch, 3000); });
        res.on('end',   () => { addLine(co(C.gray, 'stream ended — reconnecting...')); setTimeout(connectWatch, 3000); });
      });
      req.on('error', () => { addLine(co(C.red, 'connection error')); setTimeout(connectWatch, 5000); });
      req.end();
    } catch { addLine(co(C.red, 'invalid URL')); }
  };

  const handler = (chunk: string | Buffer) => {
    const key = chunk.toString();
    if (key === 'q' || key === 'Q' || key === '\x1b') {
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
    }
  };

  const startWatch = () => { renderLines(); connectWatch(); process.stdin.on('data', handler); };

  if (!teamId) {
    // Show team picker first
    (async () => {
      try {
        const raw = await httpGet(`${url}/api/teams`);
        const data = JSON.parse(raw);
        const list: any[] = data.teams || data || [];
        if (!list.length) { startWatch(); return; }
        if (list.length === 1) { teamId = list[0].id; teamName = list[0].name; startWatch(); return; }
        let sel = 0;
        const pickRender = () => {
          menuHeader('/watch — Select Team');
          list.forEach((t, i) => {
            const m = i === sel ? co(C.orange, '❯') : ' ';
            out(`  ${m}  ${i === sel ? co(C.white, t.name) : co(C.gray, t.name)}\n`);
          });
          menuFooter('↑↓ navigate · Enter watch · Esc exit');
        };
        pickRender();
        const pickH = (c: string | Buffer) => {
          const k = c.toString();
          if (k === '\x1b[A') { sel = Math.max(0, sel - 1); pickRender(); }
          else if (k === '\x1b[B') { sel = Math.min(list.length - 1, sel + 1); pickRender(); }
          else if (k === '\r' || k === '\n') {
            process.stdin.removeListener('data', pickH);
            teamId = list[sel].id; teamName = list[sel].name; startWatch();
          } else if (k === '\x1b' || k === 'q') {
            process.stdin.removeListener('data', pickH); out('\x1b[2J\x1b[H\x1b[3J'); restore();
          }
        };
        process.stdin.on('data', pickH);
      } catch { startWatch(); }
    })();
  } else { startWatch(); }
}

// ── /inbox ────────────────────────────────────────────────────────────────────

function handleInbox(url: string, model: string, restore: RestoreFn): void {
  interface InboxItem { type: string; id: string; label: string; sub: string; dest: 'proposals' | 'tasks' }
  let items: InboxItem[] = [];
  let selected = 0;
  let loading  = true;

  const load = async () => {
    loading = true; items = [];
    try {
      const [propsRaw, tasksRaw] = await Promise.all([
        httpGet(`${url}/api/proposals?status=pending`).catch(() => '{}'),
        httpGet(`${url}/api/bg-tasks`).catch(() => '[]'),
      ]);
      const propsData = JSON.parse(propsRaw);
      (propsData.proposals || propsData || [])
        .filter((p: any) => p.status === 'pending')
        .forEach((p: any) => items.push({
          type: 'proposal', id: p.id,
          label: `📬  ${p.title || p.id}`,
          sub: `Proposal pending · ${p.createdAt ? relativeTime(new Date(p.createdAt).getTime()) : ''}`,
          dest: 'proposals',
        }));
      const tasksData = JSON.parse(tasksRaw);
      (tasksData.tasks || tasksData || [])
        .filter((t: any) => t.status === 'failed' || t.status === 'error' || t.status === 'stalled')
        .forEach((t: any) => items.push({
          type: 'task_fail', id: t.id,
          label: `🔴  ${t.name || t.title || t.id}`,
          sub: `Task ${t.status} · ${t.createdAt ? relativeTime(new Date(t.createdAt).getTime()) : ''}`,
          dest: 'tasks',
        }));
    } catch {}
    loading = false;
  };

  const render = () => {
    menuHeader('Inbox', items.length ? `${items.length} item${items.length > 1 ? 's' : ''} need attention` : '');
    if (loading) { out(co(C.gray, '  Loading...\n')); return; }
    if (!items.length) {
      out(co(C.green, '  ✓ Nothing needs your attention.\n'));
      menuFooter('Esc exit');
      return;
    }
    items.forEach((item, i) => {
      const marker = i === selected ? co(C.orange, '❯') : ' ';
      const label  = i === selected ? co(C.white, item.label) : co(C.gray, item.label);
      out(`  ${marker}  ${label}\n`);
      out(`         ${co(C.gray, item.sub)}\n`);
    });
    menuFooter('↑↓ navigate · Enter open · r refresh · Esc exit');
  };

  (async () => { await load(); render(); })();

  const handler = async (chunk: string | Buffer) => {
    const key = chunk.toString();
    if (key === '\x1b[A') { selected = Math.max(0, selected - 1); render(); }
    else if (key === '\x1b[B') { selected = Math.min(Math.max(0, items.length - 1), selected + 1); render(); }
    else if (key === 'r' || key === 'R') { await load(); selected = 0; render(); }
    else if (key === '\x1b' || key === 'q' || key === 'Q') {
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
    } else if (key === '\r' || key === '\n') {
      const item = items[selected];
      if (!item) return;
      process.stdin.removeListener('data', handler);
      const ret = () => { out('\x1b[2J\x1b[H\x1b[3J'); restore(); };
      if (item.dest === 'proposals') handleProposals(url, model, ret);
      else handleTasks(url, model, ret);
    }
  };

  render();
  process.stdin.on('data', handler);
}

// ── /export ───────────────────────────────────────────────────────────────────

function handleExport(url: string, sessionId: string, workspace: string, restore: RestoreFn): void {
  menuHeader('Export Session');
  out(co(C.gray, '  Fetching session...\n'));
  (async () => {
    try {
      const raw  = await httpGet(`${url}/api/sessions/${encodeURIComponent(sessionId)}`);
      const data = JSON.parse(raw) as any;
      const hist: any[] = data?.session?.history || data?.history || [];
      const visible = hist.filter((m: any) => {
        if (m.role !== 'user') return true;
        const c = String(m.content || '');
        return !c.startsWith('SYSTEM:') && !c.startsWith('Before continuing:');
      });
      const lines = [
        `# Prometheus Session Export`,
        ``,
        `**Exported:** ${new Date().toLocaleString()}`,
        `**Session:** \`${sessionId}\``,
        `**Messages:** ${visible.length}`,
        ``,
        `---`,
        ``,
      ];
      for (const msg of visible) {
        if (msg.role === 'user') {
          lines.push(`## You\n`, String(msg.content || ''), '');
        } else if (msg.role === 'assistant') {
          lines.push(`## Prometheus\n`, String(msg.content || ''), '');
        }
      }
      const fname = `prometheus-${new Date().toISOString().slice(0, 10)}-${sessionId.slice(-8)}.md`;
      const fpath = path.join(workspace, fname);
      fs.writeFileSync(fpath, lines.join('\n'), 'utf-8');
      out('\x1b[1A\x1b[2K');
      out(`  ${co(C.green, '✓')} ${co(C.white, `Saved → ${fname}`)}\n`);
      out(`  ${co(C.gray, fpath)}\n`);
    } catch (e: any) {
      out('\x1b[1A\x1b[2K');
      out(`  ${co(C.red, '✗')} ${co(C.gray, e.message || 'Export failed')}\n`);
    }
    out('\n' + co(C.gray, '  Any key to continue...') + '\n');
    process.stdin.once('data', () => { out('\x1b[2J\x1b[H\x1b[3J'); restore(); });
  })();
}

// ── Command palette (Ctrl+K) ──────────────────────────────────────────────────

function showCommandPalette(
  url: string, opts: StatusBoardOptions, restore: RestoreFn,
  onRunCmd: (cmd: string) => void,
): void {
  interface PItem { label: string; desc: string; run: string }
  const CMDS: PItem[] = [
    { label: '/dash',      desc: 'Live dashboard — teams, tasks, events',        run: '/dash'      },
    { label: '/teams',     desc: 'Team browser — chat, dispatch, pause/resume',  run: '/teams'     },
    { label: '/tasks',     desc: 'Background tasks — pause, restart, delete',    run: '/tasks'     },
    { label: '/schedule',  desc: 'Cron schedules — toggle, trigger, log',        run: '/schedule'  },
    { label: '/proposals', desc: 'Proposal inbox — view, approve, deny',         run: '/proposals' },
    { label: '/inbox',     desc: 'Unified inbox — proposals + failed tasks',     run: '/inbox'     },
    { label: '/browse',    desc: 'Navigate workspace files',                     run: '/browse'    },
    { label: '/watch',     desc: 'Live-stream a team\'s events',                 run: '/watch'     },
    { label: '/restart',   desc: 'Restart gateway (quick or rebuild)',           run: '/restart'   },
    { label: '/export',    desc: 'Export this session to Markdown',              run: '/export'    },
    { label: '/resume',    desc: 'Browse & resume previous sessions',            run: '/resume'    },
    { label: '/model',     desc: 'View or switch the active model',              run: '/model'     },
    { label: '/tools',     desc: 'List active skills & tools',                   run: '/tools'     },
    { label: '/status',    desc: 'Model & system info',                          run: '/status'    },
    { label: '/new',       desc: 'Start a fresh chat session',                   run: '/new'       },
    { label: '/help',      desc: 'Show all commands',                            run: '/help'      },
  ];

  let query = '', sel = 0;

  const filtered = () => {
    if (!query) return CMDS;
    const q = query.toLowerCase();
    return CMDS.filter(c => c.label.includes(q) || c.desc.toLowerCase().includes(q));
  };

  const render = () => {
    const sbW = Math.max(32, Math.min(72, cols() - 8));
    out('\x1b[2J\x1b[H\x1b[3J');
    out(`\n  ${co(C.orange, '⌘ Command Palette')}${co(C.gray, '  Ctrl+K')}\n\n`);
    out('  ' + co(C.gray, '┌' + '─'.repeat(sbW) + '┐') + '\n');
    out('  ' + co(C.gray, '│') + ' ⌘ ' + co(C.white, query) + ' '.repeat(Math.max(0, sbW - 3 - query.length)) + co(C.gray, '│') + '\n');
    out('  ' + co(C.gray, '└' + '─'.repeat(sbW) + '┘') + '\n\n');
    const list = filtered();
    if (!list.length) out(co(C.gray, '  No matching commands.\n'));
    else list.slice(0, 14).forEach((item, i) => {
      const m = i === sel ? co(C.orange, '❯') : ' ';
      const l = i === sel ? co(C.white, item.label.padEnd(14)) : co(C.gray, item.label.padEnd(14));
      out(`  ${m}  ${l}  ${co(C.gray, item.desc.slice(0, sbW - 18))}\n`);
    });
    out('\n' + co(C.gray, '  Type to filter  ·  ↑↓ navigate  ·  Enter run  ·  Esc cancel') + '\n');
  };

  render();

  const handler = (chunk: string | Buffer) => {
    const key  = chunk.toString();
    const list = filtered();
    if (key === '\x1b[A') { sel = Math.max(0, sel - 1); render(); }
    else if (key === '\x1b[B') { sel = Math.min(Math.max(0, Math.min(list.length, 14) - 1), sel + 1); render(); }
    else if (key === '\x1b' || key === '\x0b') {
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
    } else if (key === '\r' || key === '\n') {
      const item = list[sel];
      if (!item) return;
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J');
      restore();
      setTimeout(() => onRunCmd(item.run), 0);
    } else if (key === '\x7f' || key === '\b') {
      if (query.length) { query = query.slice(0, -1); sel = 0; render(); }
    } else if (key >= ' ' && key.length === 1) { query += key; sel = 0; render(); }
  };

  process.stdin.on('data', handler);
}

// ── History reverse search (Ctrl+R) ──────────────────────────────────────────

function showHistorySearch(
  history: string[],
  restore: RestoreFn,
  onSelect: (entry: string) => void,
): void {
  let query = '', sel = 0;

  const filtered = () => {
    const base = history.slice().reverse();
    if (!query) return base.slice(0, 20);
    const q = query.toLowerCase();
    return base.filter(h => h.toLowerCase().includes(q)).slice(0, 20);
  };

  const render = () => {
    const sbW = Math.max(32, Math.min(72, cols() - 8));
    out('\x1b[2J\x1b[H\x1b[3J');
    out(`\n  ${co(C.orange, '⟳ History Search')}${co(C.gray, '  Ctrl+R')}\n\n`);
    out('  ' + co(C.gray, '┌' + '─'.repeat(sbW) + '┐') + '\n');
    out('  ' + co(C.gray, '│') + ' 🔍 ' + co(C.white, query) + ' '.repeat(Math.max(0, sbW - 4 - query.length)) + co(C.gray, '│') + '\n');
    out('  ' + co(C.gray, '└' + '─'.repeat(sbW) + '┘') + '\n\n');
    const list = filtered();
    if (!list.length) out(co(C.gray, '  No matching entries.\n'));
    else list.forEach((entry, i) => {
      const m = i === sel ? co(C.orange, '❯') : ' ';
      const d = entry.slice(0, sbW - 2);
      out(`  ${m}  ${i === sel ? co(C.white, d) : co(C.gray, d)}\n`);
    });
    out('\n' + co(C.gray, '  Type to search  ·  ↑↓ navigate  ·  Enter paste  ·  Esc cancel') + '\n');
  };

  render();

  const handler = (chunk: string | Buffer) => {
    const key  = chunk.toString();
    const list = filtered();
    if (key === '\x1b[A') { sel = Math.max(0, sel - 1); render(); }
    else if (key === '\x1b[B') { sel = Math.min(Math.max(0, list.length - 1), sel + 1); render(); }
    else if (key === '\x1b' || key === '\x12') {
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J'); restore();
    } else if (key === '\r' || key === '\n') {
      const entry = list[sel];
      process.stdin.removeListener('data', handler); out('\x1b[2J\x1b[H\x1b[3J');
      if (entry) onSelect(entry); else restore();
    } else if (key === '\x7f' || key === '\b') {
      if (query.length) { query = query.slice(0, -1); sel = 0; render(); }
    } else if (key >= ' ' && key.length === 1) { query += key; sel = 0; render(); }
  };

  process.stdin.on('data', handler);
}

// ─── Tool name prettifier ─────────────────────────────────────────────────────

function prettify(name: string): string {
  const M: Record<string, string> = {
    // File ops
    read_file:          'Reading file',
    create_file:        'Creating file',
    find_replace:       'Editing file',
    replace_lines:      'Editing file',
    insert_after:       'Editing file',
    delete_lines:       'Editing file',
    apply_patch:        'Applying patch',
    delete_file:        'Deleting file',
    list_files:         'Listing files',
    list_directory:     'Listing directory',
    file_stats:         'File stats',
    // Search
    grep_file:          'Searching file',
    grep_files:         'Searching files',
    search_files:       'Searching files',
    // Web
    web_search:         'Searching web',
    web_fetch:          'Fetching URL',
    // Skills
    skill_list:         'Searching skills',
    skill_read:         'Reading skill',
    skill_create:       'Creating skill',
    // Memory
    memory_read:        'Reading memory',
    memory_write:       'Writing memory',
    memory_browse:      'Browsing memory',
    memory_search:      'Searching memory',
    memory_read_record: 'Reading memory',
    // Shell / commands
    run_command:        'Running command',
    shell:              'Running shell',
    write_note:         'Writing note',
    // Browser
    browser_open:       'Opening browser',
    browser_snapshot:   'Browser snapshot',
    browser_click:      'Browser click',
    browser_fill:       'Browser fill',
    browser_type:       'Browser type',
    browser_scroll:     'Browser scroll',
    browser_run_js:     'Browser JS',
    // Desktop
    desktop_screenshot: 'Desktop screenshot',
    desktop_click:      'Desktop click',
    desktop_type:       'Desktop type',
    desktop_find_window:'Finding window',
    desktop_launch_app: 'Launching app',
    desktop_list_apps:      'Listing apps',
    desktop_list_windows:   'Listing windows',
    desktop_get_window_state:'Window state',
    desktop_window_click:   'Window click',
    desktop_window_type:    'Window type',
    desktop_window_press_key:'Window key',
    desktop_window_scroll:  'Window scroll',
    desktop_window_drag:    'Window drag',
    // Agents / orchestration
    declare_plan:       'Declaring plan',
    complete_plan_step: 'Completing step',
    step_complete:      'Step complete',
    background_spawn:   'Spawning agent',
    background_status:  'Checking agents',
    background_progress:'Agent progress',
    background_join:    'Joining agent',
    background_wait:    'Waiting for agents',
    dispatch_team_agent:'Dispatching agent',
    talk_to_subagent:   'Talking to agent',
    // Creative / media
    generate_image:     'Generating image',
    analyze_image:      'Analyzing image',
    download_url:       'Downloading',
    // System
    write_proposal:     'Writing proposal',
    task_control:       'Task control',
    schedule_job:       'Scheduling job',
    send_telegram:      'Sending Telegram',
    switch_model:       'Switching model',
    gateway_restart:    'Restarting gateway',
    time_now:           'Checking time',
    context_compaction: 'Compacting context',
  };
  const m = M[name];
  if (m) return m;
  // Generic fallback: snake_case → Title Case
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Legacy exports ───────────────────────────────────────────────────────────

export function printStatusBoard(_opts: StatusBoardOptions): void {}
export function runInteractiveMenu(_opts: { webUiUrl: string }): void {}
