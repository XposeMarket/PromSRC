/**
 * chatgpt-bridge.router.ts
 *
 * Minimal MCP server (Streamable HTTP, JSON responses) that ChatGPT calls
 * when it runs as a Prometheus model and wants a Prometheus tool.
 *
 *   POST /mcp/chatgpt/:secret   JSON-RPC 2.0: initialize, ping, tools/list, tools/call
 *   GET  /mcp/chatgpt/:secret   405 (no server-initiated stream)
 *
 * Security boundary:
 *   - Mounted BEFORE gateway auth because ChatGPT's servers cannot present a
 *     gateway token. Access instead requires the per-install secret in the
 *     URL (constant-time compared).
 *   - tools/call only runs while a Prometheus chat turn is actively being
 *     answered by ChatGPT, and executes inside that turn through the normal
 *     tool executor, so approvals, blocked-command rules, and audit logging
 *     all still apply.
 *   - tools/list advertises the Prometheus tool surface so ChatGPT can
 *     snapshot it; tools/call is limited to the ACTIVE turn's own tool
 *     surface, so nothing beyond what that turn could already call runs.
 */

import express from 'express';
import { isValidChatGPTBridgeSecret, logBridgeEvent } from '../../providers/chatgpt-web/chatgpt-bridge-registry';
import { activeChatGPTBridgeTurnCount, getActiveChatGPTBridgeTurn, getChatGPTBridgeCatalog, routeChatGPTBridgeCall, type BridgeToolSpec } from '../../providers/chatgpt-web/chatgpt-bridge-sessions';

/**
 * Catalog for tools/list before any ChatGPT turn has run in this process
 * (ChatGPT snapshots tools when the connector is registered/refreshed). Set by
 * the gateway at startup to the core main-chat tool surface; listing never
 * grants execution, which still requires an active ChatGPT turn.
 */
let fallbackCatalog: () => BridgeToolSpec[] = () => [];
export function setChatGPTBridgeFallbackCatalog(provider: () => BridgeToolSpec[]): void {
  fallbackCatalog = provider;
}

export const router = express.Router();

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'prometheus', version: '1.0.0' };
const MAX_RESULT_CHARS = 60_000;

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** OpenAI function schema -> MCP inputSchema (must be a JSON object schema). */
function toInputSchema(parameters: any): Record<string, unknown> {
  if (parameters && typeof parameters === 'object' && parameters.type === 'object') return parameters;
  return { type: 'object', properties: {}, additionalProperties: true };
}

const READ_ONLY_HINT = /^(read_|list_|get_|search|grep|stat|file_tree|web_search|web_fetch|memory_search|skill_list|skill_read|connector_list|tool_search|tool_describe)/;

/** Every short string value in ChatGPT's _meta / request headers (conversation ids live here). */
function collectRouteCandidates(message: any, headers?: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') { if (value.length >= 8 && value.length <= 200) out.add(value); return; }
    if (Array.isArray(value)) { value.slice(0, 20).forEach((v) => visit(v, depth + 1)); return; }
    if (typeof value === 'object') Object.values(value as Record<string, unknown>).slice(0, 40).forEach((v) => visit(v, depth + 1));
  };
  visit(message?.params?._meta, 0);
  visit(message?.params?.arguments?._meta, 0);
  for (const [key, value] of Object.entries(headers || {})) {
    if (/conversation|openai|chatgpt|session|request/i.test(key)) visit(value, 0);
  }
  return [...out];
}

export async function handleBridgeRpc(message: JsonRpcRequest, headers?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const id = message?.id;
  const method = String(message?.method || '');
  const isNotification = id === undefined;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: String(message?.params?.protocolVersion || PROTOCOL_VERSION),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'Prometheus tools on the user\'s own computer. Only available while ChatGPT is running as the Prometheus chat model.',
    });
  }
  if (method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpcResult(id, {});

  try {
    logBridgeEvent({ event: 'rpc', method, tool: method === 'tools/call' ? String(message?.params?.name || '') : undefined, activeTurn: !!getActiveChatGPTBridgeTurn() });
  } catch { /* diagnostics only */ }
  if (method === 'tools/list') {
    const tools = getChatGPTBridgeCatalog(fallbackCatalog).map((tool) => ({
      name: tool.name,
      description: String(tool.description || '').slice(0, 1_000),
      inputSchema: toInputSchema(tool.parameters),
      annotations: READ_ONLY_HINT.test(tool.name) ? { readOnlyHint: true } : { readOnlyHint: false },
    }));
    return rpcResult(id, { tools });
  }

  if (method === 'tools/call') {
    const name = String(message?.params?.name || '');
    const rawArgs = message?.params?.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};
    const { _meta: _ignoredMeta, ...args } = rawArgs as Record<string, unknown>;
    const routed = routeChatGPTBridgeCall({ candidateIds: collectRouteCandidates(message, headers), toolName: name });
    try {
      logBridgeEvent({ event: 'route', tool: name, via: routed.turn ? routed.via : undefined, reason: routed.turn ? undefined : routed.reason, liveTurns: activeChatGPTBridgeTurnCount(), session: routed.turn?.sessionId });
    } catch { /* diagnostics only */ }
    if (!routed.turn) {
      const text = routed.reason === 'idle'
        ? 'Prometheus bridge is idle: tools only run while ChatGPT is answering inside Prometheus.'
        : routed.reason === 'ambiguous'
          ? 'Several Prometheus chats are using ChatGPT at once and this call could not be matched to its chat, so it was not run. Retry the call.'
          : `Tool "${name}" is not available in this Prometheus turn.`;
      return rpcResult(id, { isError: true, content: [{ type: 'text', text }] });
    }
    const turn = routed.turn;
    try {
      const out = await turn.executeTool(name, args);
      const text = String(out.result ?? '').slice(0, MAX_RESULT_CHARS) || (out.error ? 'Tool failed.' : 'Done.');
      return rpcResult(id, { isError: !!out.error, content: [{ type: 'text', text }] });
    } catch (error: any) {
      return rpcResult(id, { isError: true, content: [{ type: 'text', text: `Tool error: ${String(error?.message || error).slice(0, 2_000)}` }] });
    }
  }

  if (isNotification) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

router.all('/mcp/chatgpt/:secret', express.json({ limit: '2mb' }), async (req, res) => {
  if (!isValidChatGPTBridgeSecret(req.params.secret)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (req.method === 'GET') {
    res.status(405).set('Allow', 'POST').json({ error: 'Server-initiated streams are not supported' });
    return;
  }
  if (req.method === 'DELETE') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).set('Allow', 'POST').end();
    return;
  }
  const body = req.body;
  const batch = Array.isArray(body) ? body : [body];
  const responses: Array<Record<string, unknown>> = [];
  for (const message of batch) {
    const reply = await handleBridgeRpc(message || {}, req.headers as Record<string, unknown>);
    if (reply) responses.push(reply);
  }
  if (!responses.length) {
    res.status(202).end();
    return;
  }
  res.status(200).json(Array.isArray(body) ? responses : responses[0]);
});
