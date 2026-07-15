import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip, gunzipSync, gzipSync } from 'zlib';
import type { JsonValue } from './types.js';

const BLOB_MAGIC = 'PROMETHEUS_TURN_BLOB_V1\n';
const BLOB_REF_PATTERN = /^turnblob:sha256:([a-f0-9]{64})$/;
const MAX_HEADER_BYTES = 8 * 1024;
const ASYNC_JSON_YIELD_BUDGET = 256 * 1024;
const ASYNC_IO_CHUNK_BYTES = 256 * 1024;
const ASYNC_STRING_CHUNK_CODE_UNITS = 32 * 1024;
const ASYNC_TEXT_BUFFER_CODE_UNITS = 64 * 1024;
const STAGING_DIRECTORY_NAME = '.staging';

export type TurnBlobEncoding = 'identity' | 'gzip';

export interface TurnJobBlobDescriptor {
  ref: string;
  hash: string;
  sizeBytes: number;
  storedBytes: number;
  encoding: TurnBlobEncoding;
  contentType: string;
}

interface StoredBlobHeader {
  version: 1;
  hash: string;
  sizeBytes: number;
  storedBytes: number;
  encoding: TurnBlobEncoding;
  contentType: string;
}

export interface TurnJobBlobStoreOptions {
  maxBlobBytes?: number;
  compressionThresholdBytes?: number;
}

export interface PutTurnBlobOptions {
  contentType?: string;
  compress?: boolean;
}

function stableJsonValue(value: JsonValue): string {
  const seen = new Set<object>();
  const visit = (current: JsonValue): string => {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Turn-job JSON blobs cannot contain non-finite numbers');
      return JSON.stringify(current);
    }
    if (typeof current !== 'object') throw new TypeError('Turn-job JSON blobs must contain JSON-compatible values');
    if (seen.has(current)) throw new TypeError('Turn-job JSON blobs cannot contain cycles');
    seen.add(current);
    try {
      if (Array.isArray(current)) return `[${current.map((entry) => visit(entry)).join(',')}]`;
      const entries = Object.keys(current)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(current[key])}`);
      return `{${entries.join(',')}}`;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function boundedStringChunkEnd(value: string, start: number): number {
  let end = Math.min(value.length, start + ASYNC_STRING_CHUNK_CODE_UNITS);
  if (
    end < value.length
    && end > start
    && value.charCodeAt(end - 1) >= 0xd800
    && value.charCodeAt(end - 1) <= 0xdbff
    && value.charCodeAt(end) >= 0xdc00
    && value.charCodeAt(end) <= 0xdfff
  ) {
    // Buffer.from() and JSON.stringify() both preserve a valid surrogate pair.
    // Never split one across chunks, where each half would instead become a
    // replacement character or a pair of escaped lone surrogates.
    end += 1;
  }
  return end;
}

async function* quotedJsonStringPieces(value: string): AsyncGenerator<string> {
  yield '"';
  let budget = 0;
  for (let start = 0; start < value.length;) {
    const end = boundedStringChunkEnd(value, start);
    const encoded = JSON.stringify(value.slice(start, end));
    yield encoded.slice(1, -1);
    budget += encoded.length;
    start = end;
    if (budget >= ASYNC_JSON_YIELD_BUDGET) {
      budget = 0;
      await yieldToEventLoop();
    }
  }
  yield '"';
}

/**
 * Emit canonical JSON incrementally. In particular, a single multi-megabyte
 * string is escaped in bounded pieces instead of entering JSON.stringify() as
 * one giant allocation. Piece boundaries are syntax-neutral, so the byte stream
 * remains identical to stableJsonValue() and therefore retains the same ref.
 */
async function* stableJsonValuePieces(value: JsonValue): AsyncGenerator<string> {
  const seen = new Set<object>();
  const visit = async function* (current: JsonValue): AsyncGenerator<string> {
    if (current === null) {
      yield 'null';
      return;
    }
    if (typeof current === 'string') {
      yield* quotedJsonStringPieces(current);
      return;
    }
    if (typeof current === 'boolean') {
      yield current ? 'true' : 'false';
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Turn-job JSON blobs cannot contain non-finite numbers');
      yield JSON.stringify(current);
      return;
    }
    if (typeof current !== 'object') throw new TypeError('Turn-job JSON blobs must contain JSON-compatible values');
    if (seen.has(current)) throw new TypeError('Turn-job JSON blobs cannot contain cycles');
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        yield '[';
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) yield ',';
          yield* visit(current[index]);
        }
        yield ']';
        return;
      }
      yield '{';
      const keys = Object.keys(current).sort();
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) yield ',';
        const key = keys[index];
        yield* quotedJsonStringPieces(key);
        yield ':';
        yield* visit(current[key]);
      }
      yield '}';
    } finally {
      seen.delete(current);
    }
  };
  yield* visit(value);
}

async function* utf8BuffersFromPieces(pieces: AsyncIterable<string>): AsyncGenerator<Buffer> {
  let pending: string[] = [];
  let pendingCodeUnits = 0;
  let pieceBudget = 0;
  const flush = (): Buffer | null => {
    if (pending.length === 0) return null;
    // This join is deliberately bounded. It coalesces punctuation and small
    // scalar values without ever joining a complete model request or final.
    const buffer = Buffer.from(pending.join(''), 'utf8');
    pending = [];
    pendingCodeUnits = 0;
    return buffer;
  };
  for await (const piece of pieces) {
    pieceBudget += 1;
    if (pendingCodeUnits > 0 && pendingCodeUnits + piece.length > ASYNC_TEXT_BUFFER_CODE_UNITS) {
      const buffer = flush();
      if (buffer) yield buffer;
    }
    if (piece.length >= ASYNC_TEXT_BUFFER_CODE_UNITS) {
      yield Buffer.from(piece, 'utf8');
    } else {
      pending.push(piece);
      pendingCodeUnits += piece.length;
    }
    // Large arrays/objects can contain thousands of tiny syntax pieces before
    // reaching the byte budget. Yield by item count too so microtasks do not
    // starve socket and heartbeat macrotasks.
    if (pieceBudget >= 2_048) {
      pieceBudget = 0;
      await yieldToEventLoop();
    }
  }
  const buffer = flush();
  if (buffer) yield buffer;
}

async function* utf8StringBuffers(value: string): AsyncGenerator<Buffer> {
  let budget = 0;
  for (let start = 0; start < value.length;) {
    const end = boundedStringChunkEnd(value, start);
    const buffer = Buffer.from(value.slice(start, end), 'utf8');
    yield buffer;
    budget += buffer.byteLength;
    start = end;
    if (budget >= ASYNC_JSON_YIELD_BUDGET) {
      budget = 0;
      await yieldToEventLoop();
    }
  }
}

async function* copiedBufferChunks(value: Uint8Array): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < value.byteLength; offset += ASYNC_IO_CHUNK_BYTES) {
    const end = Math.min(value.byteLength, offset + ASYNC_IO_CHUNK_BYTES);
    // Copy only one bounded slice before yielding. This prevents caller mutation
    // from changing a chunk after its hash has been computed and avoids the old
    // full-size Buffer.from(Uint8Array) allocation cliff.
    yield Buffer.from(value.subarray(offset, end));
    await yieldToEventLoop();
  }
}

async function* copiedIterableChunks(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  for await (const source of chunks) {
    for (let offset = 0; offset < source.byteLength; offset += ASYNC_IO_CHUNK_BYTES) {
      const end = Math.min(source.byteLength, offset + ASYNC_IO_CHUNK_BYTES);
      yield Buffer.from(source.subarray(offset, end));
      await yieldToEventLoop();
    }
  }
}

async function writeAll(handle: fs.promises.FileHandle, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
    if (bytesWritten <= 0) throw new Error('Turn-job blob write made no progress');
    offset += bytesWritten;
  }
}

function boundedPositiveInteger(value: number | undefined, fallback: number, minimum: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum) {
    throw new RangeError(`Expected an integer greater than or equal to ${minimum}`);
  }
  return candidate;
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Immutable, content-addressed storage for turn inputs, checkpoints, and large
 * results. Each blob is one atomically-renamed file containing a bounded header
 * and either the original bytes or a gzip payload.
 */
export class TurnJobBlobStore {
  readonly rootDir: string;
  readonly maxBlobBytes: number;
  readonly compressionThresholdBytes: number;

  constructor(rootDir: string, options: TurnJobBlobStoreOptions = {}) {
    this.rootDir = path.resolve(rootDir);
    this.maxBlobBytes = boundedPositiveInteger(options.maxBlobBytes, 64 * 1024 * 1024, 1);
    this.compressionThresholdBytes = boundedPositiveInteger(
      options.compressionThresholdBytes,
      16 * 1024,
      0,
    );
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  putJson(value: JsonValue, options: Omit<PutTurnBlobOptions, 'contentType'> = {}): TurnJobBlobDescriptor {
    return this.putBuffer(Buffer.from(stableJsonValue(value), 'utf8'), {
      ...options,
      contentType: 'application/json; charset=utf-8',
    });
  }

  async putJsonAsync(value: JsonValue, options: Omit<PutTurnBlobOptions, 'contentType'> = {}): Promise<TurnJobBlobDescriptor> {
    return this.putChunksAsync(utf8BuffersFromPieces(stableJsonValuePieces(value)), {
      ...options,
      contentType: 'application/json; charset=utf-8',
    });
  }

  putText(value: string, options: Omit<PutTurnBlobOptions, 'contentType'> = {}): TurnJobBlobDescriptor {
    return this.putBuffer(Buffer.from(value, 'utf8'), {
      ...options,
      contentType: 'text/plain; charset=utf-8',
    });
  }

  async putTextAsync(value: string, options: Omit<PutTurnBlobOptions, 'contentType'> = {}): Promise<TurnJobBlobDescriptor> {
    return this.putChunksAsync(utf8StringBuffers(value), {
      ...options,
      contentType: 'text/plain; charset=utf-8',
    });
  }

  putBuffer(value: Uint8Array, options: PutTurnBlobOptions = {}): TurnJobBlobDescriptor {
    const original = Buffer.from(value);
    if (original.byteLength > this.maxBlobBytes) {
      throw new RangeError(`Turn-job blob exceeds ${this.maxBlobBytes} byte limit`);
    }

    const hash = createHash('sha256').update(original).digest('hex');
    const ref = `turnblob:sha256:${hash}`;
    const targetPath = this.pathForHash(hash);
    if (fs.existsSync(targetPath)) {
      try {
        // The atomically-created immutable envelope is validated from its
        // bounded header and file length. Reuse must not reread, decompress,
        // and rehash a multi-megabyte body on the gateway event loop.
        return this.readDescriptor(ref);
      } catch (error) {
        // A retention worker can remove an unreferenced old file between the
        // existence check and validation. Re-create the same immutable content.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    let encoding: TurnBlobEncoding = 'identity';
    let body = original;
    if (options.compress !== false && original.byteLength >= this.compressionThresholdBytes) {
      const compressed = gzipSync(original, { level: 6 });
      if (compressed.byteLength < original.byteLength) {
        encoding = 'gzip';
        body = compressed;
      }
    }

    const contentType = String(options.contentType || 'application/octet-stream').slice(0, 256);
    const header: StoredBlobHeader = {
      version: 1,
      hash,
      sizeBytes: original.byteLength,
      storedBytes: body.byteLength,
      encoding,
      contentType,
    };
    const envelope = Buffer.concat([
      Buffer.from(BLOB_MAGIC, 'utf8'),
      Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'),
      body,
    ]);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    let handle: number | null = null;
    try {
      handle = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(handle, envelope);
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      try {
        fs.renameSync(temporaryPath, targetPath);
      } catch (error) {
        // Two gateway processes can race to write the same content hash. The
        // winner is valid because both files decode to the same original bytes.
        if (!fs.existsSync(targetPath)) throw error;
        safeUnlink(temporaryPath);
      }
    } catch (error) {
      if (handle !== null) fs.closeSync(handle);
      safeUnlink(temporaryPath);
      throw error;
    }

    return this.readDescriptor(ref);
  }

  async putBufferAsync(value: Uint8Array, options: PutTurnBlobOptions = {}): Promise<TurnJobBlobDescriptor> {
    if (value.byteLength > this.maxBlobBytes) {
      throw new RangeError(`Turn-job blob exceeds ${this.maxBlobBytes} byte limit`);
    }
    return this.putChunksAsync(copiedBufferChunks(value), options);
  }

  /**
   * Persist a byte stream without first materializing it as one Buffer. Every
   * caller-owned chunk is copied and capped before it reaches hashing or I/O.
   */
  async putChunkStreamAsync(
    chunks: AsyncIterable<Uint8Array>,
    options: PutTurnBlobOptions = {},
  ): Promise<TurnJobBlobDescriptor> {
    return this.putChunksAsync(copiedIterableChunks(chunks), options);
  }

  private async putChunksAsync(
    chunks: AsyncIterable<Buffer>,
    options: PutTurnBlobOptions,
  ): Promise<TurnJobBlobDescriptor> {
    const stagingDir = path.join(this.rootDir, STAGING_DIRECTORY_NAME);
    await fs.promises.mkdir(stagingDir, { recursive: true });
    const stagingId = `${process.pid}.${randomBytes(8).toString('hex')}`;
    const rawPath = path.join(stagingDir, `${stagingId}.raw.tmp`);
    const gzipPath = path.join(stagingDir, `${stagingId}.gzip.tmp`);
    let rawHandle: fs.promises.FileHandle | null = null;
    let finalTemporaryPath: string | null = null;
    try {
      rawHandle = await fs.promises.open(rawPath, 'wx', 0o600);
      const hashState = createHash('sha256');
      let sizeBytes = 0;
      let yieldBudget = 0;
      for await (const chunk of chunks) {
        if (chunk.byteLength === 0) continue;
        sizeBytes += chunk.byteLength;
        if (sizeBytes > this.maxBlobBytes) {
          throw new RangeError(`Turn-job blob exceeds ${this.maxBlobBytes} byte limit`);
        }
        // update() is synchronous, but each update is bounded by the chunk
        // producers above instead of scanning an entire 64 MiB payload at once.
        hashState.update(chunk);
        await writeAll(rawHandle, chunk);
        yieldBudget += chunk.byteLength;
        if (yieldBudget >= ASYNC_IO_CHUNK_BYTES) {
          yieldBudget = 0;
          await yieldToEventLoop();
        }
      }
      await rawHandle.close();
      rawHandle = null;

      const hash = hashState.digest('hex');
      const ref = `turnblob:sha256:${hash}`;
      const targetPath = this.pathForHash(hash);
      try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
        return this.readDescriptor(ref);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      let encoding: TurnBlobEncoding = 'identity';
      let bodyPath = rawPath;
      let storedBytes = sizeBytes;
      if (options.compress !== false && sizeBytes >= this.compressionThresholdBytes) {
        try {
          await pipeline(
            fs.createReadStream(rawPath, { highWaterMark: ASYNC_IO_CHUNK_BYTES }),
            createGzip({ level: 6 }),
            fs.createWriteStream(gzipPath, { flags: 'wx', mode: 0o600, highWaterMark: ASYNC_IO_CHUNK_BYTES }),
          );
          const compressedStat = await fs.promises.stat(gzipPath);
          if (compressedStat.size < sizeBytes) {
            encoding = 'gzip';
            bodyPath = gzipPath;
            storedBytes = compressedStat.size;
          }
        } catch (error) {
          await fs.promises.unlink(gzipPath).catch(() => undefined);
          throw error;
        }
      }

      const contentType = String(options.contentType || 'application/octet-stream').slice(0, 256);
      const header: StoredBlobHeader = {
        version: 1,
        hash,
        sizeBytes,
        storedBytes,
        encoding,
        contentType,
      };
      const magicBytes = Buffer.from(BLOB_MAGIC, 'utf8');
      const headerBytes = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
      if (headerBytes.byteLength > MAX_HEADER_BYTES) throw new Error('Turn-job blob header exceeds its configured bound');

      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      finalTemporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      let outputHandle: fs.promises.FileHandle | null = null;
      let inputHandle: fs.promises.FileHandle | null = null;
      try {
        outputHandle = await fs.promises.open(finalTemporaryPath, 'wx', 0o600);
        await writeAll(outputHandle, magicBytes);
        await writeAll(outputHandle, headerBytes);

        inputHandle = await fs.promises.open(bodyPath, 'r');
        const copyBuffer = Buffer.allocUnsafe(ASYNC_IO_CHUNK_BYTES);
        let inputPosition = 0;
        while (inputPosition < storedBytes) {
          const toRead = Math.min(copyBuffer.byteLength, storedBytes - inputPosition);
          const { bytesRead } = await inputHandle.read(copyBuffer, 0, toRead, inputPosition);
          if (bytesRead <= 0) throw new Error('Turn-job blob staging body ended unexpectedly');
          await writeAll(outputHandle, copyBuffer.subarray(0, bytesRead));
          inputPosition += bytesRead;
          await yieldToEventLoop();
        }
        await inputHandle.close();
        inputHandle = null;

        // Only the complete immutable envelope is fsynced. Intermediate staging
        // files are disposable and never become addressable by a turnblob ref.
        await outputHandle.sync();
        await outputHandle.close();
        outputHandle = null;
      } catch (error) {
        if (inputHandle) await inputHandle.close().catch(() => undefined);
        if (outputHandle) await outputHandle.close().catch(() => undefined);
        throw error;
      }

      try {
        await fs.promises.rename(finalTemporaryPath, targetPath);
        finalTemporaryPath = null;
      } catch (renameError) {
        // Concurrent gateways can finish the same content-addressed blob at the
        // same time. Discard our complete temp only after validating the winner.
        try {
          const existing = this.readDescriptor(ref);
          const losingTemporaryPath = finalTemporaryPath;
          if (losingTemporaryPath) await fs.promises.unlink(losingTemporaryPath).catch(() => undefined);
          finalTemporaryPath = null;
          return existing;
        } catch (existingError) {
          if ((existingError as NodeJS.ErrnoException).code === 'ENOENT') throw renameError;
          throw existingError;
        }
      }

      return this.readDescriptor(ref);
    } finally {
      if (rawHandle) await rawHandle.close().catch(() => undefined);
      await fs.promises.unlink(rawPath).catch(() => undefined);
      await fs.promises.unlink(gzipPath).catch(() => undefined);
      if (finalTemporaryPath) await fs.promises.unlink(finalTemporaryPath).catch(() => undefined);
    }
  }

  has(ref: string): boolean {
    const filePath = this.pathForRef(ref);
    if (!fs.existsSync(filePath)) return false;
    try {
      this.refreshFileMtime(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  getBuffer(ref: string): Buffer {
    const { header, body } = this.readEnvelope(ref);
    const decoded = header.encoding === 'gzip'
      ? gunzipSync(body, { maxOutputLength: this.maxBlobBytes })
      : body;
    if (decoded.byteLength !== header.sizeBytes) {
      throw new Error(`Turn-job blob ${ref} has an invalid decoded length`);
    }
    const actualHash = createHash('sha256').update(decoded).digest('hex');
    if (actualHash !== header.hash) throw new Error(`Turn-job blob ${ref} failed its content hash check`);
    return decoded;
  }

  getText(ref: string): string {
    return this.getBuffer(ref).toString('utf8');
  }

  getJson<T = JsonValue>(ref: string): T {
    return JSON.parse(this.getText(ref)) as T;
  }

  readDescriptor(ref: string): TurnJobBlobDescriptor {
    const { header } = this.readStoredHeader(ref);
    return {
      ref,
      hash: header.hash,
      sizeBytes: header.sizeBytes,
      storedBytes: header.storedBytes,
      encoding: header.encoding,
      contentType: header.contentType,
    };
  }

  private pathForRef(ref: string): string {
    const match = BLOB_REF_PATTERN.exec(ref);
    if (!match) throw new TypeError(`Invalid turn-job blob reference: ${ref}`);
    return this.pathForHash(match[1]);
  }

  private pathForHash(hash: string): string {
    return path.join(this.rootDir, hash.slice(0, 2), `${hash}.turnblob`);
  }

  private readEnvelope(ref: string): { header: StoredBlobHeader; body: Buffer } {
    const { filePath, header, bodyOffset } = this.readStoredHeader(ref);
    const envelope = fs.readFileSync(filePath);
    const body = envelope.subarray(bodyOffset);
    return { header, body };
  }

  private readStoredHeader(ref: string): { filePath: string; header: StoredBlobHeader; bodyOffset: number } {
    const filePath = this.pathForRef(ref);
    // Blob retention uses mtime as a conservative second safety boundary. A
    // successful read/reuse starts that clock again, while the GC re-stats a
    // candidate immediately before unlinking to detect a concurrent touch.
    this.refreshFileMtime(filePath);
    const stat = fs.statSync(filePath);
    if (stat.size > this.maxBlobBytes + MAX_HEADER_BYTES) {
      throw new RangeError(`Stored turn-job blob ${ref} exceeds its configured bound`);
    }
    const magic = Buffer.from(BLOB_MAGIC, 'utf8');
    const prefix = Buffer.allocUnsafe(Math.min(stat.size, magic.byteLength + MAX_HEADER_BYTES + 1));
    const handle = fs.openSync(filePath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(handle, prefix, 0, prefix.byteLength, 0);
    } finally {
      fs.closeSync(handle);
    }
    const envelopePrefix = prefix.subarray(0, bytesRead);
    if (envelopePrefix.byteLength < magic.byteLength || !envelopePrefix.subarray(0, magic.byteLength).equals(magic)) {
      throw new Error(`Turn-job blob ${ref} has an invalid format`);
    }
    const headerEnd = envelopePrefix.indexOf(0x0a, magic.byteLength);
    if (headerEnd < 0 || headerEnd - magic.byteLength > MAX_HEADER_BYTES) {
      throw new Error(`Turn-job blob ${ref} has an invalid header`);
    }
    const header = JSON.parse(envelopePrefix.subarray(magic.byteLength, headerEnd).toString('utf8')) as StoredBlobHeader;
    const bodyOffset = headerEnd + 1;
    const expectedHash = BLOB_REF_PATTERN.exec(ref)?.[1];
    if (
      header.version !== 1
      || header.hash !== expectedHash
      || !Number.isSafeInteger(header.sizeBytes)
      || header.sizeBytes < 0
      || header.sizeBytes > this.maxBlobBytes
      || !Number.isSafeInteger(header.storedBytes)
      || header.storedBytes < 0
      || header.storedBytes !== stat.size - bodyOffset
      || (header.encoding !== 'identity' && header.encoding !== 'gzip')
      || typeof header.contentType !== 'string'
    ) {
      throw new Error(`Turn-job blob ${ref} has invalid metadata`);
    }
    if (header.encoding === 'identity' && header.sizeBytes !== header.storedBytes) {
      throw new Error(`Turn-job blob ${ref} has an invalid identity payload`);
    }
    return { filePath, header, bodyOffset };
  }

  private refreshFileMtime(filePath: string): void {
    const now = new Date();
    try {
      fs.utimesSync(filePath, now, now);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Read-only files cannot be collected either, so allowing their reads is
      // safe. Missing files must remain observable to callers for retry/rewrite.
      if (code === 'EPERM' || code === 'EACCES' || code === 'EROFS') return;
      throw error;
    }
  }
}
