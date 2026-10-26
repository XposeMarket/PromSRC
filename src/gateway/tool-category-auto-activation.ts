import type { ToolCategoryActivationSnapshot } from './session';

export interface AutoActivatedToolCategory {
  category: string;
  surfaceToolCountBefore: number;
  surfaceToolCountAfter: number;
  activationStateBefore: ToolCategoryActivationSnapshot;
}

/** Compatibility seam for chat and voice. TOOL_CATEGORY_MATCH supplies hints;
 * only explicit request_tool_category / declared agent scopes provision tools.
 * Keyword mentions must not mutate the cached tool prefix or load extensions.
 */
export function autoActivateToolCategories(
  _sessionId: string,
  _message: string,
  _historyLength: number,
  mark?: (label: string, fields?: Record<string, unknown>) => void,
): AutoActivatedToolCategory[] {
  mark?.('pre_context.toolcats.hint_only', { provisioned: 0 });
  return [];
}
