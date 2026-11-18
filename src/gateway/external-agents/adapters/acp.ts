import os from 'os';
import path from 'path';
import { findOnPath, resolveFromCandidates, type ResolvedCommand } from '../executable';
import { JsonRpcStdioClient } from '../jsonrpc-stdio';
import { createAcpFileTracker } from '../file-touches';
import type { ExternalAgentAdapter, ExternalAgentCapabilities, ExternalAgentVerifyResult, ExternalTurnInput, ExternalTurnResult } from '../types';

export type AcpAgentId = 'hermes' | 'cursor' | 'openclaw';
const NAMES = { hermes: 'Hermes', cursor: 'Cursor', openclaw: 'OpenClaw' };
// Real cold starts measured on Windows (Nov 2026): OpenClaw ACP ~27 s to answer initialize
// (it boots a Gateway client), Hermes ~20-40 s (plugin discovery + gateway attach).
// A 10 s budget wrongly reported both as unreachable.
const ACP_STARTUP_TIMEOUT_MS = 90000;
const ACP_SESSION_TIMEOUT_MS = 60000;
const CAPS: ExternalAgentCapabilities = { resume: false, interrupt: true, approvals: true, images: false, modelList: false };
interface Options { resolve?: () => ResolvedCommand | null; onOutgoing?: (message: any) => void }
function resolveAgent(id: AcpAgentId): ResolvedCommand | null {
  const configured = process.env[`PROMETHEUS_${id.toUpperCase()}_BIN`];
  const home = os.homedir();
  // Never run an unrelated `agent` from PATH: Grok also uses that executable name.
  const candidates = id === 'cursor'
    ? [...findOnPath('cursor-agent'), path.join(home, '.local', 'bin', 'agent')]
    : [...findOnPath(id), ...(id === 'hermes' ? [
        // Official Windows installer location (a gateway started before install has a stale PATH).
        ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'hermes', 'bin', 'hermes.exe')] : []),
        path.join(home, '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
      ] : [])];
  return resolveFromCandidates([...(configured ? [configured] : []), ...candidates]);
}

/** ACP owns execution. We advertise no host filesystem/terminal tools and never execute observed calls. */
export class AcpAdapter implements ExternalAgentAdapter {
  readonly name: string;
  readonly tile: string;
  readonly capabilities = { ...CAPS };
  private clients = new Set<JsonRpcStdioClient>();
  private catalogs = new Map<string, { models: Array<{ id: string; label: string }>; currentModel?: string }>();
  constructor(readonly id: AcpAgentId, private options: Options = {}) { this.name = NAMES[id]; this.tile = this.name.slice(0, 2); }
  private resolve() { return (this.options.resolve || (() => resolveAgent(this.id)))(); }
  async detect() { const command = this.resolve(); return { found: !!command, ...(command ? { executable: command.source } : {}) }; }
  isRunning() { return [...this.clients].some((client) => client.alive); }
  async shutdown() { await Promise.all([...this.clients].map((client) => client.stop())); this.clients.clear(); }
  private client(command: ResolvedCommand, hooks: Partial<ConstructorParameters<typeof JsonRpcStdioClient>[0]> = {}) {
    const client = new JsonRpcStdioClient({ command: command.command, args: [...command.args, 'acp'], label: this.name, onOutgoing: this.options.onOutgoing, ...hooks });
    this.clients.add(client); return client;
  }
  private async initialize(client: JsonRpcStdioClient) {
    await client.start();
    const result = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'prometheus', version: '1' } }, ACP_STARTUP_TIMEOUT_MS);
    if (result?.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version.');
    this.capabilities.resume = result.agentCapabilities?.loadSession === true;
    return result;
  }
  async verify(): Promise<ExternalAgentVerifyResult> {
    const command = this.resolve();
    if (!command) return { status: 'not_installed', statusText: `${this.name} is not installed on this computer.`, capabilities: this.capabilities };
    const client = this.client(command, { onServerRequest: (request) => client.respondError(request.id, -32601, 'Unavailable during connection check.') });
    try {
      const info = await this.initialize(client);
      if (this.id === 'cursor' && !/cursor/i.test(String(info.agentInfo?.name || ''))) return { status: 'unsupported', statusText: 'This executable did not identify itself as Cursor.', capabilities: this.capabilities };
      return { status: 'ready', statusText: `${this.name} ACP connected. Account readiness is checked by the agent on first send.`, ...(info.agentInfo?.version ? { version: String(info.agentInfo.version) } : {}), capabilities: { ...this.capabilities } };
    } catch { return { status: 'error', statusText: `Cannot connect to ${this.name} ACP. Check its own installation, sign-in${this.id === 'openclaw' ? ' and Gateway pairing' : ''}.`, capabilities: this.capabilities }; }
    finally { await client.stop(); this.clients.delete(client); }
  }
  async listModels(context: { cwd: string; upstreamSessionId?: string }) {
    // ACP supplies models with session creation/load, not a global discovery call.
    // Never create abandoned sessions or reload a working session just to paint a badge.
    return this.catalogs.get(context.upstreamSessionId || '') || { models: [], unavailableReason: 'This agent reports model choices after its session starts. Its own configured model is used for the first message.' };
  }
  async runTurn(input: ExternalTurnInput): Promise<ExternalTurnResult> {
    let upstream = input.upstreamSessionId || '';
    let text = '';
    let acceptingUpdates = false;
    const lifetime = new AbortController();
    const command = this.resolve();
    if (!command) return { upstreamSessionId: upstream, status: 'failed', finalText: '', error: `${this.name} is not installed.` };
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const noteFiles = createAcpFileTracker();
    const client = this.client(command, {
      cwd: input.cwd,
      onExit: () => lifetime.abort(),
      onNotification: (method, params) => {
        if (!acceptingUpdates || params?.sessionId !== upstream || method !== 'session/update') return;
        const update = params.update;
        if (!update) return;
        // Edits the agent reports as done build the end-of-turn file card.
        const touched = noteFiles(update);
        if (touched.length) input.emit({ type: 'file_change', files: touched });
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          text += update.content.text; input.emit({ type: 'text_delta', text: update.content.text });
        } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
          input.emit({ type: 'reasoning_delta', text: update.content.text });
        } else if (update.sessionUpdate === 'tool_call') {
          input.emit({ type: 'item_started', itemId: String(update.toolCallId), kind: 'other', title: String(update.title || 'Agent tool') });
        } else if (update.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(update.status)) {
          input.emit({ type: 'item_completed', itemId: String(update.toolCallId), kind: 'other', ok: update.status === 'completed', summary: String(update.title || update.status) });
        } else if (update.sessionUpdate === 'plan') {
          input.emit({ type: 'notice', text: (update.entries || []).map((entry: any) => `${entry.status}: ${entry.content}`).join('\n') });
        }
      },
      onServerRequest: (request) => {
        const answer = async () => {
          if (!acceptingUpdates || lifetime.signal.aborted || (request.params?.sessionId && request.params.sessionId !== upstream)) {
            client.respondError(request.id, -32000, 'No matching active turn.'); return;
          }
          const p = request.params || {};
          if (request.method === 'session/request_permission') {
            const detailText = JSON.stringify(p.toolCall?.rawInput || {});
            if (detailText.length > 24000) { client.respond(request.id, { outcome: { outcome: 'cancelled' } }); return; }
            const options = (Array.isArray(p.options) ? p.options : []).filter((o: any) => ['allow_once', 'reject_once'].includes(o.kind));
            const response = await input.requestUser({ kind: 'permissions', title: `${this.name}: ${p.toolCall?.title || 'Permission requested'}`,
              detail: { cwd: input.cwd, reason: detailText, files: (p.toolCall?.locations || []).map((location: any) => String(location.path)) },
              options: [...options.map((o: any) => ({ id: String(o.optionId), label: String(o.name), kind: o.kind === 'allow_once' ? 'allow_once' as const : 'deny' as const })), { id: '__cancel', label: 'Cancel', kind: 'cancel' }],
            }, { signal: lifetime.signal, cancelResponse: { optionId: '__cancel' } });
            const selected = !lifetime.signal.aborted && options.find((o: any) => o.optionId === response.optionId);
            client.respond(request.id, { outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } });
          } else if (this.id === 'cursor' && request.method === 'cursor/ask_question') {
            const questions = (p.questions || []).map((q: any) => ({ id: String(q.id), prompt: String(q.prompt), options: q.options, multi: !!q.allowMultiple }));
            const response = await input.requestUser({ kind: 'question', title: String(p.title || 'Cursor has a question'), detail: { questions }, options: [{ id: 'answer', label: 'Send answer', kind: 'answer' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }] }, { signal: lifetime.signal });
            client.respond(request.id, { outcome: !lifetime.signal.aborted && response.optionId === 'answer' ? { outcome: 'answered', answers: questions.map((q: any) => ({ questionId: q.id, selectedOptionIds: response.answers?.[q.id] || [] })) } : { outcome: 'cancelled' } });
          } else if (this.id === 'cursor' && request.method === 'cursor/create_plan') {
            const response = await input.requestUser({ kind: 'plan', title: String(p.name || 'Cursor plan'), detail: { reason: String(p.plan || p.overview || '') }, options: [{ id: 'accept', label: 'Accept plan', kind: 'allow_once' }, { id: 'reject', label: 'Reject plan', kind: 'deny' }] }, { signal: lifetime.signal });
            client.respond(request.id, { outcome: { outcome: lifetime.signal.aborted ? 'cancelled' : response.optionId === 'accept' ? 'accepted' : 'rejected' } });
          } else client.respondError(request.id, -32601, 'Client capability not available. Use the agent\'s own tools.');
        };
        void answer().catch(() => client.respondError(request.id, -32603, 'The request could not be answered.'));
      },
    });
    const stop = () => {
      lifetime.abort();
      if (client.alive && upstream) { try { client.notify('session/cancel', { sessionId: upstream }); } catch { /* process exited */ } }
      stopTimer = setTimeout(() => void client.stop(), 1500);
    };
    input.signal.addEventListener('abort', stop, { once: true });
    try {
      if (input.signal.aborted) return { upstreamSessionId: upstream, status: 'interrupted', finalText: '' };
      const info = await this.initialize(client);
      if (this.id === 'cursor' && !/cursor/i.test(String(info.agentInfo?.name || ''))) throw new Error('Not the Cursor agent.');
      if (input.signal.aborted) return { upstreamSessionId: upstream, status: 'interrupted', finalText: '' };
      input.emit({ type: 'state', phase: upstream ? 'resuming' : 'starting' });
      let modelState;
      if (upstream) {
        if (!info.agentCapabilities?.loadSession) return { upstreamSessionId: upstream, status: 'failed', finalText: '', error: `${this.name} does not support resuming this session. Start a new chat explicitly.` };
        // History emitted during load is already in Prometheus; suppress its replay.
        modelState = await client.request('session/load', { sessionId: upstream, cwd: input.cwd, mcpServers: [] }, ACP_SESSION_TIMEOUT_MS);
      } else {
        const created = await client.request('session/new', { cwd: input.cwd, mcpServers: [] }, ACP_SESSION_TIMEOUT_MS);
        if (typeof created?.sessionId !== 'string' || !created.sessionId || created.sessionId.length > 300) throw new Error('Invalid upstream session identity.');
        upstream = created.sessionId;
        modelState = created;
      }
      const models = (modelState?.models?.availableModels || []).map((m: { modelId: string; name: string }) => ({ id: m.modelId, label: m.name || m.modelId }));
      this.catalogs.set(upstream, { models, currentModel: modelState?.models?.currentModelId });
      if (this.catalogs.size > 200) this.catalogs.delete(this.catalogs.keys().next().value!);
      this.capabilities.modelList = models.length > 0;
      input.onSessionBound?.(upstream);
      if (input.signal.aborted) return { upstreamSessionId: upstream, status: 'interrupted', finalText: '' };
      if (input.model) {
        if (!models.some((m: { id: string }) => m.id === input.model)) throw new Error('Model is not available in this agent session.');
        await client.request('session/set_model', { sessionId: upstream, modelId: input.model }, ACP_SESSION_TIMEOUT_MS);
      }
      acceptingUpdates = true;
      input.emit({ type: 'state', phase: 'running' });
      const result = await client.request('session/prompt', { sessionId: upstream, prompt: [{ type: 'text', text: input.text }] });
      lifetime.abort();
      const interrupted = input.signal.aborted || result?.stopReason === 'cancelled';
      const complete = result?.stopReason === 'end_turn';
      return { upstreamSessionId: upstream, status: interrupted ? 'interrupted' : complete ? 'completed' : 'failed', finalText: text, ...(input.model ? { model: input.model } : {}), ...(!interrupted && !complete ? { error: `${this.name} stopped (${String(result?.stopReason || 'unknown')}).` } : {}) };
    } catch (error: any) {
      const missing = !!input.upstreamSessionId && /(?:session.*(?:not found|does not exist)|unknown session)/i.test(String(error?.message));
      return { upstreamSessionId: upstream, status: input.signal.aborted ? 'interrupted' : 'failed', finalText: text,
        error: missing ? `${this.name} could not find the original session.` : `${this.name} could not complete this turn. Check its own account, configuration and connection.`, ...(missing ? { upstreamMissing: true } : {}) };
    } finally {
      acceptingUpdates = false; lifetime.abort(); input.signal.removeEventListener('abort', stop);
      if (stopTimer) clearTimeout(stopTimer);
      await client.stop(); this.clients.delete(client);
    }
  }
}
