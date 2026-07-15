export interface ReplayBufferRecord<T> {
  seq: number;
  at: number;
  data: T;
}

export interface ByteBoundedReplayBufferOptions {
  maxBytes: number;
  maxEntries?: number;
  initialSequence?: number;
}

export interface ReplayBufferStats {
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntries?: number;
  oldestSeq: number | null;
  latestSeq: number;
  droppedThroughSeq: number;
  nextSeq: number;
}

interface StoredRecord {
  seq: number;
  bytes: number;
  encoded: string;
}

/**
 * An exact UTF-8-byte-bounded replay ring. Records are held as immutable JSON
 * strings so caller mutation cannot corrupt byte accounting. Sequence numbers
 * remain monotonic across eviction and clear().
 */
export class ByteBoundedReplayBuffer<T> {
  private readonly maxBytes: number;
  private readonly maxEntries?: number;
  private readonly records: StoredRecord[] = [];
  private nextSequence: number;
  private byteCount = 0;
  private droppedThrough = 0;

  constructor(options: ByteBoundedReplayBufferOptions) {
    const maxBytes = Number(options?.maxBytes);
    if (!Number.isFinite(maxBytes) || maxBytes < 32) {
      throw new RangeError('Replay buffer maxBytes must be at least 32.');
    }
    const maxEntries = options?.maxEntries == null ? undefined : Number(options.maxEntries);
    if (maxEntries != null && (!Number.isFinite(maxEntries) || maxEntries < 1)) {
      throw new RangeError('Replay buffer maxEntries must be at least 1 when provided.');
    }
    const initialSequence = Math.max(1, Math.floor(Number(options?.initialSequence) || 1));
    this.maxBytes = Math.floor(maxBytes);
    this.maxEntries = maxEntries == null ? undefined : Math.floor(maxEntries);
    this.nextSequence = initialSequence;
    this.droppedThrough = initialSequence - 1;
  }

  append(data: T, at = Date.now()): ReplayBufferRecord<T> {
    const seq = this.nextSequence;
    const record: ReplayBufferRecord<T> = {
      seq,
      at: Number.isFinite(Number(at)) ? Math.floor(Number(at)) : Date.now(),
      data,
    };
    let encoded: string;
    try {
      encoded = JSON.stringify(record);
    } catch (error: any) {
      throw new TypeError(`Replay record is not JSON serializable: ${error?.message || error}`);
    }
    if (encoded === undefined) throw new TypeError('Replay record is not JSON serializable.');
    const bytes = Buffer.byteLength(encoded, 'utf8');
    if (bytes > this.maxBytes) {
      throw new RangeError(`Replay record is ${bytes} bytes, exceeding the ${this.maxBytes}-byte buffer limit.`);
    }

    this.nextSequence += 1;
    this.records.push({ seq, bytes, encoded });
    this.byteCount += bytes;
    this.evictToLimits();
    return decodeRecord<T>(encoded);
  }

  after(sequence: number, limit = Number.POSITIVE_INFINITY): ReplayBufferRecord<T>[] {
    const cursor = Number.isFinite(Number(sequence)) ? Math.floor(Number(sequence)) : 0;
    const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : Number.POSITIVE_INFINITY;
    if (count === 0) return [];
    return this.records
      .filter((record) => record.seq > cursor)
      .slice(0, count)
      .map((record) => decodeRecord<T>(record.encoded));
  }

  snapshot(): ReplayBufferRecord<T>[] {
    return this.records.map((record) => decodeRecord<T>(record.encoded));
  }

  clear(): void {
    const latest = this.nextSequence - 1;
    this.records.length = 0;
    this.byteCount = 0;
    this.droppedThrough = Math.max(this.droppedThrough, latest);
  }

  stats(): ReplayBufferStats {
    return {
      entries: this.records.length,
      bytes: this.byteCount,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      oldestSeq: this.records[0]?.seq ?? null,
      latestSeq: this.nextSequence - 1,
      droppedThroughSeq: this.droppedThrough,
      nextSeq: this.nextSequence,
    };
  }

  private evictToLimits(): void {
    while (this.records.length > 0 && (
      this.byteCount > this.maxBytes
      || (this.maxEntries != null && this.records.length > this.maxEntries)
    )) {
      const dropped = this.records.shift()!;
      this.byteCount = Math.max(0, this.byteCount - dropped.bytes);
      this.droppedThrough = Math.max(this.droppedThrough, dropped.seq);
    }
  }
}

function decodeRecord<T>(encoded: string): ReplayBufferRecord<T> {
  return JSON.parse(encoded) as ReplayBufferRecord<T>;
}
