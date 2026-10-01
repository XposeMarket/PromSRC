import type { RestartContext } from '../lifecycle';

export const HANDOFF_RESTART_REQUEST = 'gateway_handoff_restart_request';
export const HANDOFF_RESTART_RESULT = 'gateway_handoff_restart_result';

export interface HandoffRestartRequest {
  type: typeof HANDOFF_RESTART_REQUEST;
  id: string;
  forwarded: true;
  context: RestartContext;
}

export interface HandoffRestartResult {
  type: typeof HANDOFF_RESTART_RESULT;
  id: string;
  accepted: boolean;
  pid?: number;
  error?: string;
}

export function isHandoffRestartRequest(value: unknown): value is HandoffRestartRequest {
  const item = value as Partial<HandoffRestartRequest> | null;
  return !!item && item.type === HANDOFF_RESTART_REQUEST && item.forwarded === true
    && typeof item.id === 'string' && item.id.length > 0 && !!item.context
    && typeof item.context === 'object' && typeof item.context.reason === 'string';
}

export function isHandoffRestartResult(value: unknown): value is HandoffRestartResult {
  const item = value as Partial<HandoffRestartResult> | null;
  return !!item && item.type === HANDOFF_RESTART_RESULT && typeof item.id === 'string'
    && typeof item.accepted === 'boolean';
}

/** Only a known draining child can target the current active generation. */
export function handoffRestartTarget<T>(source: T, active: T | null, isDraining: boolean, request: unknown): T | null {
  return isDraining && active && source !== active && isHandoffRestartRequest(request) ? active : null;
}

/** Do not recursively route a request received by another draining generation. */
export function shouldForwardHandoffRestart(draining: boolean, forwarded: boolean): boolean {
  return draining && !forwarded;
}

/** Called by the active child before acknowledging and scheduling a restart. */
export function acceptHandoffRestart(draining: boolean, value: unknown): value is HandoffRestartRequest {
  return !draining && isHandoffRestartRequest(value) && value.context.forwardedFromHandoff === true;
}
