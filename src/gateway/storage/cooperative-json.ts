import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface CooperativeJsonWriteOptions {
  spaces?: number;
  mode?: number;
  flushChars?: number;
  maxBytes?: number;
  shouldCommit?: () => boolean;
}

export interface CooperativeJsonWriteResult {
  committed: boolean;
  bytesWritten: number;
}

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function isOmittedJsonValue(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/**
 * Atomically persist JSON without one monolithic JSON.stringify/writeFile on
 * the gateway event loop. Serialization yields after bounded chunks and file
 * writes use the asynchronous fs API. The target is replaced only after the
 * complete temporary file has been fsynced.
 */
export async function writeJsonAtomicCooperatively(
  filePath: string,
  value: unknown,
  options: CooperativeJsonWriteOptions = {},
): Promise<CooperativeJsonWriteResult> {
  const target = path.resolve(filePath);
  const spaces = Math.max(0, Math.min(10, Math.floor(Number(options.spaces ?? 0))));
  const indentUnit = spaces > 0 ? ' '.repeat(spaces) : '';
  const flushChars = Math.max(16 * 1024, Math.floor(Number(options.flushChars || 256 * 1024)));
  const maxBytes = Number.isFinite(Number(options.maxBytes))
    ? Math.max(1, Math.floor(Number(options.maxBytes)))
    : Number.POSITIVE_INFINITY;
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const seen = new WeakSet<object>();
  let handle: fs.promises.FileHandle | null = null;
  let pending = '';
  let bytesWritten = 0;

  const flush = async (force = false): Promise<void> => {
    if (!pending || (!force && pending.length < flushChars)) return;
    const chunk = pending;
    pending = '';
    const buffer = Buffer.from(chunk, 'utf8');
    if (bytesWritten + buffer.byteLength > maxBytes) {
      throw new RangeError(`Cooperative JSON output exceeded its ${maxBytes}-byte limit.`);
    }
    await handle!.write(buffer, 0, buffer.byteLength, null);
    bytesWritten += buffer.byteLength;
    await immediate();
  };
  const emit = async (text: string): Promise<void> => {
    pending += text;
    await flush(false);
  };
  const emitJsonString = async (value: string): Promise<void> => {
    await emit('"');
    const chunkChars = 64 * 1024;
    for (let start = 0; start < value.length;) {
      let end = Math.min(value.length, start + chunkChars);
      if (end < value.length) {
        const finalCode = value.charCodeAt(end - 1);
        if (finalCode >= 0xd800 && finalCode <= 0xdbff) end += 1;
      }
      const encoded = JSON.stringify(value.slice(start, end));
      await emit(encoded.slice(1, -1));
      start = end;
    }
    await emit('"');
  };
  const newline = async (depth: number): Promise<void> => {
    if (!indentUnit) return;
    await emit(`\n${indentUnit.repeat(depth)}`);
  };

  const prepare = (current: unknown, key: string): unknown => {
    if (current && typeof current === 'object' && typeof (current as any).toJSON === 'function') {
      return (current as any).toJSON(key);
    }
    return current;
  };

  const serialize = async (raw: unknown, depth: number, key: string, inArray: boolean): Promise<boolean> => {
    const current = prepare(raw, key);
    if (isOmittedJsonValue(current)) {
      if (inArray) {
        await emit('null');
        return true;
      }
      return false;
    }
    if (current === null) {
      await emit('null');
      return true;
    }
    if (typeof current === 'string' || typeof current === 'boolean') {
      if (typeof current === 'string') await emitJsonString(current);
      else await emit(JSON.stringify(current));
      return true;
    }
    if (typeof current === 'number') {
      await emit(Number.isFinite(current) ? String(current) : 'null');
      return true;
    }
    if (typeof current === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
    if (typeof current !== 'object') {
      await emit(JSON.stringify(String(current)));
      return true;
    }
    if (seen.has(current as object)) throw new TypeError('Converting circular structure to JSON');
    seen.add(current as object);
    try {
      if (Array.isArray(current)) {
        await emit('[');
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) await emit(',');
          await newline(depth + 1);
          await serialize(current[index], depth + 1, String(index), true);
        }
        if (current.length > 0) await newline(depth);
        await emit(']');
        return true;
      }

      await emit('{');
      let written = 0;
      for (const property of Object.keys(current as Record<string, unknown>)) {
        const prepared = prepare((current as Record<string, unknown>)[property], property);
        if (isOmittedJsonValue(prepared)) continue;
        if (written > 0) await emit(',');
        await newline(depth + 1);
        await emitJsonString(property);
        await emit(indentUnit ? ': ' : ':');
        await serialize(prepared, depth + 1, property, false);
        written += 1;
      }
      if (written > 0) await newline(depth);
      await emit('}');
      return true;
    } finally {
      seen.delete(current as object);
    }
  };

  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    handle = await fs.promises.open(temporary, 'wx', options.mode ?? 0o600);
    const serialized = await serialize(value, 0, '', false);
    if (!serialized) await emit('null');
    await flush(true);
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.shouldCommit && !options.shouldCommit()) {
      await fs.promises.unlink(temporary).catch(() => undefined);
      return { committed: false, bytesWritten };
    }
    await fs.promises.rename(temporary, target);
    // Recheck after the atomic replace. A synchronous delete can race the
    // asynchronous rename after the first generation check; removing the stale
    // target here prevents an in-flight save from resurrecting deleted state.
    if (options.shouldCommit && !options.shouldCommit()) {
      await fs.promises.unlink(target).catch(() => undefined);
      return { committed: false, bytesWritten };
    }
    return { committed: true, bytesWritten };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.promises.unlink(temporary).catch(() => undefined);
    throw error;
  }
}
