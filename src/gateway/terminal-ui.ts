/**
 * terminal-ui.ts - Prometheus Gateway Terminal UI
 *
 * 3-phase experience:
 *   Phase 1: Animated loading screen — torch flickers immediately on launch
 *   Phase 2: Welcome panel — replaces the loading box in-place (same rows, no flash)
 *   Phase 3: Interactive REPL — Claude Code-style boxed input at bottom of output stream
 *
 * CRITICAL design rules:
 *   - Gateway logs are suppressed for the ENTIRE process lifetime (accessible via /logs)
 *   - NO alternate screen buffer (breaks Windows Terminal + leaks logs)
 *   - Loading box and welcome panel share the same fixed row region → no clearScreen flash
 *   - Torch animation runs continuously via setInterval throughout all phases
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { randomUUID } from 'crypto';
import packageJson from '../../package.json';
import { setSessionChannelHint } from './comms/broadcaster.js';

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  orange:  '\x1b[38;2;255;159;67m',
  yellow:  '\x1b[38;2;255;214;165m',
  green:   '\x1b[38;2;107;203;119m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  red:     '\x1b[91m',
  amber:   '\x1b[38;2;255;180;50m',
};
const co    = (color: string, text: string) => `${color}${text}${C.reset}`;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ─── Log suppression ──────────────────────────────────────────────────────────
// Suppress ALL console output for the entire process lifetime.
// Gateway logs go to _logBuffer and are only shown on /logs.

let _logBuffer: string[] = [];
const _origLog   = console.log;
const _origWarn  = console.warn;
const _origError = console.error;

export function suppressStartupLogs(): void {
  const intercept = (...args: any[]) => {
    const line = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    _logBuffer.push(line);
    if (line.includes('EADDRINUSE')) _origLog(line); // only show port-conflict errors
  };
  console.log   = intercept;
  console.warn  = intercept;
  console.error = intercept;
}

// "Restore" is intentionally a no-op — we keep suppression forever so gateway
// logs never bleed into the terminal UI.
export function restoreConsole(): void { /* intentionally suppressed forever */ }
export function getStartupLogs(): string[] { return [..._logBuffer]; }

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
  ['      )          ', '     ) \\         ', '   / ) (  \\      ', '   \\(_)/         ', '    ||| |        ', '   =======       ', '   |     |       '],
  ['     (           ', '   ( ) )         ', '  ( \\(  /        ', '   \\(_)/         ', '    ||| |        ', '   =======       ', '   |     |       '],
  ['    )  )         ', '   ( ) (         ', '  /  ) \\  )      ', '   \\(_)/         ', '    ||| |        ', '   =======       ', '   |     |       '],
  ['     ) )         ', '    ( )(          ', '   / )(  \\       ', '   \\(_)/         ', '    ||| |        ', '   =======       ', '   |     |       '],
];

let _frame = 0, _tick = 0;
let _torchTimer: ReturnType<typeof setInterval> | null = null;
let _torchFn: (() => void) | null = null;

function torchRow(row: string, ri: number, flicker: number): string {
  if (ri >= 4) return co(C.orange, row);
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

// ─── Phase 1: Loading screen ──────────────────────────────────────────────────
//
// The loading box occupies a fixed set of rows starting at row 2 (1-indexed).
// Row 1 is blank. The box is:
//   ╔══════...══╗   (row 2)
//   ║ torch...  ║   (rows 3-9, 7 torch rows)
//   ╠══════...══╣   (row 10)
//   ║ version   ║   (row 11)
//   ║           ║   (row 12)
//   ║ bar       ║   (row 13)
//   ║ status    ║   (row 14)
//   ╚══════...══╝   (row 15)
//
// Phase 2 overwrites rows 2-15 with the welcome panel — same dimensions.

const BOX_W = 62; // inner width between ║ and ║
const BOX_TOP_ROW = 2; // 1-indexed row of the top border ╔
const TORCH_H = 7;
const LEFT_W  = 26; // left column visible width (inside box)
const DIV_COL = 1;  // 1 char for the │ divider
const RIGHT_W = BOX_W - LEFT_W - DIV_COL; // right column visible width

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

export async function runLoadingScreen(): Promise<void> {
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

  // Write a boxRow at a given 1-indexed screen row.
  // content must already have ANSI colors; we pad to BOX_W visible chars.
  const boxRow = (screenRow: number, content: string) => {
    const vis = strip(content);
    const pad = Math.max(0, BOX_W - vis.length);
    moveTo(screenRow, 1);
    eraseLine();
    out(`${co(C.orange, '║')}${content}${' '.repeat(pad)}${co(C.orange, '║')}`);
  };

  const render = () => {
    const elapsed = Date.now() - start;
    const raw     = Math.min(elapsed / 6000, 0.95);
    progress      = _serverReady ? 1.0 : raw;
    msgIdx        = Math.min(Math.floor(raw * STATUS_MSGS.length), STATUS_MSGS.length - 1);
    spinIdx++;

    const filled = Math.floor(progress * 30);
    const bar    = co(C.orange, '█'.repeat(filled)) + co(C.gray, '░'.repeat(30 - filled));
    const pct    = Math.floor(progress * 100);
    const spin   = co(C.yellow, SPARKLES[spinIdx % SPARKLES.length]);

    // Top border
    moveTo(BOX_TOP_ROW, 1); eraseLine();
    out(co(C.orange, '╔' + '═'.repeat(BOX_W) + '╗'));

    // Torch rows
    const torch = getTorch();
    for (let i = 0; i < TORCH_H; i++) {
      const t   = torch[i];
      const vis = strip(t);
      boxRow(BOX_TOP_ROW + 1 + i, ` ${t}${' '.repeat(Math.max(0, BOX_W - 1 - vis.length))}`);
    }

    // Separator
    moveTo(BOX_TOP_ROW + 1 + TORCH_H, 1); eraseLine();
    out(co(C.orange, '╠' + '═'.repeat(BOX_W) + '╣'));

    // Version line
    const verText = ` ${spin} ${C.bold}${C.white}Prometheus Gateway v${packageJson.version}${C.reset}${C.gray} — initializing${C.reset}`;
    boxRow(BOX_TOP_ROW + 2 + TORCH_H, verText);

    // Blank
    boxRow(BOX_TOP_ROW + 3 + TORCH_H, '');

    // Progress bar
    const barText = ` [${bar}${co(C.gray, `] ${String(pct).padStart(3)}%`)}`;
    boxRow(BOX_TOP_ROW + 4 + TORCH_H, barText);

    // Status message
    boxRow(BOX_TOP_ROW + 5 + TORCH_H, ` ${co(C.gray, STATUS_MSGS[msgIdx])}`);

    // Bottom border
    moveTo(BOX_TOP_ROW + 6 + TORCH_H, 1); eraseLine();
    out(co(C.orange, '╚' + '═'.repeat(BOX_W) + '╝'));
  };

  startTorch(render);

  const MIN_MS = 2000;
  while (true) {
    const el = Date.now() - start;
    if (_serverReady && el >= MIN_MS) break;
    if (el > 15000) break;
    await sleep(50);
  }

  render(); // show 100% bar
  await sleep(400);

  if (_serverReadyOpts) await runWelcomePanel(_serverReadyOpts);
}

// ─── Phase 2: Welcome panel ───────────────────────────────────────────────────
// Overwrites the loading box rows exactly — same BOX_W, same BOX_TOP_ROW.
// Left col: torch (animated) + greeting + model info
// Right col: tips

async function runWelcomePanel(opts: StatusBoardOptions): Promise<void> {
  const name      = readName(opts.workspace);
  const greeting  = name ? `Welcome back, ${name}!` : 'Prometheus is ready.';
  const url       = `http://${opts.host}:${opts.port}`;
  const modelLine = `${opts.model} · ${opts.gpuInfo || 'CPU'}`;
  const wsShort   = opts.workspace.length > 24 ? '...' + opts.workspace.slice(-21) : opts.workspace;

  const CONTENT_ROWS = Math.max(TORCH_H + 5, 12); // rows between top and bottom borders

  const tips: Array<{ t: string; h: boolean }> = [
    { t: 'Tips for getting started',      h: true  },
    { t: `/help  — see all commands`,     h: false },
    { t: `Web UI — ${url}`,              h: false },
    { t: '',                              h: false },
    { t: 'Quick actions',                h: true  },
    { t: '/status  — model & system info', h: false },
    { t: '/clear   — clear the screen',   h: false },
    { t: '/logs    — startup logs',        h: false },
    { t: '/open    — open Web UI',         h: false },
  ];

  // center a string in a field of `w` visible chars
  const center = (s: string, w: number): string => {
    const pad = Math.max(0, Math.floor((w - s.length) / 2));
    return ' '.repeat(pad) + s + ' '.repeat(Math.max(0, w - pad - s.length));
  };

  // Build the left cell for content row `r`
  const leftCell = (r: number): string => {
    if (r < TORCH_H) {
      const t   = getTorch()[r];
      const vis = strip(t);
      return ` ${t}${' '.repeat(Math.max(0, LEFT_W - 1 - vis.length))}`;
    }
    const offset = r - TORCH_H;
    let raw = '';
    if      (offset === 0) raw = center(greeting,          LEFT_W);
    else if (offset === 2) raw = center('Prometheus',      LEFT_W);
    else if (offset === 3) raw = center(modelLine.slice(0, LEFT_W), LEFT_W);
    else if (offset === 4) raw = center(wsShort.slice(0, LEFT_W),   LEFT_W);
    else                   raw = ' '.repeat(LEFT_W);

    if (offset === 0) return `${C.bold}${C.white}${raw}${C.reset}`;
    if (offset === 2) return `${C.bold}${C.orange}${raw}${C.reset}`;
    if (offset === 3 || offset === 4) return `${C.gray}${raw}${C.reset}`;
    return raw;
  };

  // Build the right cell for content row `r`
  const rightCell = (r: number): string => {
    if (r >= tips.length || !tips[r].t) return ' '.repeat(RIGHT_W);
    const raw = ` ${tips[r].t.slice(0, RIGHT_W - 1)}`;
    const vis = raw.length;
    const pad = ' '.repeat(Math.max(0, RIGHT_W - vis));
    return tips[r].h
      ? `${C.orange}${raw}${C.reset}${pad}`
      : `${C.gray}${raw}${C.reset}${pad}`;
  };

  // Draw the full panel (static parts — torch repaints via animation)
  const drawPanel = () => {
    // Top border
    moveTo(BOX_TOP_ROW, 1); eraseLine();
    out(co(C.orange, '╔' + '─'.repeat(LEFT_W) + '┬' + '─'.repeat(RIGHT_W) + '╗'));

    // Content rows
    for (let r = 0; r < CONTENT_ROWS; r++) {
      moveTo(BOX_TOP_ROW + 1 + r, 1); eraseLine();
      const lc = leftCell(r);
      const rc = rightCell(r);
      const lcVis = strip(lc);
      const lcPad = ' '.repeat(Math.max(0, LEFT_W - lcVis.length));
      out(`${co(C.orange, '║')}${lc}${lcPad}${co(C.orange, '│')}${rc}${co(C.orange, '║')}`);
    }

    // Bottom border
    moveTo(BOX_TOP_ROW + 1 + CONTENT_ROWS, 1); eraseLine();
    out(co(C.orange, '╚' + '─'.repeat(LEFT_W) + '┴' + '─'.repeat(RIGHT_W) + '╝'));
  };

  drawPanel();

  // Switch torch to repaint only the left column cells (torch rows only)
  setTorchFn(() => {
    const torch = getTorch();
    for (let r = 0; r < TORCH_H; r++) {
      const t   = torch[r];
      const vis = strip(t);
      const lc  = ` ${t}${' '.repeat(Math.max(0, LEFT_W - 1 - vis.length))}`;
      const lcVis = strip(lc);
      const lcPad = ' '.repeat(Math.max(0, LEFT_W - lcVis.length));
      moveTo(BOX_TOP_ROW + 1 + r, 1);
      out(`${co(C.orange, '║')}${lc}${lcPad}${co(C.orange, '│')}`);
    }
  });

  // Position cursor below the welcome panel bottom border
  moveTo(BOX_TOP_ROW + CONTENT_ROWS + 2, 1);
  showCursor();

  await sleep(700);
  await runREPL(opts);
}

// ─── Phase 3: REPL ───────────────────────────────────────────────────────────
//
// No alt-screen. Output flows naturally downward in the scroll buffer.
// The input box is drawn inline after each response and after each prompt:
//
//   ┌──────────────────────────────────────────────────────┐
//   │ ❯ <user types here>                                  │
//   └──────────────────────────────────────────────────────┘
//   ? for shortcuts                                 ◉ model
//
// On Enter, we erase the input box, print the message above, print the
// response below it, then redraw the input box.

interface PlanStep {
  id:     string;
  label:  string;
  status: 'pending' | 'running' | 'done' | 'error';
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _spinTick = 0;
let _plan: PlanStep[] = [];
let _planRendered = 0; // rows occupied by the live plan block

// ── Input box ─────────────────────────────────────────────────────────────────

function drawInputBox(model: string, buffer: string): void {
  const w = Math.max(40, cols() - 4);
  out('\n');
  out(co(C.orange, '  ┌' + '─'.repeat(w) + '┐') + '\n');
  const maxBuf = w - 4; // '❯ ' + 1 space + cursor
  const display = buffer.length > maxBuf ? buffer.slice(buffer.length - maxBuf) : buffer;
  out(co(C.orange, '  │') + ' ' + co(C.orange, '❯ ') + C.reset + display + '\n');
  out(co(C.orange, '  └' + '─'.repeat(w) + '┘') + '\n');
  const hint  = co(C.gray, '? for shortcuts');
  const minfo = co(C.gray, `◉ ${model}`);
  const hv    = strip(hint), mv = strip(minfo);
  const gap   = Math.max(1, w + 4 - hv.length - mv.length);
  out(hint + ' '.repeat(gap) + minfo + '\n');
}

// Erase the input box (5 lines: \n + top border + input line + bottom border + status bar)
function eraseInputBox(): void {
  // Move up 5 lines and clear each
  for (let i = 0; i < 5; i++) {
    out('\x1b[1A\x1b[2K');
  }
}

// ── Plan block ────────────────────────────────────────────────────────────────

function printPlan(): void {
  const rows: string[] = [];
  rows.push(co(C.gray, '  ─── Plan ' + '─'.repeat(28)));
  for (const s of _plan) {
    const icon = s.status === 'done'    ? co(C.green,  '✓')
               : s.status === 'error'   ? co(C.red,    '✗')
               : s.status === 'running' ? co(C.orange, SPIN[_spinTick % SPIN.length])
               :                         co(C.gray,    '·');
    const label = s.status === 'running'
      ? co(C.white, s.label)
      : co(C.gray, s.label);
    rows.push(`  ${icon}  ${label}`);
  }
  rows.push('');
  _planRendered = rows.length;
  out(rows.join('\n') + '\n');
}

function erasePlan(): void {
  for (let i = 0; i < _planRendered; i++) out('\x1b[1A\x1b[2K');
  _planRendered = 0;
}

function refreshPlan(): void {
  if (_plan.length === 0) return;
  erasePlan();
  printPlan();
}

// ── Main REPL loop ────────────────────────────────────────────────────────────

async function runREPL(opts: StatusBoardOptions): Promise<void> {
  const url       = `http://${opts.host}:${opts.port}`;
  // Fresh session per gateway start — NOT registered until first message is sent
  let   sessionId = `cli_${randomUUID()}`;
  let   sessionRegistered = false; // only call setSessionChannelHint on first send
  
  let   abort     = { aborted: false };
  let   inFlight  = false;
  let   ctrlCCount = 0;
  let   ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  let   lineBuffer = '';

  if (!process.stdin.isTTY) {
    _origLog(co(C.gray, 'Non-TTY — REPL unavailable. Gateway running.'));
    return;
  }

  // Torch: advance frame count internally but don't render (moveTo interferes with input box cursor)
  setTorchFn(() => {});

  // Spinner timer for live plan updates
  const spinTimer = setInterval(() => {
    _spinTick++;
    if (_plan.some(s => s.status === 'running') && _planRendered > 0) {
      refreshPlan();
    }
  }, 80);
  (spinTimer as any).unref?.();

  // Add extra spacing to ensure input box clears the welcome panel
  out('\n\n\n\n\n\n\n\n');
  drawInputBox(opts.model, '');

  hideCursor(); // Hide the flickering cursor during REPL
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const cleanup = () => {
    clearInterval(spinTimer);
    stopTorch();
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
    process.stdin.removeListener('data', onKey);
    showCursor();
  };

  const submit = async (input: string) => {
    const text = input.trim();
    if (!text) {
      drawInputBox(opts.model, '');
      return;
    }

    eraseInputBox();

    // ── Slash commands ────────────────────────────────────────────────────────
    if (text.startsWith('/')) {
      const [cmd] = text.slice(1).split(' ');
      switch (cmd.toLowerCase()) {
        case 'help':
          out('\n');
          [
            ['/help',   'Show this list'],
            ['/new',    'Start a fresh chat session'],
            ['/resume', 'Open a previous terminal chat'],
            ['/status', 'Model & GPU info'],
            ['/clear',  'Clear the screen'],
            ['/logs',   'Show startup logs'],
            ['/open',   'Open Web UI in browser'],
            ['/exit',   'Exit REPL (gateway keeps running)'],
          ].forEach(([c, d]) => out(`  ${co(C.orange, c.padEnd(12))}${co(C.gray, d)}\n`));
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
          } catch {
            out(co(C.red, '  Could not reach gateway.\n'));
          }
          break;
        case 'clear':
          out('\x1b[2J\x1b[H');
          break;
        case 'new':
          // Start a fresh unregistered session
          sessionId = `cli_${randomUUID()}`;
          sessionRegistered = false;
          // Clear screen with multiple escape sequences for maximum compatibility
          out('\x1b[2J');        // Clear entire display
          out('\x1b[H');         // Move cursor to home (0,0)
          out('\x1b[3J');        // Clear scrollback buffer (some terminals)
          out(co(C.green, '  ✓ New chat session started\n\n'));
          lineBuffer = '';
          break;
        case 'resume':
          // Interactive session selection — clear screen + scrollback immediately, then load
          out('\x1b[2J\x1b[H\x1b[3J');
          out('\n' + co(C.orange, '  Resume Session') + '\n\n');
          out('  ' + co(C.gray, 'Loading sessions...') + '\n');
          // Remove main key handler while menu is active
          process.stdin.removeListener('data', onKey);
          (async () => {
            try {
              const sessionsResp = await httpGet(`${url}/api/sessions?channel=terminal`);
              let sessionList: any[];
              try {
                const parsed = JSON.parse(sessionsResp) as any;
                sessionList = parsed.sessions || [];
              } catch (_parseErr: any) {
                out('\x1b[2J\x1b[H');
                out(co(C.red, '  ✗ Error: Server returned invalid JSON\n\n'));
                process.stdin.on('data', onKey);
                drawInputBox(opts.model, '');
                return;
              }

              // ── Build menu ────────────────────────────────────────────────
              out('\x1b[2J\x1b[H');
              out('\n' + co(C.orange, '  Resume Session') + '\n\n');

              if (!sessionList || sessionList.length === 0) {
                out(co(C.gray, '  No previous terminal sessions found.\n\n'));
                process.stdin.on('data', onKey);
                drawInputBox(opts.model, '');
                return;
              }

              let selected = 0;
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

                // Search box
                const sbW = Math.max(30, Math.min(60, (process.stdout.columns || 80) - 8));
                out('  ' + co(C.gray, '┌' + '─'.repeat(sbW) + '┐') + '\n');
                out('  ' + co(C.gray, '│') + ' 🔍 ' + (searchQuery || co(C.gray, '')) + ' '.repeat(Math.max(0, sbW - 3 - searchQuery.length)) + co(C.gray, '│') + '\n');
                out('  ' + co(C.gray, '└' + '─'.repeat(sbW) + '┘') + '\n\n');

                const list = filteredList();
                if (list.length === 0) {
                  out(co(C.gray, '  No matching sessions.\n'));
                } else {
                  list.forEach((s: any, i: number) => {
                    const marker = i === selected ? co(C.orange, '❯') : ' ';
                    const preview = (s.title || s.preview || '(empty)').slice(0, 52);
                    const date = new Date(s.createdAt || s.timestamp || Date.now()).toLocaleDateString();
                    const num = co(C.gray, `[${i + 1}]`);
                    out(`  ${marker} ${num} ${date} · ${i === selected ? co(C.white, preview) : co(C.gray, preview)}\n`);
                  });
                }

                out('\n' + co(C.gray, '  Ctrl+A all · Ctrl+B branch · Ctrl+V preview · Ctrl+R rename · Type to search · Esc cancel') + '\n');
              };

              renderMenu();

              const menuHandler = (chunk: string | Buffer) => {
                const key = chunk.toString();
                const list = filteredList();

                if (key === '\u001b[A' || key === '\u001b[D') { // Up / Left
                  selected = Math.max(0, selected - 1);
                  renderMenu();
                } else if (key === '\u001b[B' || key === '\u001b[C') { // Down / Right
                  selected = Math.min(Math.max(0, list.length - 1), selected + 1);
                  renderMenu();
                } else if (key === '\r' || key === '\n') { // Enter — select
                  process.stdin.removeListener('data', menuHandler);
                  const chosen = list[selected];
                  out('\x1b[2J\x1b[H\x1b[3J');
                  lineBuffer = '';
                  if (chosen) {
                    sessionId = chosen.id;
                    sessionRegistered = true; // already exists on server
                    // Load and render the session history before returning to prompt
                    printSessionHistory(url, chosen.id, opts.model).then(() => {
                      process.stdin.on('data', onKey);
                      drawInputBox(opts.model, '');
                    }).catch(() => {
                      process.stdin.on('data', onKey);
                      drawInputBox(opts.model, '');
                    });
                  } else {
                    process.stdin.on('data', onKey);
                    drawInputBox(opts.model, '');
                  }
                } else if (key === '\u001b' || key === 'q' || key === 'Q') { // Esc / q — cancel
                  process.stdin.removeListener('data', menuHandler);
                  out('\x1b[2J\x1b[H\x1b[3J');
                  process.stdin.on('data', onKey);
                  drawInputBox(opts.model, '');
                } else if (key === '\x7f' || key === '\b') { // Backspace in search
                  if (searchQuery.length > 0) {
                    searchQuery = searchQuery.slice(0, -1);
                    selected = 0;
                    renderMenu();
                  }
                } else if (key >= ' ' && key.length === 1) { // Printable — search filter
                  searchQuery += key;
                  selected = 0;
                  renderMenu();
                }
              };

              process.stdin.on('data', menuHandler);
            } catch (err: any) {
              out('\x1b[2J\x1b[H\x1b[3J');
              out(co(C.red, `  ✗ Error loading sessions: ${err.message}\n\n`));
              process.stdin.on('data', onKey);
              drawInputBox(opts.model, '');
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
        case 'open': {
          const { exec } = require('child_process') as typeof import('child_process');
          const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          exec(`${opener} ${url}`);
          out(co(C.green, `  ✓ Opening ${url}\n`));
          break;
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
      drawInputBox(opts.model, '');
      return;
    }

    // ── Chat request ──────────────────────────────────────────────────────────
    if (inFlight) {
      out(co(C.gray, '  (request in progress — Ctrl+C to cancel)\n\n'));
      drawInputBox(opts.model, '');
      return;
    }

    inFlight = true;
    ctrlCCount = 0;
    abort = { aborted: false };
    _plan = [];
    _planRendered = 0;

    // Register the session on first message send only
    if (!sessionRegistered) {
      setSessionChannelHint(sessionId, { channel: 'terminal', timestamp: Date.now() });
      sessionRegistered = true;
    }

    // Print user message with proper formatting
    const hrWidth = Math.max(20, cols() - 4);
    out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
    out(`  ${co(C.white, C.bold + 'You:')} ${text}\n\n`);
    out(`  ${co(C.orange, 'Prometheus 🔥:')}\n`);

    let tokenBuffer = '';
    let responsePrinted = false;

    try {
      await streamChat(url, sessionId, text, abort, {
        onToken: (tok) => {
          if (!responsePrinted) { responsePrinted = true; out('  '); }
          tokenBuffer += tok;
          // Print token, handling newlines (indent continuation lines)
          const parts = tok.split('\n');
          for (let i = 0; i < parts.length; i++) {
            out(co(C.white, parts[i]));
            if (i < parts.length - 1) out('\n  ');
          }
        },
        onToolCall: (name, args) => {
          if (tokenBuffer.length > 0) { out('\n'); tokenBuffer = ''; }
          out(`\n  ${co(C.gray, '⟳')} ${co(C.gray, prettify(name))}${args ? co(C.gray, ' ' + args) : ''}\n`);
        },
        onToolResult: (name, isErr) => {
          // Move up one line and overwrite the ⟳ line
          out('\x1b[1A\x1b[2K');
          out(`  ${isErr ? co(C.red, '✗') : co(C.green, '✓')} ${co(C.gray, prettify(name))}\n`);
        },
        onPlanUpdate: () => {
          if (_planRendered > 0) erasePlan();
          printPlan();
        },
        onFinal: (text) => {
          if (!responsePrinted && text) {
            responsePrinted = true;
            out('  ');
            const parts = text.split('\n');
            for (let i = 0; i < parts.length; i++) {
              out(co(C.white, parts[i]));
              if (i < parts.length - 1) out('\n  ');
            }
          }
        },
        onDone: () => {},
        onError: (msg) => {
          if (tokenBuffer.length > 0) { out('\n'); tokenBuffer = ''; }
          out('\n' + co(C.red, `  ✗ ${msg}`) + '\n');
        },
      });
    } catch (e: any) {
      if (!abort.aborted) {
        out('\n' + co(C.red, `  Error: ${e.message || e}`) + '\n');
      }
    } finally {
      inFlight = false;
      if (_planRendered > 0) erasePlan();
      _plan = [];
      if (tokenBuffer.length > 0 || responsePrinted) out('\n');
      out('\n');
      drawInputBox(opts.model, '');
    }
  };

  const onKey = (chunk: string | Buffer) => {
    const key = chunk.toString();

    if (key === '\x03') { // Ctrl+C
      if (inFlight) {
        abort.aborted = true;
        inFlight = false;
        if (_planRendered > 0) erasePlan();
        _plan = [];
        out('\n' + co(C.gray, '  Cancelled.\n\n'));
        drawInputBox(opts.model, lineBuffer);
        return;
      }
      ctrlCCount++;
      if (ctrlCCount === 1) {
        eraseInputBox();
        out(co(C.gray, '  Press Ctrl+C again to exit. Gateway keeps running.\n\n'));
        drawInputBox(opts.model, lineBuffer);
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

    if (key === '\r' || key === '\n') {
      const line = lineBuffer;
      lineBuffer = '';
      submit(line);
      return;
    }

    if (key === '\x7f' || key === '\b') {
      if (lineBuffer.length > 0) {
        lineBuffer = lineBuffer.slice(0, -1);
        // Redraw just the input line: move up 3 (input line + bottom border + status), rewrite
        eraseInputBox();
        drawInputBox(opts.model, lineBuffer);
      }
      return;
    }

    if (key.startsWith('\x1b')) return; // ignore escape sequences (arrows etc.)

    if (key >= ' ') {
      lineBuffer += key;
      eraseInputBox();
      drawInputBox(opts.model, lineBuffer);
    }
  };

  process.stdin.on('data', onKey);
}

// ─── Session history renderer ───────────────────────────────────────────────
// Fetches a session's messages from the API and prints them as a scrollback
// transcript so the user has context before continuing the conversation.

async function printSessionHistory(gatewayUrl: string, sid: string, model: string): Promise<void> {
  try {
    const raw = await httpGet(`${gatewayUrl}/api/sessions/${encodeURIComponent(sid)}`);
    const data = JSON.parse(raw) as any;
    const history: Array<{ role: string; content: string; timestamp?: number }> =
      data?.session?.history || data?.history || [];

    // Filter out internal system prompts (compaction/memory-flush injections)
    const visible = history.filter((m: any) => {
      if (m.role !== 'user') return true;
      const c = String(m.content || '');
      return !c.startsWith('SYSTEM:') && !c.startsWith('Before continuing:');
    });

    if (visible.length === 0) {
      out(co(C.gray, '  (no messages in this session)\n\n'));
      return;
    }

    const hrWidth = Math.max(20, cols() - 4);

    // Show only the last 20 messages so the screen isn't flooded
    const SHOW_MAX = 20;
    const slice = visible.slice(-SHOW_MAX);
    if (visible.length > SHOW_MAX) {
      out(co(C.gray, `  ··· ${visible.length - SHOW_MAX} earlier messages hidden ···\n\n`));
    }

    for (const msg of slice) {
      if (msg.role === 'user') {
        out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
        out(`  ${co(C.white, C.bold + 'You:')} ${String(msg.content || '').split('\n').join('\n  ')}\n`);
      } else if (msg.role === 'assistant') {
        out(`\n  ${co(C.orange, 'Prometheus 🔥:')}\n`);
        const lines = String(msg.content || '').split('\n');
        for (const line of lines) {
          out(`  ${co(C.white, line)}\n`);
        }
      }
    }
    out('\n' + co(C.gray, '  ' + '─'.repeat(hrWidth)) + '\n');
    out(co(C.gray, `  ↑ Resumed session · ${slice.length} messages shown · Continue below\n\n`));
  } catch {
    // Non-fatal — session still resumes, just without history display
    out(co(C.gray, '  (could not load history)\n\n'));
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

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

// ─── SSE streaming ───────────────────────────────────────────────────────────

interface CB {
  onToken:      (tok: string) => void;
  onToolCall:   (name: string, args: string) => void;
  onToolResult: (name: string, isErr: boolean) => void;
  onPlanUpdate: () => void;
  onFinal:      (text: string) => void;
  onDone:       () => void;
  onError:      (msg: string) => void;
}

function streamChat(
  gatewayUrl: string, sessionId: string, message: string,
  abort: { aborted: boolean }, cb: CB,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ message, sessionId });
    const urlObj  = new URL(`${gatewayUrl}/api/chat`);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port:     Number(urlObj.port) || 80,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
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

          switch (e.type) {
            case 'token': {
              const t = String(e.text || e.token || '');
              if (t) { printed = true; cb.onToken(t); }
              break;
            }
            case 'tool_call': {
              const name = String(e.action || e.tool || '');
              const args = e.args ? JSON.stringify(e.args).slice(0, 60) : '';
              cb.onToolCall(name, args);
              break;
            }
            case 'tool_result': {
              cb.onToolResult(String(e.action || ''), !!e.error);
              break;
            }
            case 'progress_state': {
              const items: any[] = e.items || [];
              if (items.length >= 1) {
                _plan = items.map((it: any) => ({
                  id:     String(it.id || it.label || Math.random()),
                  label:  String(it.label || it.title || it.name || 'Step'),
                  status: it.status === 'done'    ? 'done'
                        : it.status === 'running' ? 'running'
                        : it.status === 'error'   ? 'error'
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
            case 'done':  { cb.onDone(); resolve(); break; }
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

// ─── Tool name prettifier ─────────────────────────────────────────────────────

function prettify(name: string): string {
  const M: Record<string, string> = {
    read_file:          'Reading file',
    create_file:        'Creating file',
    find_replace:       'Editing file',
    replace_lines:      'Editing file',
    delete_file:        'Deleting file',
    list_files:         'Listing files',
    web_search:         'Searching web',
    web_fetch:          'Fetching URL',
    memory_read:        'Reading memory',
    memory_write:       'Writing memory',
    memory_browse:      'Browsing memory',
    write_note:         'Writing note',
    run_command:        'Running command',
    browser_open:       'Opening browser',
    browser_snapshot:   'Browser snapshot',
    browser_click:      'Browser click',
    browser_fill:       'Browser fill',
    desktop_screenshot: 'Desktop screenshot',
    desktop_click:      'Desktop click',
    desktop_type:       'Desktop type',
    declare_plan:       'Declaring plan',
    complete_plan_step: 'Completing step',
    background_spawn:   'Spawning agent',
    background_status:  'Checking agents',
    write_proposal:     'Writing proposal',
    task_control:       'Task control',
    schedule_job:       'Scheduling job',
    send_telegram:      'Sending Telegram',
  };
  return M[name] ?? name.replace(/_/g, ' ');
}

// ─── Legacy exports ───────────────────────────────────────────────────────────

export function printStatusBoard(_opts: StatusBoardOptions): void {}
export function runInteractiveMenu(_opts: { webUiUrl: string }): void {}
