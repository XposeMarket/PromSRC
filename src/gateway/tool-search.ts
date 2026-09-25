/**
 * Tool Search bridge (modelled on Hermes tools/tool_search.py and OpenClaw
 * tool_search_code). Connector, MCP and composite tools are not sent to the
 * model up front; three small core tools let it find, inspect, and call them:
 *
 *   tool_search({query})          -> ranked names + one-line summaries
 *   tool_describe({name})         -> full JSON schema for one tool
 *   tool_call({name, arguments})  -> run it (through normal executeTool, so
 *                                    approval/policy gates still apply)
 *
 * tool_call only accepts names that are currently in the searchable catalog
 * (connected connectors, available MCP tools, saved composites). That is the
 * permission boundary: it cannot reach core/category tools or disconnected
 * connectors.
 */
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/legacy-connector-adapter';
import { getExtensionRuntimeRegistry } from '../extensions/runtime-registry';
import { getMCPManager } from './mcp-manager';

export const TOOL_SEARCH_TOOL_NAMES = new Set(['tool_search', 'tool_describe', 'tool_call']);

export interface ToolCatalogEntry {
  name: string;
  source: 'connector' | 'connector_wrapper' | 'mcp' | 'composite';
  group: string;
  description: string;
  parameters: any;
}

const CATALOG_TTL_MS = 5_000;
let catalogCache: { at: number; entries: ToolCatalogEntry[] } | null = null;

function argSummary(parameters: any): string {
  const props = Object.keys(parameters?.properties || {});
  const required = new Set<string>(Array.isArray(parameters?.required) ? parameters.required : []);
  return props.slice(0, 10).map((key) => (required.has(key) ? key : `${key}?`)).join(', ')
    + (props.length > 10 ? ', ...' : '');
}

function oneLine(text: string, max = 140): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

export function buildToolCatalog(options: { force?: boolean } = {}): ToolCatalogEntry[] {
  const now = Date.now();
  if (!options.force && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.entries;
  const entries: ToolCatalogEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: ToolCatalogEntry) => {
    if (!entry.name || seen.has(entry.name)) return;
    seen.add(entry.name);
    entries.push(entry);
  };

  try {
    ensurePrometheusExtensionRuntimeLoaded();
    const registry = getExtensionRuntimeRegistry();
    for (const def of registry.listConnectedConnectorToolDefinitions()) {
      const fn = def?.function || def;
      const name = String(fn?.name || '');
      if (!name) continue;
      push({
        name,
        source: 'connector',
        group: registry.getConnectorIdForTool(name) || 'connector',
        description: String(fn?.description || ''),
        parameters: fn?.parameters || { type: 'object', properties: {} },
      });
    }
  } catch { /* extension runtime optional */ }

  try {
    const { isManagedMcpToolAvailable } = require('../connections/runtime');
    for (const tool of getMCPManager().getAllTools()) {
      try { if (!isManagedMcpToolAvailable(tool.serverId, tool.name)) continue; } catch { /* legacy exposure */ }
      push({
        name: `mcp__${tool.serverId}__${tool.name}`,
        source: 'mcp',
        group: `mcp:${tool.serverId}`,
        description: `[MCP:${tool.serverName}] ${tool.description || ''}`,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      });
    }
  } catch { /* MCP not ready */ }

  try {
    const { getCompositeDefs } = require('./tools/composite-tools');
    for (const def of getCompositeDefs()) {
      const fn = def?.function || def;
      push({
        name: String(fn?.name || ''),
        source: 'composite',
        group: 'composite',
        description: String(fn?.description || ''),
        parameters: fn?.parameters || { type: 'object', properties: {} },
      });
    }
  } catch { /* composites dir may not exist */ }

  catalogCache = { at: now, entries };
  return entries;
}

export function invalidateToolCatalog(): void {
  catalogCache = null;
}

function tokenize(text: string): string[] {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
}

/** Simple BM25-lite scoring over name (x3), group (x2) and description. */
export function searchToolCatalog(query: string, limit = 8, catalog = buildToolCatalog()): Array<ToolCatalogEntry & { score: number }> {
  const terms = tokenize(query);
  if (!terms.length) return catalog.slice(0, limit).map((entry) => ({ ...entry, score: 0 }));
  const scored = catalog.map((entry) => {
    const nameTokens = tokenize(entry.name);
    const groupTokens = tokenize(entry.group);
    const descTokens = tokenize(entry.description);
    let score = 0;
    for (const term of terms) {
      if (entry.name.toLowerCase() === term) score += 10;
      if (nameTokens.includes(term)) score += 3;
      else if (nameTokens.some((token) => token.startsWith(term) || term.startsWith(token))) score += 1.5;
      if (groupTokens.includes(term)) score += 2;
      const hits = descTokens.filter((token) => token === term || token.startsWith(term)).length;
      if (hits) score += 1 + Math.log(hits);
    }
    return { ...entry, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(25, limit)));
}

/** Short prompt/status line: which groups are searchable right now. */
export function summarizeToolCatalog(catalog = buildToolCatalog()): string {
  if (!catalog.length) return '';
  const groups = new Map<string, number>();
  for (const entry of catalog) groups.set(entry.group, (groups.get(entry.group) || 0) + 1);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, count]) => `${group}(${count})`)
    .join(', ');
}

export function getToolSearchDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description:
          'Search the connected-app, MCP and composite tools that are not loaded in your tool list (GitHub, Gmail, Drive, Notion, Slack, MCP servers, saved composites, ...). '
          + 'Returns tool names, argument lists (? = optional) and one-line summaries. Then call tool_call directly; use tool_describe only when you need the full schema.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'What you want to do, e.g. "list github pull requests" or "read gmail thread".' },
            limit: { type: 'number', description: 'Max results. Default 8, max 25.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'tool_describe',
        description: 'Return the full JSON schema and description for one tool found with tool_search.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', description: 'Exact tool name from tool_search.' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'tool_call',
        description:
          'Call a connected-app, MCP or composite tool found with tool_search. Normal approval gates apply (sends, merges, posts still ask). '
          + 'Only tools returned by tool_search are callable here.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Exact tool name from tool_search.' },
            arguments: { type: 'object', description: 'Arguments for that tool.' },
          },
        },
      },
    },
  ];
}

export type ToolSearchExecute = (name: string, args: any) => Promise<{ name: string; args: any; result: string; error: boolean; [key: string]: any }>;

export async function handleToolSearchTool(
  name: string,
  args: any,
  execute: ToolSearchExecute,
): Promise<{ name: string; args: any; result: string; error: boolean; [key: string]: any } | null> {
  if (!TOOL_SEARCH_TOOL_NAMES.has(name)) return null;
  const catalog = buildToolCatalog();

  if (name === 'tool_search') {
    const query = String(args?.query || args?.q || '').trim();
    const limit = Math.floor(Number(args?.limit) || 8);
    if (!catalog.length) {
      return { name, args, result: 'No connected-app, MCP or composite tools are available. Use connector_list to see what is connected, or connection_ops (integration_admin) to connect one.', error: false };
    }
    const hits = searchToolCatalog(query, limit, catalog);
    if (!hits.length) {
      return { name, args, result: `No tools matched "${query}". Searchable groups: ${summarizeToolCatalog(catalog)}.`, error: false };
    }
    const lines = hits.map((hit) => `- ${hit.name}(${argSummary(hit.parameters)}) [${hit.group}]: ${oneLine(hit.description)}`);
    return {
      name,
      args,
      result: `${hits.length} match(es) for "${query}":\n${lines.join('\n')}\nCall with tool_call({"name":"<tool>","arguments":{...}}).`,
      error: false,
    };
  }

  const target = String(args?.name || args?.tool || '').trim();
  const entry = catalog.find((item) => item.name === target);
  if (!entry) {
    const suggestions = target ? searchToolCatalog(target.replace(/_/g, ' '), 5, catalog).map((hit) => hit.name) : [];
    return {
      name,
      args,
      result: `"${target || '(missing name)'}" is not in the searchable tool catalog.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''} Use tool_search first.`,
      error: true,
    };
  }

  if (name === 'tool_describe') {
    return {
      name,
      args,
      result: JSON.stringify({ name: entry.name, group: entry.group, source: entry.source, description: entry.description, parameters: entry.parameters }, null, 2).slice(0, 12_000),
      error: false,
    };
  }

  let callArgs = args?.arguments ?? args?.args ?? args?.input ?? {};
  if (typeof callArgs === 'string') {
    try { callArgs = JSON.parse(callArgs); } catch { return { name, args, result: 'tool_call arguments must be an object (or a JSON object string).', error: true }; }
  }
  const required: string[] = Array.isArray(entry.parameters?.required) ? entry.parameters.required : [];
  const missing = required.filter((key) => callArgs?.[key] === undefined || callArgs?.[key] === null || callArgs?.[key] === '');
  if (missing.length) {
    return { name, args, result: `${entry.name} is missing required argument(s): ${missing.join(', ')}. Arguments: ${argSummary(entry.parameters)}`, error: true };
  }
  const result = await execute(entry.name, callArgs || {});
  return { ...result, name: entry.name };
}
