import crypto from 'crypto';
import { truncateUtf8, truncateUtf8WithSuffix, utf8ByteLength } from './utf8';

export type TurnDeliveryClass = 'progress' | 'final' | 'done';
export type DeliveryReplacementKind = 'binary' | 'base64' | 'tool_result' | 'text' | 'structure' | 'cycle';

export interface TurnDeliveryLimits {
  progressBytes: number;
  finalBytes: number;
  doneBytes: number;
  maxStringBytes: number;
  maxToolResultBytes: number;
  maxInlineBinaryBytes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
  maxReplacementRecords: number;
  /** Hard cap on values inspected while sanitizing one transport frame. */
  maxVisitedValues: number;
  previewBytes: number;
}

export interface DeliveryReferenceCandidate {
  kind: Exclude<DeliveryReplacementKind, 'structure' | 'cycle'>;
  path: string;
  bytes: number;
  sha256: string;
  mediaType?: string;
  value: string | Buffer;
}

export type DeliveryReferenceFactory = (candidate: DeliveryReferenceCandidate) => string | null | undefined;
export type AsyncDeliveryReferenceFactory = (
  candidate: DeliveryReferenceCandidate,
) => Promise<string | null | undefined> | string | null | undefined;

export interface DeliveryReplacement {
  path: string;
  kind: DeliveryReplacementKind;
  bytes: number;
  sha256?: string;
  ref?: string;
  mediaType?: string;
  omittedItems?: number;
}

export interface BoundTurnDeliveryOptions {
  limits?: Partial<TurnDeliveryLimits>;
  /** Optional content/blob-store hook. The returned durable reference is placed in truncation metadata. */
  createReference?: DeliveryReferenceFactory;
}

export interface BoundTurnDeliveryAsyncOptions {
  limits?: Partial<TurnDeliveryLimits>;
  /** Async content/blob-store hook used by durable final materialization. */
  createReference?: AsyncDeliveryReferenceFactory;
}

export interface BoundedTurnDeliveryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  frame: Record<string, unknown>;
  data: T;
  type: string;
  deliveryClass: TurnDeliveryClass;
  limitBytes: number;
  bytes: number;
  changed: boolean;
  replacements: DeliveryReplacement[];
}

export const DEFAULT_TURN_DELIVERY_LIMITS: Readonly<TurnDeliveryLimits> = Object.freeze({
  progressBytes: 96 * 1024,
  finalBytes: 384 * 1024,
  doneBytes: 256 * 1024,
  maxStringBytes: 256 * 1024,
  maxToolResultBytes: 32 * 1024,
  maxInlineBinaryBytes: 24 * 1024,
  maxArrayItems: 256,
  maxObjectKeys: 256,
  maxDepth: 14,
  maxReplacementRecords: 32,
  maxVisitedValues: 8 * 1024,
  previewBytes: 2 * 1024,
});

const MAX_OBJECT_KEYS_SCANNED = 4 * 1024;

const MIN_FRAME_LIMIT_BYTES = 32;
const HEAVY_TOP_LEVEL_KEYS = [
  'results',
  'toolResults',
  'generatedImages',
  'generatedVideos',
  'artifacts',
  'richArtifacts',
  'productCarousel',
  'fileChanges',
  'canvasFiles',
  'thinking',
  'trace',
  'history',
  'messages',
  'output',
  'result',
] as const;
const CRITICAL_TOP_LEVEL_KEYS = new Set([
  'reply', 'text', 'message', 'mode', 'status', 'action', 'name', 'error',
  'sections', 'seq', 'streamId', 'at', 'clientRequestId', 'duplicate',
]);

interface SanitizeContext {
  type: string;
  deliveryClass: TurnDeliveryClass;
  limits: TurnDeliveryLimits;
  createReference?: DeliveryReferenceFactory;
  replacements: DeliveryReplacement[];
  changed: boolean;
  ancestors: Set<object>;
  visitedValues: number;
}

interface AsyncSanitizeContext extends Omit<SanitizeContext, 'createReference'> {
  createReference?: AsyncDeliveryReferenceFactory;
  nodesSinceYield: number;
}

const ASYNC_STRING_CHUNK_CODE_UNITS = 32 * 1024;
const ASYNC_BINARY_CHUNK_BYTES = 256 * 1024;
const ASYNC_NODE_YIELD_BUDGET = 128;
// Synchronous progress/SSE hooks cannot yield. Above this bound they emit a
// preview without an exact digest/ref; durable final materialization supplies
// canonical hashes and references through the async path.
const MAX_SYNC_STRING_CODE_UNITS = 256 * 1024;
const MAX_SYNC_BINARY_BYTES = 256 * 1024;
const MAX_TRANSPORT_OBJECT_KEY_CODE_UNITS = 512;

/** Exact byte size of the serialized JSON transport value. */
export function jsonUtf8Bytes(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return Buffer.byteLength(encoded === undefined ? '' : encoded, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function classifyTurnDeliveryEvent(type: string): TurnDeliveryClass {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'done') return 'done';
  if (normalized === 'final') return 'final';
  return 'progress';
}

/**
 * Prepare an SSE/WS turn frame for bounded delivery. Normal, in-budget payloads
 * keep the same JSON shape and values. Only oversized/cyclic/binary values are
 * summarized, and the returned serialized frame is guaranteed not to exceed
 * the selected event-class byte limit.
 */
export function boundTurnDeliveryFrame<T extends Record<string, unknown>>(
  typeInput: string,
  dataInput: T,
  options: BoundTurnDeliveryOptions = {},
): BoundedTurnDeliveryResult<T> {
  const type = String(typeInput || 'event');
  const deliveryClass = classifyTurnDeliveryEvent(type);
  const limits = resolveLimits(options.limits);
  const limitBytes = deliveryClass === 'done'
    ? limits.doneBytes
    : deliveryClass === 'final'
      ? limits.finalBytes
      : limits.progressBytes;
  if (limitBytes < MIN_FRAME_LIMIT_BYTES) {
    throw new RangeError(`Turn delivery frame limit must be at least ${MIN_FRAME_LIMIT_BYTES} bytes.`);
  }

  const context: SanitizeContext = {
    type,
    deliveryClass,
    limits,
    createReference: options.createReference,
    replacements: [],
    changed: false,
    ancestors: new Set<object>(),
    visitedValues: 0,
  };
  const root = dataInput && typeof dataInput === 'object' ? dataInput : ({} as T);
  const sanitized = sanitizeValue(root, '$', 0, context, false);
  let data = isRecord(sanitized) ? sanitized : {};
  let frame: Record<string, unknown> = { type, ...data };
  let bytes = jsonUtf8Bytes(frame);

  if (bytes > limitBytes) {
    context.changed = true;
    data = fitDataToLimit(type, data, limitBytes, context);
    frame = { type, ...data };
    bytes = jsonUtf8Bytes(frame);
  }

  // Last-resort invariant guard for unusual custom values or extremely long
  // event names. This path intentionally favors transport liveness.
  if (bytes > limitBytes) {
    const boundedType = truncateUtf8(type, Math.max(1, limitBytes - 16));
    frame = jsonUtf8Bytes({ type: boundedType }) <= limitBytes ? { type: boundedType } : {};
    data = {};
    bytes = jsonUtf8Bytes(frame);
    context.changed = true;
    recordReplacement(context, { path: '$', kind: 'structure', bytes: Number.isFinite(bytes) ? bytes : limitBytes });
  }

  return {
    frame,
    data: data as T,
    type: String(frame.type ?? type),
    deliveryClass,
    limitBytes,
    bytes,
    changed: context.changed,
    replacements: context.replacements,
  };
}

/**
 * Cooperative counterpart used for durable terminal materialization. Large
 * strings and buffers are measured and hashed in bounded chunks, and durable
 * references may be created asynchronously. The returned frame obeys the same
 * byte limits and replacement shape as {@link boundTurnDeliveryFrame}.
 */
export async function boundTurnDeliveryFrameAsync<T extends Record<string, unknown>>(
  typeInput: string,
  dataInput: T,
  options: BoundTurnDeliveryAsyncOptions = {},
): Promise<BoundedTurnDeliveryResult<T>> {
  const type = String(typeInput || 'event');
  const deliveryClass = classifyTurnDeliveryEvent(type);
  const limits = resolveLimits(options.limits);
  const limitBytes = deliveryClass === 'done'
    ? limits.doneBytes
    : deliveryClass === 'final'
      ? limits.finalBytes
      : limits.progressBytes;
  if (limitBytes < MIN_FRAME_LIMIT_BYTES) {
    throw new RangeError(`Turn delivery frame limit must be at least ${MIN_FRAME_LIMIT_BYTES} bytes.`);
  }

  // Give socket drains and durable-turn heartbeats a chance to run before any
  // user-controlled object traversal begins.
  await yieldToEventLoop();
  const context: AsyncSanitizeContext = {
    type,
    deliveryClass,
    limits,
    createReference: options.createReference,
    replacements: [],
    changed: false,
    ancestors: new Set<object>(),
    visitedValues: 0,
    nodesSinceYield: 0,
  };
  const root = dataInput && typeof dataInput === 'object' ? dataInput : ({} as T);
  const sanitized = await sanitizeValueAsync(root, '$', 0, context, false);
  let data = isRecord(sanitized) ? sanitized : {};
  let frame: Record<string, unknown> = { type, ...data };
  let bytes = await jsonUtf8BytesAsync(frame);

  if (bytes > limitBytes) {
    context.changed = true;
    data = await fitDataToLimitAsync(type, data, limitBytes, context);
    frame = { type, ...data };
    bytes = await jsonUtf8BytesAsync(frame);
  }

  if (bytes > limitBytes) {
    const boundedType = truncateUtf8(type, Math.max(1, limitBytes - 16));
    frame = await jsonUtf8BytesAsync({ type: boundedType }) <= limitBytes ? { type: boundedType } : {};
    data = {};
    bytes = await jsonUtf8BytesAsync(frame);
    context.changed = true;
    recordReplacement(context, { path: '$', kind: 'structure', bytes: Number.isFinite(bytes) ? bytes : limitBytes });
  }

  return {
    frame,
    data: data as T,
    type: String(frame.type ?? type),
    deliveryClass,
    limitBytes,
    bytes,
    changed: context.changed,
    replacements: context.replacements,
  };
}

function resolveLimits(input: Partial<TurnDeliveryLimits> | undefined): TurnDeliveryLimits {
  const merged = { ...DEFAULT_TURN_DELIVERY_LIMITS, ...(input || {}) };
  const positive = (value: unknown, fallback: number, minimum = 1): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
  };
  return {
    progressBytes: positive(merged.progressBytes, DEFAULT_TURN_DELIVERY_LIMITS.progressBytes),
    finalBytes: positive(merged.finalBytes, DEFAULT_TURN_DELIVERY_LIMITS.finalBytes),
    doneBytes: positive(merged.doneBytes, DEFAULT_TURN_DELIVERY_LIMITS.doneBytes),
    maxStringBytes: positive(merged.maxStringBytes, DEFAULT_TURN_DELIVERY_LIMITS.maxStringBytes),
    maxToolResultBytes: positive(merged.maxToolResultBytes, DEFAULT_TURN_DELIVERY_LIMITS.maxToolResultBytes),
    maxInlineBinaryBytes: positive(merged.maxInlineBinaryBytes, DEFAULT_TURN_DELIVERY_LIMITS.maxInlineBinaryBytes),
    maxArrayItems: positive(merged.maxArrayItems, DEFAULT_TURN_DELIVERY_LIMITS.maxArrayItems),
    maxObjectKeys: positive(merged.maxObjectKeys, DEFAULT_TURN_DELIVERY_LIMITS.maxObjectKeys),
    maxDepth: positive(merged.maxDepth, DEFAULT_TURN_DELIVERY_LIMITS.maxDepth),
    maxReplacementRecords: positive(merged.maxReplacementRecords, DEFAULT_TURN_DELIVERY_LIMITS.maxReplacementRecords),
    maxVisitedValues: positive(merged.maxVisitedValues, DEFAULT_TURN_DELIVERY_LIMITS.maxVisitedValues),
    previewBytes: positive(merged.previewBytes, DEFAULT_TURN_DELIVERY_LIMITS.previewBytes),
  };
}

function sanitizeValue(
  value: unknown,
  path: string,
  depth: number,
  context: SanitizeContext,
  toolResultContext: boolean,
): unknown {
  context.visitedValues += 1;
  if (context.visitedValues > context.limits.maxVisitedValues) {
    context.changed = true;
    const bytes = approximateValueBytes(value);
    recordReplacement(context, { path, kind: 'structure', bytes });
    return structuralPlaceholder('value_budget', bytes);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value as number) || typeof value !== 'number' ? value : null;
  }
  if (typeof value === 'string') return sanitizeString(value, path, context, toolResultContext);
  if (typeof value === 'bigint') {
    context.changed = true;
    recordReplacement(context, { path, kind: 'structure', bytes: utf8ByteLength(value.toString()) });
    return value.toString();
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;

  const binary = toBinaryBuffer(value);
  if (binary) return sanitizeBinary(binary, path, context);
  if (value instanceof Date) return value.toJSON();
  if (value instanceof Error) {
    return {
      name: String(value.name || 'Error'),
      message: sanitizeString(String(value.message || ''), `${path}.message`, context, false),
      ...(value.stack ? { stack: sanitizeString(String(value.stack), `${path}.stack`, context, false) } : {}),
    };
  }
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (depth >= context.limits.maxDepth) {
    context.changed = true;
    const bytes = approximateValueBytes(value);
    const placeholder = structuralPlaceholder('depth_limit', bytes);
    recordReplacement(context, { path, kind: 'structure', bytes });
    return placeholder;
  }
  if (context.ancestors.has(value)) {
    context.changed = true;
    recordReplacement(context, { path, kind: 'cycle', bytes: 0 });
    return { $prometheusDelivery: 'cycle_omitted' };
  }

  context.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, context.limits.maxArrayItems);
      const result: unknown[] = [];
      for (let index = 0; index < limit; index += 1) {
        const item = sanitizeValue(value[index], `${path}[${index}]`, depth + 1, context, toolResultContext);
        result.push(item === undefined ? null : item);
      }
      if (value.length > limit) {
        const omittedItems = value.length - limit;
        context.changed = true;
        result.push({ $prometheusDelivery: 'array_items_omitted', omittedItems });
        recordReplacement(context, { path, kind: 'structure', bytes: approximateValueBytes(value), omittedItems });
      }
      return result;
    }

    const source = value as Record<string, unknown>;
    const entries: Array<[string, unknown]> = [];
    let ownKeyCount = 0;
    let keyScanTruncated = false;
    try {
      // Object.entries() materializes and reads every property before the
      // maxObjectKeys limit can apply. Iterate only a bounded prefix instead,
      // and never invoke getters for keys that will be omitted.
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        ownKeyCount += 1;
        if (entries.length < context.limits.maxObjectKeys) {
          entries.push([
            key,
            key.length > MAX_TRANSPORT_OBJECT_KEY_CODE_UNITS
              ? structuralPlaceholder('object_key_limit', approximateStringBytes(key))
              : source[key],
          ]);
        }
        if (ownKeyCount >= Math.max(context.limits.maxObjectKeys + 1, MAX_OBJECT_KEYS_SCANNED)) {
          keyScanTruncated = true;
          break;
        }
      }
    } catch {
      context.changed = true;
      recordReplacement(context, { path, kind: 'structure', bytes: 0 });
      return { $prometheusDelivery: 'unreadable_value_omitted' };
    }
    const result: Record<string, unknown> = {};
    for (let index = 0; index < entries.length; index += 1) {
      const [key, child] = entries[index];
      const outputKey = boundedTransportObjectKey(key, index);
      if (outputKey !== key) {
        context.changed = true;
        recordReplacement(context, {
          path: `${path}.$key[${index}]`,
          kind: 'structure',
          bytes: approximateStringBytes(key),
        });
      }
      const childPath = appendObjectPath(path, outputKey);
      const childToolContext = toolResultContext || isToolResultField(context.type, path, outputKey);
      const sanitized = sanitizeValue(child, childPath, depth + 1, context, childToolContext);
      if (sanitized !== undefined) result[outputKey] = sanitized;
    }
    if (ownKeyCount > entries.length || keyScanTruncated) {
      // When the scan cap is reached this is a conservative lower bound. The
      // transport only needs to communicate omission; it must not enumerate a
      // million-key object just to produce an exact diagnostic count.
      const omittedItems = Math.max(1, ownKeyCount - entries.length);
      context.changed = true;
      result.$prometheusDelivery = {
        kind: 'object_keys_omitted',
        omittedItems,
        ...(keyScanTruncated ? { countIsLowerBound: true } : {}),
      };
      recordReplacement(context, { path, kind: 'structure', bytes: approximateValueBytes(value), omittedItems });
    }
    return result;
  } finally {
    context.ancestors.delete(value);
  }
}

async function sanitizeValueAsync(
  value: unknown,
  path: string,
  depth: number,
  context: AsyncSanitizeContext,
  toolResultContext: boolean,
): Promise<unknown> {
  context.visitedValues += 1;
  context.nodesSinceYield += 1;
  if (context.nodesSinceYield >= ASYNC_NODE_YIELD_BUDGET) {
    context.nodesSinceYield = 0;
    await yieldToEventLoop();
  }
  if (context.visitedValues > context.limits.maxVisitedValues) {
    context.changed = true;
    const bytes = approximateValueBytes(value);
    recordReplacement(context, { path, kind: 'structure', bytes });
    return structuralPlaceholder('value_budget', bytes);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value as number) || typeof value !== 'number' ? value : null;
  }
  if (typeof value === 'string') return sanitizeStringAsync(value, path, context, toolResultContext);
  if (typeof value === 'bigint') {
    context.changed = true;
    const stringValue = value.toString();
    recordReplacement(context, { path, kind: 'structure', bytes: utf8ByteLength(stringValue) });
    return stringValue;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;

  const binary = toBinaryBuffer(value);
  if (binary) return sanitizeBinaryAsync(binary, path, context);
  if (value instanceof Date) return value.toJSON();
  if (value instanceof Error) {
    const output: Record<string, unknown> = {
      name: String(value.name || 'Error'),
      message: await sanitizeStringAsync(String(value.message || ''), `${path}.message`, context, false),
    };
    if (value.stack) output.stack = await sanitizeStringAsync(String(value.stack), `${path}.stack`, context, false);
    return output;
  }
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (depth >= context.limits.maxDepth) {
    context.changed = true;
    const bytes = approximateValueBytes(value);
    recordReplacement(context, { path, kind: 'structure', bytes });
    return structuralPlaceholder('depth_limit', bytes);
  }
  if (context.ancestors.has(value)) {
    context.changed = true;
    recordReplacement(context, { path, kind: 'cycle', bytes: 0 });
    return { $prometheusDelivery: 'cycle_omitted' };
  }

  context.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, context.limits.maxArrayItems);
      const result: unknown[] = [];
      for (let index = 0; index < limit; index += 1) {
        const item = await sanitizeValueAsync(value[index], `${path}[${index}]`, depth + 1, context, toolResultContext);
        result.push(item === undefined ? null : item);
      }
      if (value.length > limit) {
        const omittedItems = value.length - limit;
        context.changed = true;
        result.push({ $prometheusDelivery: 'array_items_omitted', omittedItems });
        recordReplacement(context, { path, kind: 'structure', bytes: approximateValueBytes(value), omittedItems });
      }
      return result;
    }

    const source = value as Record<string, unknown>;
    const entries: Array<[string, unknown]> = [];
    let ownKeyCount = 0;
    let keyScanTruncated = false;
    try {
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        ownKeyCount += 1;
        if (entries.length < context.limits.maxObjectKeys) {
          entries.push([
            key,
            key.length > MAX_TRANSPORT_OBJECT_KEY_CODE_UNITS
              ? structuralPlaceholder('object_key_limit', approximateStringBytes(key))
              : source[key],
          ]);
        }
        if (ownKeyCount % ASYNC_NODE_YIELD_BUDGET === 0) await yieldToEventLoop();
        if (ownKeyCount >= Math.max(context.limits.maxObjectKeys + 1, MAX_OBJECT_KEYS_SCANNED)) {
          keyScanTruncated = true;
          break;
        }
      }
    } catch {
      context.changed = true;
      recordReplacement(context, { path, kind: 'structure', bytes: 0 });
      return { $prometheusDelivery: 'unreadable_value_omitted' };
    }
    const result: Record<string, unknown> = {};
    for (let index = 0; index < entries.length; index += 1) {
      const [key, child] = entries[index];
      const outputKey = boundedTransportObjectKey(key, index);
      if (outputKey !== key) {
        context.changed = true;
        recordReplacement(context, {
          path: `${path}.$key[${index}]`,
          kind: 'structure',
          bytes: approximateStringBytes(key),
        });
      }
      const childPath = appendObjectPathAsyncSafe(path, outputKey);
      const childToolContext = toolResultContext || isToolResultField(context.type, path, outputKey);
      const sanitized = await sanitizeValueAsync(child, childPath, depth + 1, context, childToolContext);
      if (sanitized !== undefined) result[outputKey] = sanitized;
    }
    if (ownKeyCount > entries.length || keyScanTruncated) {
      const omittedItems = Math.max(1, ownKeyCount - entries.length);
      context.changed = true;
      result.$prometheusDelivery = {
        kind: 'object_keys_omitted',
        omittedItems,
        ...(keyScanTruncated ? { countIsLowerBound: true } : {}),
      };
      recordReplacement(context, { path, kind: 'structure', bytes: approximateValueBytes(value), omittedItems });
    }
    return result;
  } finally {
    context.ancestors.delete(value);
  }
}

async function sanitizeStringAsync(
  value: string,
  path: string,
  context: AsyncSanitizeContext,
  toolResultContext: boolean,
): Promise<string> {
  const dataUri = parseBase64DataUri(value);
  const base64Field = !dataUri && looksLikeBase64Field(path, value);
  const maxBytes = toolResultContext ? context.limits.maxToolResultBytes : context.limits.maxStringBytes;
  const definitelyNeedsDigest = !!dataUri
    || base64Field
    || value.length > maxBytes;
  let measurement = await measureUtf8StringAsync(value, definitelyNeedsDigest);
  const oversizedDataUri = !!dataUri && dataUri.decodedBytes > context.limits.maxInlineBinaryBytes;
  const oversizedBase64Field = base64Field
    && Math.max(0, Math.floor(measurement.nonWhitespaceCodeUnits * 0.75) - 2) > context.limits.maxInlineBinaryBytes;
  if (oversizedDataUri || oversizedBase64Field) {
    if (!measurement.sha256) measurement = await measureUtf8StringAsync(value, true);
    return omittedStringAsync(
      value,
      path,
      measurement.bytes,
      measurement.sha256!,
      context,
      dataUri?.mediaType,
    );
  }
  if (measurement.bytes <= maxBytes) return value;
  if (!measurement.sha256) measurement = await measureUtf8StringAsync(value, true);

  const kind: DeliveryReplacementKind = toolResultContext ? 'tool_result' : 'text';
  const digest = measurement.sha256!;
  const ref = await createReferenceAsync(context, { kind, path, bytes: measurement.bytes, sha256: digest, value });
  const suffix = `\n… [delivery truncated ${measurement.bytes} bytes; sha256=${digest.slice(0, 16)}${ref ? `; ref=${ref}` : ''}]`;
  const previewBudget = Math.min(maxBytes, Math.max(64, context.limits.previewBytes + utf8ByteLength(suffix)));
  const bounded = truncateUtf8WithSuffixKnownOversize(value, previewBudget, suffix);
  context.changed = true;
  recordReplacement(context, { path, kind, bytes: measurement.bytes, sha256: digest, ...(ref ? { ref } : {}) });
  return bounded;
}

async function sanitizeBinaryAsync(
  value: Buffer,
  path: string,
  context: AsyncSanitizeContext,
): Promise<Record<string, unknown>> {
  const bytes = value.byteLength;
  const digest = await sha256BufferAsync(value);
  const ref = await createReferenceAsync(context, { kind: 'binary', path, bytes, sha256: digest, value });
  context.changed = true;
  recordReplacement(context, { path, kind: 'binary', bytes, sha256: digest, ...(ref ? { ref } : {}) });
  return {
    $prometheusDelivery: 'binary_omitted',
    bytes,
    sha256: digest,
    ...(ref ? { ref } : {}),
  };
}

async function omittedStringAsync(
  value: string,
  path: string,
  bytes: number,
  digest: string,
  context: AsyncSanitizeContext,
  mediaType?: string,
): Promise<string> {
  const ref = await createReferenceAsync(context, {
    kind: 'base64',
    path,
    bytes,
    sha256: digest,
    ...(mediaType ? { mediaType } : {}),
    value,
  });
  context.changed = true;
  recordReplacement(context, { path, kind: 'base64', bytes, sha256: digest, ...(ref ? { ref } : {}), ...(mediaType ? { mediaType } : {}) });
  if (ref && mediaType && /^(?:https?:\/\/|\/)/i.test(ref)) return ref;
  return `[delivery omitted ${mediaType || 'base64'} content; ${bytes} bytes; sha256=${digest.slice(0, 16)}${ref ? `; ref=${ref}` : ''}]`;
}

function sanitizeString(value: string, path: string, context: SanitizeContext, toolResultContext: boolean): string {
  if (value.length > MAX_SYNC_STRING_CODE_UNITS) {
    return sanitizeVeryLargeStringSync(value, path, context, toolResultContext);
  }
  const bytes = utf8ByteLength(value);
  const dataUri = parseBase64DataUri(value);
  if (dataUri && dataUri.decodedBytes > context.limits.maxInlineBinaryBytes) {
    return omittedString(value, path, 'base64', bytes, context, dataUri.mediaType);
  }
  if (!dataUri && looksLikeBase64Field(path, value) && estimatedBase64Bytes(value) > context.limits.maxInlineBinaryBytes) {
    return omittedString(value, path, 'base64', bytes, context);
  }
  const maxBytes = toolResultContext ? context.limits.maxToolResultBytes : context.limits.maxStringBytes;
  if (bytes <= maxBytes) return value;

  const kind: DeliveryReplacementKind = toolResultContext ? 'tool_result' : 'text';
  const digest = sha256(value);
  const ref = createReference(context, { kind, path, bytes, sha256: digest, value });
  const suffix = `\n… [delivery truncated ${bytes} bytes; sha256=${digest.slice(0, 16)}${ref ? `; ref=${ref}` : ''}]`;
  const previewBudget = Math.min(maxBytes, Math.max(64, context.limits.previewBytes + utf8ByteLength(suffix)));
  const bounded = truncateUtf8WithSuffix(value, previewBudget, suffix);
  context.changed = true;
  recordReplacement(context, { path, kind, bytes, sha256: digest, ...(ref ? { ref } : {}) });
  return bounded;
}

function sanitizeVeryLargeStringSync(
  value: string,
  path: string,
  context: SanitizeContext,
  toolResultContext: boolean,
): string {
  // UTF-8 is never shorter than the number of UTF-16 code units. For ordinary
  // base64/ASCII payloads this is exact; otherwise it is a conservative lower
  // bound deliberately obtained without scanning the complete value.
  const bytes = value.length;
  const dataUri = parseBase64DataUri(value);
  const base64Field = !dataUri && looksLikeBase64Field(path, value);
  if (
    (dataUri && dataUri.decodedBytes > context.limits.maxInlineBinaryBytes)
    || (base64Field && Math.max(0, Math.floor(value.length * 0.75) - 2) > context.limits.maxInlineBinaryBytes)
  ) {
    context.changed = true;
    recordReplacement(context, {
      path,
      kind: 'base64',
      bytes,
      ...(dataUri?.mediaType ? { mediaType: dataUri.mediaType } : {}),
    });
    return `[delivery omitted ${dataUri?.mediaType || 'base64'} content; at least ${bytes} bytes]`;
  }

  const maxBytes = toolResultContext ? context.limits.maxToolResultBytes : context.limits.maxStringBytes;
  const kind: DeliveryReplacementKind = toolResultContext ? 'tool_result' : 'text';
  const suffix = `\n… [delivery truncated; at least ${bytes} bytes; durable ref pending]`;
  const previewBudget = Math.min(maxBytes, Math.max(64, context.limits.previewBytes + utf8ByteLength(suffix)));
  const bounded = truncateUtf8WithSuffixKnownOversize(value, previewBudget, suffix);
  context.changed = true;
  recordReplacement(context, { path, kind, bytes });
  return bounded;
}

function sanitizeBinary(value: Buffer, path: string, context: SanitizeContext): unknown {
  const bytes = value.byteLength;
  if (bytes > MAX_SYNC_BINARY_BYTES) {
    context.changed = true;
    recordReplacement(context, { path, kind: 'binary', bytes });
    return {
      $prometheusDelivery: 'binary_omitted',
      bytes,
      digest: 'durable_ref_pending',
    };
  }
  // Buffers/typed arrays are never emitted as JSON number arrays. Even a small
  // image expands roughly 4-12x and creates avoidable stringify pressure.
  const digest = sha256(value);
  const ref = createReference(context, { kind: 'binary', path, bytes, sha256: digest, value });
  context.changed = true;
  recordReplacement(context, { path, kind: 'binary', bytes, sha256: digest, ...(ref ? { ref } : {}) });
  return {
    $prometheusDelivery: 'binary_omitted',
    bytes,
    sha256: digest,
    ...(ref ? { ref } : {}),
  };
}

function omittedString(
  value: string,
  path: string,
  kind: 'base64',
  bytes: number,
  context: SanitizeContext,
  mediaType?: string,
): string {
  const digest = sha256(value);
  const ref = createReference(context, { kind, path, bytes, sha256: digest, mediaType, value });
  context.changed = true;
  recordReplacement(context, { path, kind, bytes, sha256: digest, ...(ref ? { ref } : {}), ...(mediaType ? { mediaType } : {}) });
  // A data URI is normally consumed as an <img>/<video>/download URL. When the
  // caller persisted the decoded media and returned a gateway URL, preserve
  // that field's URL-compatible shape so bounding the frame does not make the
  // artifact disappear from clients.
  if (ref && mediaType && /^(?:https?:\/\/|\/)/i.test(ref)) return ref;
  return `[delivery omitted ${mediaType || 'base64'} content; ${bytes} bytes; sha256=${digest.slice(0, 16)}${ref ? `; ref=${ref}` : ''}]`;
}

function fitDataToLimit(
  type: string,
  input: Record<string, unknown>,
  limitBytes: number,
  context: SanitizeContext,
): Record<string, unknown> {
  let candidate = cloneJsonRecord(input);
  const fits = () => jsonUtf8Bytes({ type, ...candidate }) <= limitBytes;
  if (fits()) return candidate;

  for (const key of HEAVY_TOP_LEVEL_KEYS) {
    if (!(key in candidate)) continue;
    const bytes = approximateValueBytes(candidate[key]);
    candidate[key] = structuralPlaceholder('frame_limit', bytes);
    recordReplacement(context, { path: appendObjectPath('$', key), kind: 'structure', bytes });
    if (fits()) return candidate;
  }

  for (const stringBudget of [16 * 1024, 4 * 1024, 1024, 256]) {
    candidate = clampStrings(candidate, stringBudget, context, '$') as Record<string, unknown>;
    if (fits()) return candidate;
  }

  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!CRITICAL_TOP_LEVEL_KEYS.has(key)) continue;
    compact[key] = value;
  }
  candidate = compact;
  if (fits()) return candidate;

  // Keep text-bearing fields but divide the available space conservatively.
  const finalCompact: Record<string, unknown> = {};
  const keys = ['mode', 'status', 'action', 'name', 'message', 'text', 'reply', 'error', 'clientRequestId'];
  const present = keys.filter((key) => key in candidate);
  const perField = Math.max(16, Math.floor((limitBytes - jsonUtf8Bytes({ type }) - 32) / Math.max(1, present.length)));
  for (const key of present) {
    const value = candidate[key];
    if (typeof value === 'string') finalCompact[key] = truncateUtf8(value, perField);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) finalCompact[key] = value;
  }
  candidate = finalCompact;
  if (fits()) return candidate;

  return {};
}

async function fitDataToLimitAsync(
  type: string,
  input: Record<string, unknown>,
  limitBytes: number,
  context: AsyncSanitizeContext,
): Promise<Record<string, unknown>> {
  let candidate = { ...input };
  const fits = async (): Promise<boolean> => await jsonUtf8BytesAsync({ type, ...candidate }) <= limitBytes;
  if (await fits()) return candidate;

  for (const key of HEAVY_TOP_LEVEL_KEYS) {
    if (!(key in candidate)) continue;
    const bytes = approximateValueBytes(candidate[key]);
    candidate[key] = structuralPlaceholder('frame_limit', bytes);
    recordReplacement(context, { path: appendObjectPath('$', key), kind: 'structure', bytes });
    if (await fits()) return candidate;
  }

  for (const stringBudget of [16 * 1024, 4 * 1024, 1024, 256]) {
    candidate = await clampStringsAsync(candidate, stringBudget, context, '$') as Record<string, unknown>;
    if (await fits()) return candidate;
  }

  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (CRITICAL_TOP_LEVEL_KEYS.has(key)) compact[key] = value;
  }
  candidate = compact;
  if (await fits()) return candidate;

  const finalCompact: Record<string, unknown> = {};
  const keys = ['mode', 'status', 'action', 'name', 'message', 'text', 'reply', 'error', 'clientRequestId'];
  const present = keys.filter((key) => key in candidate);
  const typeBytes = await jsonUtf8BytesAsync({ type });
  const perField = Math.max(16, Math.floor((limitBytes - typeBytes - 32) / Math.max(1, present.length)));
  for (const key of present) {
    const value = candidate[key];
    if (typeof value === 'string') finalCompact[key] = truncateUtf8KnownBudget(value, perField);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) finalCompact[key] = value;
  }
  candidate = finalCompact;
  if (await fits()) return candidate;
  return {};
}

function clampStrings(value: unknown, maxBytes: number, context: SanitizeContext, path: string): unknown {
  if (typeof value === 'string') {
    if (utf8ByteLength(value) <= maxBytes) return value;
    context.changed = true;
    const suffix = '… [delivery truncated]';
    recordReplacement(context, { path, kind: 'text', bytes: utf8ByteLength(value) });
    return truncateUtf8WithSuffix(value, maxBytes, suffix);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => clampStrings(item, maxBytes, context, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = clampStrings(item, maxBytes, context, appendObjectPath(path, key));
    }
    return output;
  }
  return value;
}

async function clampStringsAsync(
  value: unknown,
  maxBytes: number,
  context: AsyncSanitizeContext,
  path: string,
): Promise<unknown> {
  context.nodesSinceYield += 1;
  if (context.nodesSinceYield >= ASYNC_NODE_YIELD_BUDGET) {
    context.nodesSinceYield = 0;
    await yieldToEventLoop();
  }
  if (typeof value === 'string') {
    const bytes = (await measureUtf8StringAsync(value, false)).bytes;
    if (bytes <= maxBytes) return value;
    context.changed = true;
    recordReplacement(context, { path, kind: 'text', bytes });
    return truncateUtf8WithSuffixKnownOversize(value, maxBytes, '… [delivery truncated]');
  }
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      output.push(await clampStringsAsync(value[index], maxBytes, context, `${path}[${index}]`));
    }
    return output;
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = await clampStringsAsync(item, maxBytes, context, appendObjectPathAsyncSafe(path, key));
    }
    return output;
  }
  return value;
}

function cloneJsonRecord(input: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return { ...input };
  }
}

function structuralPlaceholder(reason: string, bytes: number): Record<string, unknown> {
  return {
    $prometheusDelivery: 'content_omitted',
    reason,
    bytes: Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : undefined,
  };
}

function recordReplacement(
  context: Pick<SanitizeContext, 'changed' | 'replacements' | 'limits'>,
  replacement: DeliveryReplacement,
): void {
  context.changed = true;
  if (context.replacements.length >= context.limits.maxReplacementRecords) return;
  context.replacements.push({
    ...replacement,
    path: truncateUtf8(String(replacement.path || '$'), 320),
  });
}

function createReference(context: SanitizeContext, candidate: DeliveryReferenceCandidate): string | undefined {
  if (!context.createReference) return undefined;
  try {
    const ref = String(context.createReference(candidate) || '').trim();
    return ref ? truncateUtf8(ref, 1024) : undefined;
  } catch {
    return undefined;
  }
}

async function createReferenceAsync(
  context: AsyncSanitizeContext,
  candidate: DeliveryReferenceCandidate,
): Promise<string | undefined> {
  if (!context.createReference) return undefined;
  const ref = String(await context.createReference(candidate) || '').trim();
  return ref ? truncateUtf8(ref, 1024) : undefined;
}

function parseBase64DataUri(value: string): { mediaType: string; decodedBytes: number } | null {
  const match = /^data:([^;,\s]+)?(?:;[^;,\s]+)*;base64,/i.exec(value.slice(0, 512));
  if (!match) return null;
  const payloadLength = Math.max(0, value.length - match[0].length);
  return {
    mediaType: String(match[1] || 'application/octet-stream').toLowerCase(),
    decodedBytes: Math.max(0, Math.floor(payloadLength * 0.75) - 2),
  };
}

function looksLikeBase64Field(path: string, value: string): boolean {
  if (value.length < 1024) return false;
  if (!/(?:base64|dataurl|data_url|image_data|screenshot|binary|blob)$/i.test(path.replace(/[^a-z0-9_]+/gi, ''))) return false;
  const sample = value.slice(0, Math.min(value.length, 4096)).replace(/\s+/g, '');
  return sample.length >= 1024 && /^[a-z0-9+/]+={0,2}$/i.test(sample);
}

function estimatedBase64Bytes(value: string): number {
  return Math.max(0, Math.floor(value.replace(/\s+/g, '').length * 0.75) - 2);
}

function isToolResultField(type: string, parentPath: string, key: string): boolean {
  const normalizedType = String(type || '').toLowerCase();
  const normalizedKey = String(key || '').toLowerCase();
  if (normalizedType === 'tool_result' && ['result', 'output', 'content', 'data'].includes(normalizedKey)) return true;
  if (!/(?:\.results|\.toolResults|\[\d+\])/i.test(parentPath)) return false;
  return ['result', 'output', 'content', 'data', 'stdout', 'stderr'].includes(normalizedKey);
}

function toBinaryBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function measureUtf8StringAsync(
  value: string,
  includeHash: boolean,
): Promise<{ bytes: number; nonWhitespaceCodeUnits: number; sha256?: string }> {
  if (value.length <= ASYNC_STRING_CHUNK_CODE_UNITS) {
    return {
      bytes: utf8ByteLength(value),
      nonWhitespaceCodeUnits: value.replace(/\s+/g, '').length,
      ...(includeHash ? { sha256: sha256(value) } : {}),
    };
  }
  const hash = includeHash ? crypto.createHash('sha256') : null;
  let bytes = 0;
  let nonWhitespaceCodeUnits = 0;
  for (let start = 0; start < value.length;) {
    const end = boundedStringChunkEnd(value, start);
    const chunk = value.slice(start, end);
    bytes += utf8ByteLength(chunk);
    nonWhitespaceCodeUnits += chunk.length - countWhitespaceCodeUnits(chunk);
    if (hash) hash.update(chunk, 'utf8');
    start = end;
    await yieldToEventLoop();
  }
  return {
    bytes,
    nonWhitespaceCodeUnits,
    ...(hash ? { sha256: hash.digest('hex') } : {}),
  };
}

async function sha256BufferAsync(value: Buffer): Promise<string> {
  const hash = crypto.createHash('sha256');
  for (let offset = 0; offset < value.byteLength; offset += ASYNC_BINARY_CHUNK_BYTES) {
    hash.update(value.subarray(offset, Math.min(value.byteLength, offset + ASYNC_BINARY_CHUNK_BYTES)));
    await yieldToEventLoop();
  }
  return hash.digest('hex');
}

function countWhitespaceCodeUnits(value: string): number {
  let count = 0;
  const pattern = /\s/g;
  while (pattern.exec(value)) count += 1;
  return count;
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
    end += 1;
  }
  return end;
}

function truncateUtf8KnownBudget(value: string, maxBytes: number): string {
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (budget === 0 || value.length === 0) return '';
  // No UTF-8 prefix fitting N bytes can require more than N UTF-16 code units.
  // Slice first so the synchronous exact truncator only sees bounded input.
  return truncateUtf8(value.slice(0, Math.min(value.length, budget + 1)), budget);
}

function truncateUtf8WithSuffixKnownOversize(value: string, maxBytes: number, suffix: string): string {
  const budget = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (budget === 0) return '';
  const boundedSuffix = truncateUtf8(String(suffix ?? ''), budget);
  const prefixBudget = Math.max(0, budget - utf8ByteLength(boundedSuffix));
  return `${truncateUtf8KnownBudget(value, prefixBudget)}${boundedSuffix}`;
}

async function jsonUtf8BytesAsync(value: unknown): Promise<number> {
  try {
    return await jsonValueUtf8BytesAsync(value, new Set<object>());
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function jsonValueUtf8BytesAsync(value: unknown, ancestors: Set<object>): Promise<number> {
  if (value === null) return 4;
  if (typeof value === 'string') return jsonStringUtf8BytesAsync(value);
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return utf8ByteLength(JSON.stringify(Number.isFinite(value) ? value : null));
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return 0;
  if (!value || typeof value !== 'object') return jsonStringUtf8BytesAsync(String(value ?? ''));
  if (ancestors.has(value)) throw new TypeError('Cannot measure cyclic JSON');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let bytes = 2;
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) bytes += 1;
        const item = value[index];
        bytes += item === undefined || typeof item === 'function' || typeof item === 'symbol'
          ? 4
          : await jsonValueUtf8BytesAsync(item, ancestors);
        if (index % ASYNC_NODE_YIELD_BUDGET === ASYNC_NODE_YIELD_BUDGET - 1) await yieldToEventLoop();
      }
      return bytes;
    }
    let bytes = 2;
    let emitted = 0;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      if (emitted > 0) bytes += 1;
      bytes += await jsonStringUtf8BytesAsync(key);
      bytes += 1;
      bytes += await jsonValueUtf8BytesAsync(item, ancestors);
      emitted += 1;
      if (emitted % ASYNC_NODE_YIELD_BUDGET === 0) await yieldToEventLoop();
    }
    return bytes;
  } finally {
    ancestors.delete(value);
  }
}

async function jsonStringUtf8BytesAsync(value: string): Promise<number> {
  if (value.length <= ASYNC_STRING_CHUNK_CODE_UNITS) return utf8ByteLength(JSON.stringify(value));
  let bytes = 2;
  for (let start = 0; start < value.length;) {
    const end = boundedStringChunkEnd(value, start);
    const encoded = JSON.stringify(value.slice(start, end));
    bytes += utf8ByteLength(encoded.slice(1, -1));
    start = end;
    await yieldToEventLoop();
  }
  return bytes;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function approximateValueBytes(value: unknown): number {
  if (typeof value === 'string') return approximateStringBytes(value);
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) return saturatingMultiply(value.length, 8);
  if (isRecord(value)) return estimateObjectShapeBytes(value);
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 0 : utf8ByteLength(encoded);
  } catch {
    return 0;
  }
}

function estimateObjectShapeBytes(value: Record<string, unknown>): number {
  let bytes = 2;
  let scanned = 0;
  try {
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      bytes = Math.min(Number.MAX_SAFE_INTEGER, bytes + approximateStringBytes(key) + 4);
      scanned += 1;
      if (scanned >= MAX_OBJECT_KEYS_SCANNED) break;
    }
  } catch {
    return bytes;
  }
  return bytes;
}

function approximateStringBytes(value: string): number {
  return value.length > MAX_SYNC_STRING_CODE_UNITS ? value.length : utf8ByteLength(value);
}

function saturatingMultiply(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

function appendObjectPath(parent: string, key: string): string {
  const boundedKey = boundedTransportObjectKey(key, 0);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(boundedKey)
    ? `${parent}.${boundedKey}`
    : `${parent}[${JSON.stringify(boundedKey)}]`;
}

function appendObjectPathAsyncSafe(parent: string, key: string): string {
  return appendObjectPath(parent, key);
}

function boundedTransportObjectKey(key: string, ordinal: number): string {
  if (key.length <= MAX_TRANSPORT_OBJECT_KEY_CODE_UNITS) return key;
  const suffix = `…[$prometheusKeyOmitted:${key.length}:${ordinal}]`;
  return `${key.slice(0, Math.max(1, MAX_TRANSPORT_OBJECT_KEY_CODE_UNITS - suffix.length))}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
