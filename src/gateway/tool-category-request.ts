import {
  getRuntimeToolCategories,
  normalizeToolCategory,
  normalizeToolArgsForTool,
  type ToolCategory,
  type ToolResult,
} from './tool-builder';
import { activateToolCategory } from './session';
import { canKeepToolCategoryWarm } from './tool-category-retention';

export function handleRequestToolCategory(
  args: any,
  sessionId: string,
  options: { isDevSourceWriteApproved?: () => boolean } = {},
): ToolResult {
  const categoryArgs = normalizeToolArgsForTool('request_tool_category', args);
  const rawCategory = String(categoryArgs?.category || '').trim().toLowerCase();
  const requestedCategory = normalizeToolCategory(rawCategory);
  const rawScope = String(categoryArgs?.scope || 'turn').trim().toLowerCase();
  const requestedScope = rawScope === 'session' || rawScope === 'next_turn' || rawScope === 'ttl' || rawScope === 'turn'
    ? rawScope
    : 'turn';
  const requestedTurns = Math.max(1, Math.min(12, Math.floor(Number(categoryArgs?.turns) || 1)));
  const runtimeCategories = getRuntimeToolCategories();
  if (!rawCategory) {
    return { name: 'request_tool_category', args, result: `request_tool_category requires category. Valid: ${runtimeCategories.join(', ')}`, error: true };
  }
  if (!requestedCategory || !runtimeCategories.includes(requestedCategory as ToolCategory)) {
    return { name: 'request_tool_category', args, result: `Invalid category "${rawCategory}". Valid: ${runtimeCategories.join(', ')}`, error: true };
  }
  if (requestedCategory === 'prometheus_source_write' && options.isDevSourceWriteApproved?.() !== true) {
    return {
      name: 'request_tool_category',
      args,
      result: 'BLOCKED: prometheus_source_write requires an approved dev source edit request or an approved dev src proposal task.',
      error: true,
    };
  }

  activateToolCategory(sessionId, requestedCategory, {
    scope: requestedScope,
    turns: requestedScope === 'ttl' ? requestedTurns : undefined,
  });
  if (requestedCategory === 'external_apps') {
    return {
      name: 'request_tool_category',
      args,
      result: `Tool category "external_apps" activated for ${requestedScope} scope. Connected-app tools are not kept between turns: request it again in a later turn if needed. Use connector_list only if inventory is needed.`,
      error: false,
    };
  }

  const suffix = requestedScope === 'ttl' ? ` (${requestedTurns} user turns)` : '';
  const keepNote = requestedScope !== 'session' && canKeepToolCategoryWarm(requestedCategory)
    ? ' It stays loaded while you keep using its tools.'
    : '';
  return {
    name: 'request_tool_category',
    args,
    result: `Tool category "${requestedCategory}" activated with ${requestedScope} scope${suffix} in session ${sessionId}.${keepNote}`,
    error: false,
  };
}
