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

export interface DesktopDeliveryAttempt<T> {
  value: T;
  /** Background delivery MUST explicitly verify true before it is accepted. */
  verified?: boolean;
  verification?: string;
  /** Foreground metadata may be more precise than the conservative defaults. */
  cursorDisturbed?: boolean;
  focusDisturbed?: boolean;
}

export interface DesktopDeliveryResult {
  requestedMode: DesktopDeliveryMode;
  deliveredMode: DesktopDeliveryMode;
  target: DesktopDeliveryTarget;
  backgroundAttempted: boolean;
  foregroundFallbackUsed: boolean;
  /** True when this action actually used or may have used the human's real pointer. */
  cursorDisturbed: boolean;
  /** True when this action actually raised/activated or may have changed foreground focus. */
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

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveFinite(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

export function normalizeDesktopDeliveryTarget(target: DesktopDeliveryTarget | null | undefined): DesktopDeliveryTarget {
  const input = target || {};
  const output: DesktopDeliveryTarget = {};
  const windowHandle = positiveInteger(input.windowHandle);
  const pid = positiveInteger(input.pid);
  const processStartTime = positiveFinite(input.processStartTime);
  if (windowHandle !== undefined) output.windowHandle = windowHandle;
  if (pid !== undefined) output.pid = pid;
  if (processStartTime !== undefined) output.processStartTime = processStartTime;
  if (String(input.appId || '').trim()) output.appId = String(input.appId).trim();
  if (String(input.title || '').trim()) output.title = String(input.title).trim();
  return output;
}

export function hasStrongBackgroundTarget(target: DesktopDeliveryTarget | null | undefined): boolean {
  const normalized = normalizeDesktopDeliveryTarget(target);
  return normalized.pid !== undefined || normalized.windowHandle !== undefined;
}

export function shouldEscalateDesktopDelivery(error: unknown): boolean {
  return error instanceof DesktopBackgroundDeliveryUnsupportedError
    || error instanceof DesktopBackgroundDeliveryNoopError;
}

function foregroundMetadata<T>(
  requestedMode: DesktopDeliveryMode,
  target: DesktopDeliveryTarget,
  result: DesktopDeliveryAttempt<T>,
  input: { backgroundAttempted: boolean; foregroundFallbackUsed: boolean; fallbackReason?: string },
): { value: T; delivery: DesktopDeliveryResult } {
  return {
    value: result.value,
    delivery: {
      requestedMode,
      deliveredMode: 'foreground',
      target,
      backgroundAttempted: input.backgroundAttempted,
      foregroundFallbackUsed: input.foregroundFallbackUsed,
      cursorDisturbed: result.cursorDisturbed ?? true,
      focusDisturbed: result.focusDisturbed ?? true,
      verified: result.verified === true,
      verification: result.verification || input.fallbackReason,
    },
  };
}

export async function runDesktopDeliveryWithFallback<T>(input: {
  request?: DesktopDeliveryRequest;
  background: (target: DesktopDeliveryTarget) => Promise<DesktopDeliveryAttempt<T>>;
  foreground: (target: DesktopDeliveryTarget) => Promise<DesktopDeliveryAttempt<T>>;
}): Promise<{ value: T; delivery: DesktopDeliveryResult }> {
  const request = input.request || {};
  const requestedMode = normalizeDesktopDeliveryMode(request.requestedMode);
  const target = normalizeDesktopDeliveryTarget(request.target);
  const allowFallback = request.allowForegroundFallback !== false;

  if (requestedMode === 'foreground') {
    return foregroundMetadata(requestedMode, target, await input.foreground(target), {
      backgroundAttempted: false,
      foregroundFallbackUsed: false,
    });
  }

  if (!hasStrongBackgroundTarget(target)) {
    if (!allowFallback) {
      throw new DesktopBackgroundDeliveryUnsupportedError('Background delivery requires a positive exact window handle or pid.');
    }
    return foregroundMetadata(requestedMode, target, await input.foreground(target), {
      backgroundAttempted: false,
      foregroundFallbackUsed: true,
      fallbackReason: 'Background target identity unavailable; used foreground compatibility lane.',
    });
  }

  try {
    const result = await input.background(target);
    // This is intentionally strict: "no error" is not proof that PostMessage,
    // postToPid, UIA, or another background mechanism actually affected the app.
    if (result.verified !== true) {
      throw new DesktopBackgroundDeliveryNoopError(
        result.verification || 'Background action returned without an explicit positive verification.',
      );
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
    return foregroundMetadata(requestedMode, target, await input.foreground(target), {
      backgroundAttempted: true,
      foregroundFallbackUsed: true,
      fallbackReason: String((error as any)?.message || error || 'Background delivery failed verification.'),
    });
  }
}
