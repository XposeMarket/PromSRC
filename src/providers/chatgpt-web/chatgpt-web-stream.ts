/**
 * chatgpt-web-stream.ts
 *
 * Incremental parser for the chatgpt.com /backend-api/conversation SSE stream
 * ("v1" delta encoding). Pure and side-effect free so it can be regression
 * tested against captured streams.
 *
 * Wire format (captured 2026-09-25):
 *   event: delta_encoding / data: "v1"
 *   data: {"type":"resume_conversation_token",...}             control frame
 *   data: {"p":"","o":"add","v":{"message":{...}}}             new message
 *   data: {"v":{"message":{...}}}                              new message (implicit add)
 *   data: {"p":"/message/content/parts/0","o":"append","v":"x"} append to current message
 *   data: {"v":"x"}                                            repeat previous path/op
 *   data: {"p":"","o":"patch","v":[{p,o,v},...]}               batch of ops
 *   data: {"type":"message_marker"|"url_moderation"|"server_ste_metadata"|"message_stream_complete",...}
 *   data: [DONE]
 *
 * Message kinds that matter to Prometheus:
 *   assistant -> recipient "all", content_type "text"      final answer text (streamed)
 *   assistant -> content_type "thoughts" | "reasoning_recap" reasoning summaries
 *   assistant -> recipient != "all"                         ChatGPT invoking one of its own tools
 *   tool (author.name = "web.run", MCP connector, ...)      tool output
 */

export type ChatGPTWebStreamEvent =
  | { type: 'text_delta'; text: string; messageId: string }
  | { type: 'reasoning'; text: string; messageId: string }
  | { type: 'tool_start'; id: string; name: string; args: string; connector?: ConnectorCall }
  | { type: 'tool_result'; id: string; name: string; result: string; error?: boolean; connector?: ConnectorCall }
  | { type: 'conversation'; conversationId: string }
  | { type: 'model'; model: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** A call ChatGPT made to an app/connector (api_tool.call_tool). */
export interface ConnectorCall {
  /** Connector display name from the call path, e.g. "Prometheus". */
  connector: string;
  /** Tool name on that connector, e.g. "read_file". */
  tool: string;
  args: unknown;
}

/** api_tool.call_tool payload: {"path":"/<Connector>/<link_id>/<tool>","args":{...}}. */
export function parseConnectorCall(text: string): ConnectorCall | null {
  let parsed: any;
  try { parsed = JSON.parse(String(text || '')); } catch { return null; }
  const segments = String(parsed?.path || '').split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return { connector: segments[0], tool: segments[segments.length - 1], args: parsed?.args ?? {} };
}

interface TrackedMessage {
  id: string;
  role: string;
  authorName: string;
  recipient: string;
  contentType: string;
  channel: string;
  parts: string[];
  thoughts: Array<{ summary?: string; content?: string }>;
  recap: string;
  metadata: Record<string, any>;
  status: string;
  /** Characters of parts[0] already emitted as text_delta. */
  emittedChars: number;
  /** Reasoning strings already emitted, to avoid duplicates on patch updates. */
  emittedReasoning: Set<string>;
  toolStarted: boolean;
  toolFinished: boolean;
  connectorCall?: ConnectorCall;
}

const CITE_OPEN = '\ue200';
const CITE_CLOSE = '\ue201';

/** Remove complete ChatGPT citation markers (\ue200cite\ue202turn0search1\ue201). */
export function stripCitationMarkers(text: string): string {
  return String(text || '').replace(/\ue200[^\ue200\ue201]*\ue201/g, '');
}

/** Replace citation markers with the markdown links ChatGPT supplied in content_references. */
export function applyContentReferences(text: string, references: any[]): string {
  let out = String(text || '');
  const refs = Array.isArray(references) ? references : [];
  for (const ref of refs) {
    const matched = typeof ref?.matched_text === 'string' ? ref.matched_text : '';
    // Only replace citation markers. Some references (sources_footnote) carry
    // matched_text " " and would otherwise wipe every space in the answer.
    if (!matched || !/[\ue200-\ue202]/.test(matched) || !out.includes(matched)) continue;
    const alt = typeof ref?.alt === 'string' ? ref.alt : '';
    out = out.split(matched).join(alt ? ` ${alt.trim()}` : '');
  }
  return stripCitationMarkers(out).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
}

function friendlyToolName(raw: string): string {
  const name = String(raw || '').trim();
  if (!name) return 'chatgpt_tool';
  if (/^web(\.run|\.search)?$/.test(name) || name === 'browser' || name === 'web') return 'chatgpt_web_search';
  if (/^python|^jupyter/.test(name)) return 'chatgpt_python';
  if (/image_gen|dalle|t2uay3k/.test(name)) return 'chatgpt_image_gen';
  if (/^canmore/.test(name)) return 'chatgpt_canvas';
  if (/^file_search|^myfiles/.test(name)) return 'chatgpt_file_search';
  if (/^bio$/.test(name)) return 'chatgpt_memory';
  // api_tool.list_resources / search_tools: ChatGPT looking up which app tools exist.
  if (/^api_tool\.(list|search)/.test(name)) return 'chatgpt_app_tool_search';
  if (/^api_tool|^mcp|connector/.test(name)) return 'chatgpt_connector';
  return `chatgpt_${name.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'tool'}`;
}

function summarizeToolResult(msg: TrackedMessage): string {
  const md = msg.metadata || {};
  const lines: string[] = [];
  const queries = md.search_model_queries?.queries;
  if (Array.isArray(queries) && queries.length) lines.push(`Searched: ${queries.map((q: any) => String(q)).join(' | ')}`);
  const groups = Array.isArray(md.search_result_groups) ? md.search_result_groups : [];
  for (const group of groups.slice(0, 8)) {
    for (const entry of (Array.isArray(group?.entries) ? group.entries : []).slice(0, 2)) {
      const title = String(entry?.title || '').trim();
      const url = String(entry?.url || '').trim();
      if (url) lines.push(`- ${title ? `${title} ` : ''}${url}`);
    }
  }
  const text = msg.parts.filter((p) => typeof p === 'string').join('').trim();
  if (text) lines.push(text.slice(0, 4000));
  if (!lines.length && md.reasoning_title) lines.push(String(md.reasoning_title));
  return lines.join('\n').slice(0, 6000) || 'Done.';
}

export class ChatGPTWebStreamParser {
  private messages = new Map<string, TrackedMessage>();
  private current: TrackedMessage | null = null;
  private lastPath = '';
  private lastOp = '';
  private finalMessageId = '';
  private pendingToolIds: string[] = [];
  private conversationId = '';
  private modelSlug = '';
  private buffer = '';
  private done = false;

  /** Feed raw SSE text (any chunking). Returns the events produced by complete lines. */
  push(chunk: string): ChatGPTWebStreamEvent[] {
    this.buffer += chunk;
    const events: ChatGPTWebStreamEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.consumeLine(line, events);
      newline = this.buffer.indexOf('\n');
    }
    return events;
  }

  /** Flush any trailing partial line and close open tool rows. */
  end(): ChatGPTWebStreamEvent[] {
    const events: ChatGPTWebStreamEvent[] = [];
    if (this.buffer.trim()) this.consumeLine(this.buffer, events);
    this.buffer = '';
    for (const msg of this.messages.values()) this.flushText(msg, events, true);
    for (const id of this.pendingToolIds.splice(0)) {
      const msg = this.messages.get(id);
      if (msg && !msg.toolFinished) {
        msg.toolFinished = true;
        events.push({ type: 'tool_result', id, name: friendlyToolName(msg.recipient), result: 'Done.', ...(msg.connectorCall ? { connector: msg.connectorCall } : {}) });
      }
    }
    if (!this.done) {
      this.done = true;
      events.push({ type: 'done' });
    }
    return events;
  }

  getConversationId(): string { return this.conversationId; }
  getModelSlug(): string { return this.modelSlug; }

  /** Final answer text with citations rendered as markdown links. */
  getFinalText(): string {
    const finals = [...this.messages.values()].filter((m) => this.isFinalText(m));
    if (!finals.length) return '';
    return finals
      .map((m) => applyContentReferences(m.parts.join(''), m.metadata?.content_references))
      .join('\n\n')
      .trim();
  }

  private consumeLine(line: string, events: ChatGPTWebStreamEvent[]): void {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      for (const ev of this.end()) events.push(ev);
      return;
    }
    let json: any;
    try { json = JSON.parse(data); } catch { return; }
    if (typeof json === 'string') return; // "v1" delta_encoding announcement
    if (json && typeof json === 'object' && typeof json.type === 'string' && !('v' in json)) {
      this.consumeControl(json, events);
      return;
    }
    if (json?.error) {
      events.push({ type: 'error', message: typeof json.error === 'string' ? json.error : JSON.stringify(json.error).slice(0, 400) });
      return;
    }
    if (typeof json?.conversation_id === 'string') this.noteConversation(json.conversation_id, events);
    this.applyOp(json, events);
  }

  private consumeControl(json: any, events: ChatGPTWebStreamEvent[]): void {
    if (typeof json.conversation_id === 'string') this.noteConversation(json.conversation_id, events);
    if (json.type === 'message_stream_complete') {
      for (const ev of this.end()) events.push(ev);
    }
  }

  private noteConversation(id: string, events: ChatGPTWebStreamEvent[]): void {
    if (id && id !== this.conversationId) {
      this.conversationId = id;
      events.push({ type: 'conversation', conversationId: id });
    }
  }

  private applyOp(op: any, events: ChatGPTWebStreamEvent[]): void {
    if (!op || typeof op !== 'object') return;
    const hasPath = typeof op.p === 'string';
    const path = hasPath ? op.p : this.lastPath;
    const kind = typeof op.o === 'string' ? op.o : (hasPath ? 'replace' : (this.lastOp || 'add'));
    const value = op.v;

    if (kind === 'patch' && Array.isArray(value)) {
      for (const sub of value) this.applyOp(sub, events);
      this.lastPath = path;
      this.lastOp = kind;
      return;
    }

    if (value && typeof value === 'object' && !Array.isArray(value) && value.message && (path === '' || !hasPath)) {
      this.addMessage(value.message, events);
      if (typeof value.conversation_id === 'string') this.noteConversation(value.conversation_id, events);
      this.lastPath = '';
      this.lastOp = 'add';
      return;
    }

    if (!this.current) return;
    this.lastPath = path;
    this.lastOp = kind;
    this.applyToMessage(this.current, path, kind, value, events);
  }

  private addMessage(raw: any, events: ChatGPTWebStreamEvent[]): void {
    const id = String(raw?.id || '');
    if (!id) return;
    const content = raw?.content || {};
    const msg: TrackedMessage = {
      id,
      role: String(raw?.author?.role || ''),
      authorName: String(raw?.author?.name || ''),
      recipient: String(raw?.recipient || 'all'),
      contentType: String(content?.content_type || ''),
      channel: String(raw?.channel || ''),
      // content_type "code" (tool calls / tool JSON output) carries text in content.text.
      parts: Array.isArray(content?.parts)
        ? content.parts.map((p: any) => (typeof p === 'string' ? p : ''))
        : (typeof content?.text === 'string' ? [content.text] : []),
      thoughts: Array.isArray(content?.thoughts) ? content.thoughts : [],
      recap: typeof content?.content === 'string' ? content.content : '',
      metadata: raw?.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {},
      status: String(raw?.status || ''),
      emittedChars: 0,
      emittedReasoning: new Set(),
      toolStarted: false,
      toolFinished: false,
    };
    this.messages.set(id, msg);
    this.current = msg;
    const slug = String(msg.metadata.model_slug || msg.metadata.default_model_slug || '');
    if (slug && slug !== this.modelSlug && msg.role === 'assistant') {
      this.modelSlug = slug;
      events.push({ type: 'model', model: slug });
    }
    this.onMessageUpdated(msg, events);
  }

  private applyToMessage(msg: TrackedMessage, path: string, kind: string, value: any, events: ChatGPTWebStreamEvent[]): void {
    const partMatch = /^\/message\/content\/parts\/(\d+)$/.exec(path) || (path === '/message/content/text' ? [path, '0'] : null);
    if (partMatch) {
      const index = Number(partMatch[1]);
      while (msg.parts.length <= index) msg.parts.push('');
      if (kind === 'append') msg.parts[index] += typeof value === 'string' ? value : '';
      else if (kind === 'replace' || kind === 'add') msg.parts[index] = typeof value === 'string' ? value : '';
    } else if (path === '/message/content/thoughts' && Array.isArray(value)) {
      msg.thoughts = kind === 'append' ? [...msg.thoughts, ...value] : value;
    } else if (/^\/message\/content\/thoughts\/\d+\/(content|summary)$/.exec(path)) {
      const [, idx, field] = /^\/message\/content\/thoughts\/(\d+)\/(content|summary)$/.exec(path)!;
      const i = Number(idx);
      while (msg.thoughts.length <= i) msg.thoughts.push({});
      const prior = String((msg.thoughts[i] as any)[field] || '');
      (msg.thoughts[i] as any)[field] = kind === 'append' ? prior + String(value ?? '') : String(value ?? '');
    } else if (path === '/message/content/content') {
      msg.recap = kind === 'append' ? msg.recap + String(value ?? '') : String(value ?? '');
    } else if (path === '/message/status') {
      msg.status = String(value || '');
    } else if (path === '/message/metadata') {
      if (value && typeof value === 'object') msg.metadata = { ...msg.metadata, ...value };
    } else if (path.startsWith('/message/metadata/')) {
      const key = path.slice('/message/metadata/'.length).split('/')[0];
      if (key) msg.metadata[key] = value;
    } else if (path === '/message/recipient') {
      msg.recipient = String(value || 'all');
    } else if (path === '/message/channel') {
      msg.channel = String(value || '');
    }
    this.onMessageUpdated(msg, events);
  }

  private isFinalText(msg: TrackedMessage): boolean {
    return msg.role === 'assistant'
      && msg.recipient === 'all'
      && msg.contentType === 'text'
      && (!msg.channel || msg.channel === 'final')
      && !msg.metadata?.is_visually_hidden_from_conversation;
  }

  private onMessageUpdated(msg: TrackedMessage, events: ChatGPTWebStreamEvent[]): void {
    if (msg.role === 'system' || msg.role === 'user') return;

    // ChatGPT invoking one of its own tools (web.run, python, an MCP connector...).
    if (msg.role === 'assistant' && msg.recipient && msg.recipient !== 'all') {
      // functions.exec is ChatGPT's code-mode wrapper around nested tool calls
      // (seen wrapping api_tool.call_tool); the nested call gets its own row.
      if (msg.recipient === 'functions.exec') {
        if (!msg.toolStarted) { msg.toolStarted = true; msg.toolFinished = true; }
        this.emitReasoning(msg, String(msg.metadata?.reasoning_title || ''), events);
        return;
      }
      if (!msg.toolStarted) {
        // App/connector calls stream their {path,args} payload; wait until it
        // parses so the row carries the real connector tool name.
        const isConnector = /^api_tool/.test(msg.recipient);
        const call = isConnector ? parseConnectorCall(msg.parts.join('')) : null;
        const settled = msg.status === 'finished_successfully' || msg.metadata?.is_complete === true;
        if (isConnector && !call && !settled) return;
        msg.toolStarted = true;
        if (call) msg.connectorCall = call;
        this.pendingToolIds.push(msg.id);
        events.push({
          type: 'tool_start',
          id: msg.id,
          name: call ? `chatgpt_app_${call.tool}` : friendlyToolName(msg.recipient),
          args: call ? JSON.stringify(call.args ?? {}) : this.toolArgs(msg),
          ...(call ? { connector: call } : {}),
        });
      }
      this.emitReasoning(msg, String(msg.metadata?.reasoning_title || ''), events);
      return;
    }

    // Tool output: close the oldest open tool row with a readable summary.
    if (msg.role === 'tool') {
      // ChatGPT paused for its own "Allow ChatGPT to use <app>?" prompt; the
      // turn ends here and there is no answer text to wait for.
      const serverAction = msg.metadata?.jit_plugin_data?.from_server;
      if (serverAction?.type === 'confirm_action' && !msg.toolFinished) {
        msg.toolFinished = true;
        events.push({ type: 'error', message: 'ChatGPT paused to ask for confirmation before running an app tool. Set the Prometheus app to "Full access" in ChatGPT Settings -> Apps (Prometheus applies this automatically on the next turn).' });
        return;
      }
      this.emitReasoning(msg, String(msg.metadata?.reasoning_title || ''), events);
      const settled = msg.status === 'finished_successfully' || msg.status === 'finished_partial_completion' || msg.status === 'failed';
      if (!settled) return;
      const hasPayload = msg.parts.some((p) => p && p.trim()) || msg.metadata?.search_result_groups || msg.metadata?.search_model_queries;
      if (!hasPayload && !msg.metadata?.reasoning_title) return;
      // Close the open call this output answers: same recipient/author name
      // (nested calls, e.g. functions.exec wrapping api_tool.call_tool, finish
      // inner-first), falling back to the oldest open call.
      const toolId = this.pendingToolIds.find((id) => this.messages.get(id)?.recipient === msg.authorName) || this.pendingToolIds[0];
      if (!toolId) return;
      const owner = this.messages.get(toolId);
      if (!owner || owner.toolFinished) return;
      // Keep the row open while search queries arrive; close on results/text.
      if (!msg.metadata?.search_result_groups && !msg.parts.some((p) => p && p.trim()) && msg.metadata?.search_model_queries) {
        return;
      }
      owner.toolFinished = true;
      this.pendingToolIds = this.pendingToolIds.filter((id) => id !== toolId);
      events.push({
        type: 'tool_result',
        id: toolId,
        name: owner.connectorCall ? `chatgpt_app_${owner.connectorCall.tool}` : friendlyToolName(owner.recipient || msg.authorName),
        result: summarizeToolResult(msg),
        error: msg.status === 'failed',
        ...(owner.connectorCall ? { connector: owner.connectorCall } : {}),
      });
      return;
    }

    if (msg.role !== 'assistant') return;

    if (msg.contentType === 'thoughts') {
      for (const thought of msg.thoughts) {
        const text = [thought?.summary, thought?.content].map((v) => String(v || '').trim()).filter(Boolean).join(': ');
        this.emitReasoning(msg, text, events);
      }
      return;
    }
    if (msg.contentType === 'reasoning_recap') return;

    this.emitReasoning(msg, String(msg.metadata?.reasoning_title || ''), events);
    if (this.isFinalText(msg)) {
      this.finalMessageId = msg.id;
      this.flushText(msg, events, false);
    }
  }

  private emitReasoning(msg: TrackedMessage, text: string, events: ChatGPTWebStreamEvent[]): void {
    const value = String(text || '').trim();
    if (!value || msg.emittedReasoning.has(value)) return;
    msg.emittedReasoning.add(value);
    events.push({ type: 'reasoning', text: value, messageId: msg.id });
  }

  /**
   * Emit newly appended final-answer text, holding back anything after an
   * unclosed citation marker so markers split across chunks never leak.
   */
  private flushText(msg: TrackedMessage, events: ChatGPTWebStreamEvent[], final: boolean): void {
    if (!this.isFinalText(msg)) return;
    const full = msg.parts.join('');
    let safeEnd = full.length;
    const open = full.lastIndexOf(CITE_OPEN);
    if (!final && open !== -1 && full.indexOf(CITE_CLOSE, open) === -1) safeEnd = open;
    if (safeEnd <= msg.emittedChars) return;
    const slice = stripCitationMarkers(full.slice(msg.emittedChars, safeEnd)).replace(/[\ue200-\ue202]/g, '');
    msg.emittedChars = safeEnd;
    if (slice) events.push({ type: 'text_delta', text: slice, messageId: msg.id });
  }

  private toolArgs(msg: TrackedMessage): string {
    const text = msg.parts.join('').trim();
    if (text) return text.slice(0, 4000);
    const title = String(msg.metadata?.reasoning_title || '').trim();
    return title ? JSON.stringify({ step: title }) : '{}';
  }
}
