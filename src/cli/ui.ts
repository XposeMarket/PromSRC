/**
 * cli/ui.ts — Lightweight ANSI output helpers for Prometheus CLI commands.
 * Matches the orange/gray/white theme from terminal-ui.ts. Zero runtime deps.
 */

// ─── Color palette (same as terminal-ui) ─────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  orange: '\x1b[38;2;255;159;67m',
  green:  '\x1b[38;2;107;203;119m',
  white:  '\x1b[97m',
  gray:   '\x1b[90m',
  red:    '\x1b[91m',
  amber:  '\x1b[38;2;255;180;50m',
  cyan:   '\x1b[38;2;100;210;230m',
};

const noColor = !!process.env.NO_COLOR || !process.stdout.isTTY;
const co = (color: string, text: string) => noColor ? text : `${color}${text}${C.reset}`;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const write = (s: string) => process.stdout.write(s);
const werr  = (s: string) => process.stderr.write(s);

// ─── Basic output ─────────────────────────────────────────────────────────────

export function info(msg: string): void {
  write(co(C.gray, `  · ${msg}`) + '\n');
}

export function success(msg: string): void {
  write(`  ${co(C.green, '✔')}  ${co(C.white, msg)}\n`);
}

export function warn(msg: string): void {
  write(`  ${co(C.amber, '⚠')}  ${co(C.amber, msg)}\n`);
}

export function error(msg: string): void {
  werr(`  ${co(C.red, '✗')}  ${co(C.red, msg)}\n`);
}

export function hint(msg: string): void {
  write(co(C.gray, `     ${msg}`) + '\n');
}

// ─── Section headers ──────────────────────────────────────────────────────────

export function header(title: string): void {
  const barLen = Math.max(0, 44 - title.length - 2);
  write('\n' + co(C.orange, `  ${title} ${'─'.repeat(barLen)}`) + '\n\n');
}

export function divider(): void {
  write(co(C.gray, '  ' + '─'.repeat(42)) + '\n');
}

// ─── Key/value label row ──────────────────────────────────────────────────────

export function label(key: string, value: string): void {
  const k = (key + ':').padEnd(14);
  write(`  ${co(C.gray, k)} ${co(C.white, value)}\n`);
}

// ─── Status check row  ✔ / ✗ / ↑ / ⚠ / ○ ────────────────────────────────────

export type CheckStatus = 'ok' | 'error' | 'update' | 'warn' | 'off';

export function statusRow(key: string, value: string, status: CheckStatus): void {
  const icons: Record<CheckStatus, string> = {
    ok:     co(C.green,  '✔'),
    error:  co(C.red,    '✗'),
    update: co(C.amber,  '↑'),
    warn:   co(C.amber,  '⚠'),
    off:    co(C.gray,   '○'),
  };
  const icon = icons[status] ?? icons.off;
  const k    = (key + ':').padEnd(14);
  write(`  ${icon}  ${co(C.gray, k)} ${co(C.white, value)}\n`);
}

// ─── Columnar table ───────────────────────────────────────────────────────────

export function table(rows: string[][], headers?: string[]): void {
  const all = headers ? [headers, ...rows] : rows;
  if (!all.length || !all[0].length) return;

  const widths = all[0].map((_, ci) =>
    Math.max(...all.map(r => strip(r[ci] ?? '').length)),
  );

  if (headers) {
    const hRow = headers.map((h, i) => co(C.orange, h.padEnd(widths[i]))).join('   ');
    write('  ' + hRow + '\n');
    write(co(C.gray, '  ' + widths.map(w => '─'.repeat(w)).join('   ')) + '\n');
  }

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const vis = strip(cell);
      const pad = ' '.repeat(Math.max(0, widths[i] - vis.length));
      return cell + pad;
    }).join('   ');
    write('  ' + line + '\n');
  }
}

// ─── Update step (for multi-step operations like `prometheus update`) ─────────

export function step(label: string, ok: boolean): void {
  const icon = ok ? co(C.green, '✔') : co(C.red, '✗');
  write(`  ${icon}  ${co(ok ? C.white : C.red, label)}\n`);
}

export function stepRunning(label: string): void {
  write(`  ${co(C.amber, '…')}  ${co(C.gray, label)}\n`);
}

// ─── Blank line ───────────────────────────────────────────────────────────────

export function blank(): void {
  write('\n');
}
