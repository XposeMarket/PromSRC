'use strict';

// Desktop gateway log (<userData>/gateway.log).
//
// Electron writes its own [main] lines here and pipes the gateway supervisor's
// stdout/stderr in. Two guarantees:
//   1. Every line starts with an ISO-8601 UTC timestamp. Supervisor output
//      arrives in arbitrary chunks, so lines are reassembled per source before
//      stamping; a stamp never lands mid-line and two sources never merge.
//   2. The file rotates by size: gateway.log -> gateway.log.1 -> ... -> .N,
//      oldest dropped. Defaults 20 MB x (1 live + 3 archives), overridable with
//      PROMETHEUS_GATEWAY_LOG_MAX_MB and PROMETHEUS_GATEWAY_LOG_KEEP.
// An oversized legacy log found at open is rotated out, and any archive far over
// the cap is trimmed to its newest lines in the background so an old multi-
// hundred-MB file does not linger.

const fs = require('fs');
const path = require('path');

const MB = 1024 * 1024;
const DEFAULT_MAX_MB = 20;
const DEFAULT_KEEP = 3;
const PARTIAL_FLUSH_MS = 500;
const MAX_PARTIAL_CHARS = 64 * 1024;
const MAX_PRE_OPEN_WRITES = 500;
const ROTATE_CLOSE_TIMEOUT_MS = 2000;

function formatSize(bytes) {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function readPositiveIntEnv(env, name, fallback) {
  const raw = env && env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolveGatewayLogLimits(env = process.env) {
  return {
    maxBytes: readPositiveIntEnv(env, 'PROMETHEUS_GATEWAY_LOG_MAX_MB', DEFAULT_MAX_MB) * MB,
    keep: readPositiveIntEnv(env, 'PROMETHEUS_GATEWAY_LOG_KEEP', DEFAULT_KEEP),
  };
}

function createGatewayLog(options = {}) {
  const filePath = options.filePath;
  if (!filePath) throw new Error('createGatewayLog: filePath is required');
  const limits = resolveGatewayLogLimits(options.env || process.env);
  const maxBytes = Math.max(1, Math.floor(options.maxBytes || limits.maxBytes));
  const keep = Math.max(1, Math.floor(options.keep || limits.keep));
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const warn = typeof options.warn === 'function'
    ? options.warn
    : (message) => { try { console.warn(`[Prometheus] ${message}`); } catch {} };
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  const partialFlushMs = options.partialFlushMs ?? PARTIAL_FLUSH_MS;

  let stream = null;
  let opened = false;
  let bytes = 0;
  let rotateAt = maxBytes;
  let rotating = false;
  let rotations = 0;
  let pending = [];
  let preOpen = [];
  let trimRunning = null;
  const sources = new Map();

  const archivePath = (index) => `${filePath}.${index}`;

  function stamp(at) {
    try { return at.toISOString(); } catch { return new Date().toISOString(); }
  }

  function formatLine(line, at) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!clean.trim()) return '\n';
    if (onLine) { try { onLine(clean); } catch {} }
    return `${stamp(at)} ${clean}\n`;
  }

  // Move gateway.log to .1 and shift older archives up, dropping the oldest.
  // Throws when the live file cannot be moved (for example, locked by another
  // program on Windows); the caller keeps appending and retries later.
  function shiftArchivesSync() {
    try { fs.rmSync(archivePath(keep), { force: true }); } catch {}
    for (let index = keep - 1; index >= 1; index -= 1) {
      const from = archivePath(index);
      if (!fs.existsSync(from)) continue;
      try { fs.renameSync(from, archivePath(index + 1)); } catch {}
    }
    if (fs.existsSync(filePath)) fs.renameSync(filePath, archivePath(1));
  }

  async function trimFileToTail(target, limit) {
    let handle = null;
    const temp = `${target}.trim-${process.pid}.tmp`;
    try {
      const stat = await fs.promises.stat(target);
      if (stat.size <= limit * 2) return false;
      handle = await fs.promises.open(target, 'r');
      const buffer = Buffer.alloc(limit);
      const { bytesRead } = await handle.read(buffer, 0, limit, stat.size - limit);
      await handle.close();
      handle = null;
      let start = buffer.indexOf(0x0a, 0);
      start = start >= 0 && start < bytesRead - 1 ? start + 1 : 0;
      const header = Buffer.from(`${stamp(now())} [main] gateway.log archive trimmed to its newest ${formatSize(limit)} (was ${formatSize(stat.size)})\n`);
      await fs.promises.writeFile(temp, Buffer.concat([header, buffer.subarray(start, bytesRead)]));
      await fs.promises.rename(temp, target);
      return true;
    } catch (err) {
      if (handle) { try { await handle.close(); } catch {} }
      try { await fs.promises.rm(temp, { force: true }); } catch {}
      if (err && err.code !== 'ENOENT') warn(`Could not trim gateway log archive ${path.basename(target)}: ${err.message || err}`);
      return false;
    }
  }

  // Archives far over the cap only come from logs written before rotation
  // existed. Trim them off the startup path.
  function scheduleArchiveTrim() {
    if (trimRunning) return trimRunning;
    trimRunning = (async () => {
      for (let index = 1; index <= keep; index += 1) {
        await trimFileToTail(archivePath(index), maxBytes);
      }
    })().finally(() => { trimRunning = null; });
    return trimRunning;
  }

  function openStream(size) {
    const next = fs.createWriteStream(filePath, { flags: 'a' });
    next.on('error', (err) => {
      if (err?.code !== 'EPIPE') warn(`Gateway log stream error: ${err?.message || err}`);
    });
    stream = next;
    bytes = size;
    rotateAt = maxBytes;
  }

  function writeRaw(text) {
    if (!text) return;
    if (!opened) {
      if (preOpen.length < MAX_PRE_OPEN_WRITES) preOpen.push(text);
      return;
    }
    if (rotating) {
      pending.push(text);
      return;
    }
    if (!stream) return;
    try { stream.write(text); } catch { return; }
    bytes += Buffer.byteLength(text);
    if (bytes >= rotateAt) rotate();
  }

  function rotate() {
    if (rotating || !stream) return;
    rotating = true;
    const previous = stream;
    stream = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      let size = 0;
      let moved = false;
      try {
        shiftArchivesSync();
        moved = true;
        rotations += 1;
      } catch (err) {
        warn(`Gateway log rotation failed (${err?.code || err?.message || err}); will retry`);
        try { size = fs.statSync(filePath).size; } catch {}
      }
      try { openStream(size); } catch (err) { warn(`Could not reopen gateway log: ${err?.message || err}`); }
      if (moved) scheduleArchiveTrim();
      else rotateAt = size + Math.max(MB, Math.floor(maxBytes / 4));
      rotating = false;
      const queued = pending;
      pending = [];
      for (const text of queued) writeRaw(text);
    };
    // The file must be closed before it can be renamed on Windows.
    const timer = setTimeout(finish, ROTATE_CLOSE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    previous.once('close', finish);
    try { previous.end(); } catch { finish(); }
  }

  function open() {
    if (stream) {
      const previous = stream;
      stream = null;
      try { previous.end(); } catch {}
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch {}
      if (size >= maxBytes) {
        try {
          shiftArchivesSync();
          rotations += 1;
          size = 0;
          scheduleArchiveTrim();
        } catch (err) {
          warn(`Gateway log rotation at open failed (${err?.code || err?.message || err}); appending`);
        }
      }
      openStream(size);
      if (size > 0 && size >= maxBytes) rotateAt = size + Math.max(MB, Math.floor(maxBytes / 4));
    } catch (err) {
      warn(`Could not open gateway log: ${err?.message || err}`);
    }
    opened = true;
    const early = preOpen;
    preOpen = [];
    for (const text of early) writeRaw(text);
  }

  function sourceState(source) {
    let state = sources.get(source);
    if (!state) {
      state = { partial: '', startedAt: null, timer: null };
      sources.set(source, state);
    }
    return state;
  }

  function flushSource(source) {
    const state = sources.get(source);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.partial) {
      const line = state.partial;
      const at = state.startedAt || now();
      state.partial = '';
      state.startedAt = null;
      writeRaw(formatLine(line, at));
    }
    sources.delete(source);
  }

  function write(data, source = 'main') {
    const text = String(data ?? '');
    if (!text) return;
    const state = sourceState(source);
    const at = now();
    const parts = text.split('\n');
    const tail = parts.pop();
    let out = '';
    for (let index = 0; index < parts.length; index += 1) {
      let line = parts[index];
      let lineAt = at;
      if (index === 0 && state.partial) {
        line = state.partial + line;
        lineAt = state.startedAt || at;
        state.partial = '';
        state.startedAt = null;
      }
      out += formatLine(line, lineAt);
    }
    if (tail) {
      if (!state.partial) state.startedAt = at;
      state.partial += tail;
    }
    if (out) writeRaw(out);
    if (state.partial.length > MAX_PARTIAL_CHARS) {
      flushSource(source);
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.partial) {
      // A prompt or progress line without a newline still shows up promptly.
      state.timer = setTimeout(() => flushSource(source), partialFlushMs);
      if (typeof state.timer.unref === 'function') state.timer.unref();
    } else {
      sources.delete(source);
    }
  }

  function flush(source) {
    if (source != null) {
      flushSource(source);
      return;
    }
    for (const key of [...sources.keys()]) flushSource(key);
  }

  return {
    path: filePath,
    maxBytes,
    keep,
    open,
    write,
    flush,
    archivePath,
    rotateNow: rotate,
    // Test/diagnostic helper: resolves once no rotation, trim or queued write
    // is outstanding (bounded so it can never hang a caller).
    whenIdle: async (timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (trimRunning) { await trimRunning; continue; }
        if (!rotating && pending.length === 0 && (!stream || stream.writableLength === 0)) return true;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return false;
    },
    close: () => new Promise((resolve) => {
      flush();
      const current = stream;
      stream = null;
      opened = false;
      if (!current) { resolve(); return; }
      current.once('close', resolve);
      try { current.end(); } catch { resolve(); }
    }),
    stats: () => ({ bytes, rotateAt, rotations, rotating, opened }),
  };
}

module.exports = {
  createGatewayLog,
  resolveGatewayLogLimits,
  DEFAULT_MAX_MB,
  DEFAULT_KEEP,
};
