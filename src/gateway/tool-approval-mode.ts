import { getConfig } from '../config/config.js';

export type ToolPermissionMode = 'default' | 'lite';

const EXPLICIT_APPROVAL_REQUEST_TOOLS = new Set([
  'request_final_action_approval',
  'request_dev_source_edit',
]);

export function getToolPermissionMode(): ToolPermissionMode {
  const configured = String(
    (getConfig().getConfig() as any)?.tools?.permissions?.shell?.approval_mode || 'default',
  );
  return configured === 'lite' ? 'lite' : 'default';
}

export function isExplicitApprovalRequestTool(toolName: string): boolean {
  return EXPLICIT_APPROVAL_REQUEST_TOOLS.has(String(toolName || '').trim());
}

/**
 * Bypasses only the generic tool-policy approval wrapper. Explicit approval
 * request tools still execute and create their own approval cards. Elevated
 * commands are never bypassed by Lite mode.
 */
export function shouldBypassGenericToolApproval(
  mode: ToolPermissionMode,
  toolName: string,
  args?: Record<string, any>,
): boolean {
  if (isExplicitApprovalRequestTool(toolName)) return true;
  return mode === 'lite' && args?.elevated !== true;
}
