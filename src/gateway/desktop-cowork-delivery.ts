export type DesktopDeliveryMode = 'background' | 'foreground';

export interface DesktopDeliveryTarget {
  windowHandle?: number;
  pid?: number;
  processStartTime?: number;
  appId?: string;
  title?: string;
}

export interface DesktopDeliveryRequest {
  requestedMode?: DesktopDeliveryMode;
  target?: DesktopDeliveryTarget;
  allowForegroundFallback?: boolean;
}

export interface DesktopDeliveryResult {
  requestedMode: DesktopDeliveryMode;
  deliveredMode: DesktopDeliveryMode;
  target: DesktopDeliveryTarget;
  backgroundAttempted: boolean;
  foregroundFallbackUsed: boolean;
  cursorDisturbed: boolean;
  focusDisturbed: boolean;
  verified: boolean;
  verification?: string;
}

export class DesktopBackgroundDeliveryUnsupportedError extends Error {
  constructor(message = 'Background desktop delivery is not supported for this target/action.') {
    super(message);
    this.name = 'DesktopBackgroundDeliveryUnsupportedError';
  }
}

export class DesktopBackgroundDeliveryNoopError extends Error {
  constructor(message = 'Background desktop delivery did not produce a verifiable target change.') {
    super(message);
    this.name = 'DesktopBackgroundDeliveryNoopError';
  }
}

export function normalizeDesktopDeliveryMode(value: unknown): DesktopDeliveryMode {
  return String(value || '').trim().toLowerCase() === 'foreground' ? 'foreground' : 'background';
}

export function normalizeDesktopDeliveryTarget(target: DesktopDeliveryTarget | null | undefined): DesktopDeliveryTarget {
  const input = target || {};
  const output: DesktopDeliveryTarget = {};
  if (Number.isFinite(Number(input.windowHandle))) output.windowHandle = Number(input.windowHandle);
  if (Number.isFinite(Number(input.pid))) output.pid = Number(input.pid);
  if (Number.isFinite(Number(input.processStartTime))) output.processStartTime = Number(input.processStartTime);
  if (String(input.appId || '').trim()) output.appId = String(input.appId).trim();
  if (String(input.title || '').trim()) output.title = String(input.title).trim();
  return output;
}

export function hasStrongBackgroundTarget(target: DesktopDeliveryTarget | null | undefined): boolean {
  const normalized = normalizeDesktopDeliveryTarget(target);
  return Number.isFinite(normalized.pid) || Number.isFinite(normalized.windowHandle);
}

export function shouldEscalateDesktopDelivery(error: unknown): boolean {
  return error instanceof DesktopBackgroundDeliveryUnsupportedError
    || error instanceof DesktopBackgroundDeliveryNoopError;
}

export async function runDesktopDeliveryWithFallback<T>(input: {
  request?: DesktopDeliveryRequest;
  background: (target: DesktopDeliveryTarget) => Promise<{ value: T; verified?: boolean; verification?: string }>;
  foreground: (target: DesktopDeliveryTarget) => Promise<{ value: T; verified?: boolean; verification?: string }>;
}): Promise<{ value: T; delivery: DesktopDeliveryResult }> {
  const request = input.request || {};
  const requestedMode = normalizeDesktopDeliveryMode(request.requestedMode);
  const target = normalizeDesktopDeliveryTarget(request.target);
  const allowFallback = request.allowForegroundFallback !== false;

  if (requestedMode === 'foreground') {
    const result = await input.foreground(target);
    return {
      value: result.value,
      delivery: {
        requestedMode,
        deliveredMode: 'foreground',
        target,
        backgroundAttempted: false,
        foregroundFallbackUsed: false,
        cursorDisturbed: true,
        focusDisturbed: true,
        verified: result.verified !== false,
        verification: result.verification,
      },
    };
  }

  if (!hasStrongBackgroundTarget(target)) {
    if (!allowFallback) {
      throw new DesktopBackgroundDeliveryUnsupportedError('Background delivery requires an exact window handle or pid.');
    }
    const result = await input.foreground(target);
    return {
      value: result.value,
      delivery: {
        requestedMode,
        deliveredMode: 'foreground',
        target,
        backgroundAttempted: false,
        foregroundFallbackUsed: true,
        cursorDisturbed: true,
        focusDisturbed: true,
        verified: result.verified !== false,
        verification: result.verification || 'Background target identity unavailable; used foreground compatibility lane.',
      },
    };
  }

  try {
    const result = await input.background(target);
    if (result.verified === false) {
      throw new DesktopBackgroundDeliveryNoopError(result.verification);
    }
    return {
      value: result.value,
      delivery: {
        requestedMode,
        deliveredMode: 'background',
        target,
        backgroundAttempted: true,
        foregroundFallbackUsed: false,
        cursorDisturbed: false,
        focusDisturbed: false,
        verified: true,
        verification: result.verification,
      },
    };
  } catch (error) {
    if (!allowFallback || !shouldEscalateDesktopDelivery(error)) throw error;
    const result = await input.foreground(target);
    return {
      value: result.value,
      delivery: {
        requestedMode,
        deliveredMode: 'foreground',
        target,
        backgroundAttempted: true,
        foregroundFallbackUsed: true,
        cursorDisturbed: true,
        focusDisturbed: true,
        verified: result.verified !== false,
        verification: result.verification || String((error as any)?.message || error || 'Background delivery failed verification.'),
      },
    };
  }
}
