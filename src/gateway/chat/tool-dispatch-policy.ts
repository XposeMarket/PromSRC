/**
 * Dispatch-time tool policy for the shared turn loop (handleChat).
 *
 * A model can only *request* a tool; the runtime decides whether that request
 * is dispatched. Before this existed the provider-facing tool list was a hint:
 * an un-offered tool (desktop_screenshot with desktop_automation inactive, or
 * anything outside a subagent's allowed_tools filter) still executed, an
 * unknown name raised an approval card before failing, and truncated argument
 * JSON silently ran the tool with {}. Replay scenarios that pin this down live
 * in src/testing/replay/scenarios.ts.
 *
 * Refusal rules, in order:
 *  1. No name / a name the runtime does not know  -> unknown_tool.
 *  2. Not offered this turn and the run has an allowlist filter -> not_offered.
 *  3. Not offered this turn and it belongs to a requestable tool category that
 *     is not active -> not_offered (with the request_tool_category hint).
 *  4. Arguments that are not a JSON object -> malformed_arguments.
 * A known tool that is not on the schema surface but is still legitimately
 * dispatchable (compat aliases, direct connector tools behind an active
 * connector wrapper) is allowed and reported as a warning so it stays visible.
 */

export type ToolSurfaceEnforcementMode = 'enforce' | 'warn' | 'off';

export type ToolDispatchCode = 'unknown_tool' | 'not_offered' | 'malformed_arguments';

export type ToolDispatchDecision =
  | { ok: true; warning?: { code: ToolDispatchCode; message: string } }
  | { ok: false; code: ToolDispatchCode; message: string };

export interface ToolDispatchRequest {
  name: string;
  /** Raw provider arguments: a JSON string, an object, or empty. */
  rawArguments: unknown;
  /** Tool names offered to the model for this call (the live provider surface). */
  offered: ReadonlySet<string>;
  mode: ToolSurfaceEnforcementMode;
  /** True when the run has an explicit tool allowlist (subagent allowed_tools, task filter). */
  restricted?: boolean;
  /** True when the name exists anywhere in the runtime (any category, connector, MCP, compat alias). */
  isKnownTool(name: string): boolean;
  /** Requestable category that would make the tool available, or null. */
  categoryOf(name: string): string | null;
  /** Whether that category is active for this run. */
  isCategoryActive(category: string): boolean;
}

/** Names whose arguments may legitimately arrive as a bare (non-JSON) string. */
const SHORTHAND_ARGUMENT_TOOLS = new Set(['request_tool_category']);

export function resolveToolSurfaceEnforcementMode(config: any): ToolSurfaceEnforcementMode {
  const env = String(process.env.PROMETHEUS_TOOL_SURFACE_ENFORCEMENT || '').trim().toLowerCase();
  const raw = env || String(config?.runtime?.toolSurfaceEnforcement ?? config?.runtime?.tool_surface_enforcement ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'warn' || raw === 'log') return 'warn';
  return 'enforce';
}

export function toolNameSetOf(toolDefs: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(toolDefs)) return names;
  for (const def of toolDefs as any[]) {
    const name = String(def?.function?.name || def?.name || '').trim();
    if (name) names.add(name);
  }
  return names;
}

/** Returns a parse problem, or null when the arguments are usable. */
export function describeArgumentProblem(name: string, rawArguments: unknown): string | null {
  if (rawArguments == null) return null;
  if (typeof rawArguments === 'object') {
    return Array.isArray(rawArguments) ? 'arguments must be a JSON object, got an array' : null;
  }
  if (typeof rawArguments !== 'string') return `arguments must be a JSON object, got ${typeof rawArguments}`;
  const trimmed = rawArguments.trim();
  if (!trimmed || trimmed === 'null' || trimmed === '{}') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: any) {
    if (SHORTHAND_ARGUMENT_TOOLS.has(name) && !/^[{\[]/.test(trimmed)) return null;
    return `arguments were not valid JSON (${String(err?.message || 'parse error').slice(0, 120)})`;
  }
  if (parsed === null) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (SHORTHAND_ARGUMENT_TOOLS.has(name) && typeof parsed === 'string') return null;
    return `arguments must be a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`;
  }
  return null;
}

function preview(rawArguments: unknown): string {
  const text = typeof rawArguments === 'string' ? rawArguments : (() => { try { return JSON.stringify(rawArguments); } catch { return String(rawArguments); } })();
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 80)} ... ${flat.slice(-60)}` : flat;
}

export function evaluateToolDispatch(request: ToolDispatchRequest): ToolDispatchDecision {
  const name = String(request.name || '').trim();
  if (request.mode === 'off') return { ok: true };

  let refusal: { code: ToolDispatchCode; message: string } | null = null;
  let warning: { code: ToolDispatchCode; message: string } | undefined;

  if (!name || name === 'unknown') {
    refusal = { code: 'unknown_tool', message: 'Unknown tool: the call had no tool name. Nothing was run. Call one of the tools in your function list.' };
  } else if (!request.offered.has(name)) {
    if (!request.isKnownTool(name)) {
      refusal = {
        code: 'unknown_tool',
        message: `Unknown tool: ${name}. No tool with this name exists, so nothing was run and no approval was requested. Use a tool from your function list, or tool_search for connected-app tools.`,
      };
    } else {
      const category = request.categoryOf(name);
      if (request.restricted) {
        refusal = {
          code: 'not_offered',
          message: `Tool not available this turn: ${name} is not in your function list for this run (this agent's tools are restricted), so it was not run. Use a tool from your function list.`,
        };
      } else if (category && !request.isCategoryActive(category)) {
        refusal = {
          code: 'not_offered',
          message: `Tool not available this turn: ${name} belongs to the "${category}" tool category, which is not active, so it was not run. Call request_tool_category({"category":"${category}"}) and then retry ${name}.`,
        };
      } else {
        warning = { code: 'not_offered', message: `${name} is not on this turn's schema surface but is a known dispatchable tool; allowed.` };
      }
    }
  }

  if (!refusal) {
    const problem = describeArgumentProblem(name, request.rawArguments);
    if (problem) {
      refusal = {
        code: 'malformed_arguments',
        message: `Tool call rejected: ${name} ${problem}, so it was not run (running it with empty arguments would do the wrong thing). Received: ${preview(request.rawArguments)}. Re-issue the call with complete JSON arguments; if the payload is large, split it into smaller calls.`,
      };
    }
  }

  if (!refusal) return warning ? { ok: true, warning } : { ok: true };
  if (request.mode === 'warn') return { ok: true, warning: refusal };
  return { ok: false, ...refusal };
}

/**
 * Consecutive rounds in which the runtime dispatched nothing (every call was
 * refused, loop-blocked or skipped as a duplicate) before the turn is ended.
 * Rounds whose tools ran but failed do not count: failing commands are normal
 * debugging, not a runaway.
 */
export const DEFAULT_IDLE_ROUND_LIMIT = 8;

export function resolveIdleRoundLimit(config: any): number {
  const raw = Number(process.env.PROMETHEUS_IDLE_ROUND_LIMIT || config?.runtime?.idleRoundLimit || config?.runtime?.idle_round_limit || 0);
  return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : DEFAULT_IDLE_ROUND_LIMIT;
}
