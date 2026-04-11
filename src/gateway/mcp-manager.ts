/**
 * mcp-manager.ts — Prometheus MCP Client
 *
 * Manages connections to external MCP (Model Context Protocol) servers.
 * Supports stdio child-process transport and HTTP/SSE transport.
 *
 * Config stored in ~/.prometheus/mcp-servers.json
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { log } from '../security/log-scrubber';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MCPTransport = 'stdio' | 'sse' | 'http';

export interface MCPServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: MCPTransport;
  // compatibility alias used by some MCP clients/configs
  type?: string;
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse/http transport
  url?: string;
  headers?: Record<string, string>;
  // metadata
  description?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverId: string;
  serverName: string;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

interface MCPSession {
  config: MCPServerConfig;
  process?: ChildProcess;
  tools: MCPTool[];
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  error?: string;
  requestId: number;
  pendingRequests: Map<number, PendingRequest>;
  buffer: string;
  initialized: boolean;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  tools: number;
  toolNames?: string[];
  error?: string;
}

// ─── Manager ──────────────────────────────────────────────────────────────────

export class MCPManager {
  private configPath: string;
  private sessions = new Map<string, MCPSession>();
  private configs: MCPServerConfig[] = [];

  constructor(configDir: string) {
    this.configPath = path.join(configDir, 'mcp-servers.json');
    this.load();
  }

  static normalizeTransport(raw: any): MCPTransport {
    const t = String(raw || '').trim().toLowerCase();
    if (t === 'stdio') return 'stdio';
    if (t === 'sse') return 'sse';
    if (t === 'http' || t === 'streamable_http' || t === 'streamable-http') return 'http';
    return 'stdio';
  }

  private static toStringMap(raw: any): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[String(k)] = String(v);
    }
    return out;
  }

  static normalizeConfig(raw: any, fallbackId = ''): MCPServerConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = String((raw as any).id || fallbackId || '').trim();
    if (!id) return null;

    const name = String((raw as any).name || id).trim() || id;
    const enabled = (raw as any).enabled !== false;
    const hasCommand = typeof (raw as any).command === 'string' && !!String((raw as any).command).trim();
    const hasUrl = typeof (raw as any).url === 'string' && !!String((raw as any).url).trim();
    const transportRaw = (raw as any).transport ?? (raw as any).type ?? (hasCommand ? 'stdio' : (hasUrl ? 'http' : ''));
    const transport = MCPManager.normalizeTransport(transportRaw);

    const cfg: MCPServerConfig = { id, name, enabled, transport };
    if ((raw as any).description) cfg.description = String((raw as any).description);

    if (transport === 'stdio') {
      if (hasCommand) cfg.command = String((raw as any).command).trim();
      if (Array.isArray((raw as any).args)) cfg.args = (raw as any).args.map((v: any) => String(v));
      const env = MCPManager.toStringMap((raw as any).env);
      if (Object.keys(env).length > 0) cfg.env = env;
    } else {
      if (hasUrl) cfg.url = String((raw as any).url).trim();
      const headers = MCPManager.toStringMap((raw as any).headers);
      if (Object.keys(headers).length > 0) cfg.headers = headers;
    }

    return cfg;
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        if (Array.isArray(raw)) {
          this.configs = raw
            .map((c, i) => MCPManager.normalizeConfig(c, `server_${i + 1}`))
            .filter((c): c is MCPServerConfig => !!c);
          return;
        }

        // Compatibility: accept Cursor/Supabase style object config:
        // { "mcpServers": { "supabase": { "url": "...", "type": "http" } } }
        const mcpServers = raw?.mcpServers;
        if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
          this.configs = Object.entries(mcpServers)
            .map(([id, cfg]) => MCPManager.normalizeConfig({ id, ...(cfg as any) }, String(id)))
            .filter((c): c is MCPServerConfig => !!c);
          return;
        }

        this.configs = [];
      }
    } catch (e: any) {
      console.warn('[MCP] Failed to load config:', e.message);
      this.configs = [];
    }
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.configs, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[MCP] Failed to save config:', e.message);
    }
  }

  getConfigs(): MCPServerConfig[] { return this.configs; }

  // ── CRIT-02 fix: validate command before accepting MCP config ─────────────────
  // MCP stdio configs spawn real processes. Validate the command is in the
  // known-safe allowlist so a prompt-injected instruction cannot register
  // an arbitrary binary as an MCP server.
  static validateStdioCommand(command: string): { valid: boolean; reason?: string } {
    if (!command || typeof command !== 'string') {
      return { valid: false, reason: 'command must be a non-empty string' };
    }

    // Resolve just the base executable name (strip path prefix if present)
    const exe = path.basename(command).toLowerCase().replace(/\.exe$/i, '');

    const ALLOWED_EXECUTABLES = new Set([
      // Node / JS runtimes
      'node', 'nodejs', 'npx', 'tsx', 'ts-node',
      // Python runtimes
      'python', 'python3', 'python3.11', 'python3.12', 'uvx', 'uv',
      // Package runners
      'npx', 'pnpx', 'bunx', 'deno',
      // Common MCP server wrappers
      'mcp', 'mcp-server',
    ]);

    if (!ALLOWED_EXECUTABLES.has(exe)) {
      return {
        valid: false,
        reason: `Executable "${exe}" is not in the MCP allowed-command list. ` +
          `Allowed: ${[...ALLOWED_EXECUTABLES].join(', ')}`
      };
    }

    // Block shell metacharacters in command string itself
    if (/[;&|`$><]/.test(command)) {
      return { valid: false, reason: 'command contains shell metacharacters' };
    }

    return { valid: true };
  }

  // ── CRIT-02 / HIGH-04 fix: sanitize env vars ────────────────────────────
  // Prevent attackers from injecting PATH, NODE_OPTIONS, LD_PRELOAD, etc.
  static sanitizeEnv(env: Record<string, string>): Record<string, string> {
    // Explicitly blocked env vars that could hijack process execution
    const BLOCKED_ENV_KEYS = new Set([
      'PATH', 'NODE_OPTIONS', 'NODE_PATH',
      'LD_PRELOAD', 'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', // macOS
      'PYTHONPATH', 'PYTHONSTARTUP',
      'RUBYOPT', 'RUBYLIB',
      'PERL5OPT', 'PERL5LIB',
      'HOME', 'USERPROFILE',  // prevent redirecting home dir
      'TMPDIR', 'TEMP', 'TMP', // prevent temp dir hijacking
      'SHELL', 'COMSPEC',      // prevent shell override
    ]);

    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (BLOCKED_ENV_KEYS.has(k.toUpperCase()) || BLOCKED_ENV_KEYS.has(k)) {
        log.warn('[MCP] Blocked dangerous env var in server config:', k);
        continue;
      }
      sanitized[k] = String(v);
    }
    return sanitized;
  }

  upsertConfig(cfg: MCPServerConfig): void {
    const normalized = MCPManager.normalizeConfig(cfg, (cfg as any)?.id || '');
    if (!normalized) {
      throw new Error('[MCP] Rejected config: invalid server object');
    }

    // Validate stdio command before persisting
    if (normalized.transport === 'stdio') {
      if (!normalized.command) {
        throw new Error(`[MCP] Rejected config for "${normalized.id}": command is required for stdio transport`);
      }
      const validation = MCPManager.validateStdioCommand(normalized.command);
      if (!validation.valid) {
        throw new Error(`[MCP] Rejected config for "${normalized.id}": ${validation.reason}`);
      }
    }
    if ((normalized.transport === 'sse' || normalized.transport === 'http') && !normalized.url) {
      throw new Error(`[MCP] Rejected config for "${normalized.id}": url is required for ${normalized.transport} transport`);
    }

    const idx = this.configs.findIndex(c => c.id === normalized.id);
    if (idx >= 0) this.configs[idx] = normalized;
    else this.configs.push(normalized);
    this.save();
    // Defer security logging to avoid blocking the API response with file I/O
    setImmediate(() => {
      const headerCount = Object.keys(normalized.headers || {}).length;
      log.security('[MCP] Config saved for server:', normalized.id, 'transport:', normalized.transport, `headers: ${headerCount}`);
    });
  }

  deleteConfig(id: string): boolean {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx < 0) return false;
    this.configs.splice(idx, 1);
    this.save();
    this.disconnect(id);
    return true;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(id: string): Promise<{ success: boolean; tools?: MCPTool[]; error?: string }> {
    const cfg = this.configs.find(c => c.id === id);
    if (!cfg) return { success: false, error: 'Server config not found' };
    if (!cfg.enabled) return { success: false, error: 'Server is disabled' };

    await this.disconnect(id);

    if (cfg.transport === 'stdio') return this.connectStdio(cfg);
    if (cfg.transport === 'sse' || cfg.transport === 'http') return this.connectSSE(cfg);
    return { success: false, error: `Unknown transport: ${cfg.transport}` };
  }

  private async connectStdio(cfg: MCPServerConfig): Promise<{ success: boolean; tools?: MCPTool[]; error?: string }> {
    if (!cfg.command) return { success: false, error: 'No command specified' };

    const session: MCPSession = {
      config: cfg,
      tools: [],
      status: 'connecting',
      requestId: 1,
      pendingRequests: new Map(),
      buffer: '',
      initialized: false,
    };
    this.sessions.set(cfg.id, session);

    return new Promise((resolve) => {
      try {
        // HIGH-04: sanitize env vars — block PATH, NODE_OPTIONS, LD_PRELOAD etc.
        const safeUserEnv = MCPManager.sanitizeEnv(cfg.env || {});
        const env = { ...process.env, ...safeUserEnv };

        // CRIT-02: shell: false always — args are passed as a list, not a shell string.
        // This prevents metacharacter injection via cfg.args on all platforms.
        const proc = spawn(cfg.command!, cfg.args || [], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,  // SECURITY: never true — prevents shell injection via args
        });

        session.process = proc;

        const timeout = setTimeout(() => {
          if (session.status === 'connecting') {
            session.status = 'error';
            session.error = 'Connection timeout (15s)';
            try { proc.kill(); } catch {}
            resolve({ success: false, error: session.error });
          }
        }, 15000);

        proc.stdout?.on('data', (chunk: Buffer) => {
          session.buffer += chunk.toString();
          this.processBuffer(session);
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg) console.log(`[MCP:${cfg.id}] ${msg.slice(0, 200)}`);
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          session.status = 'error';
          session.error = err.message;
          console.error(`[MCP:${cfg.id}] Process error:`, err.message);
          resolve({ success: false, error: err.message });
        });

        proc.on('close', (code) => {
          console.log(`[MCP:${cfg.id}] Process closed (exit ${code})`);
          session.status = 'disconnected';
          for (const [, p] of session.pendingRequests) p.reject(new Error('MCP server disconnected'));
          session.pendingRequests.clear();
        });

        // Initialize handshake
        this.sendRequest(session, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'Prometheus', version: '1.0.0' },
        }).then(async () => {
          clearTimeout(timeout);
          this.sendNotification(session, 'notifications/initialized', {});

          try {
            const toolsResult = await this.sendRequest(session, 'tools/list', {});
            const tools: MCPTool[] = (toolsResult?.tools || []).map((t: any) => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
              serverId: cfg.id,
              serverName: cfg.name,
            }));
            session.tools = tools;
            session.status = 'connected';
            session.initialized = true;
            console.log(`[MCP:${cfg.id}] Connected — ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`);
            resolve({ success: true, tools });
          } catch {
            session.status = 'connected';
            session.initialized = true;
            resolve({ success: true, tools: [] });
          }
        }).catch((e) => {
          clearTimeout(timeout);
          session.status = 'error';
          session.error = e.message;
          resolve({ success: false, error: e.message });
        });

      } catch (e: any) {
        session.status = 'error';
        session.error = e.message;
        resolve({ success: false, error: e.message });
      }
    });
  }

  private async connectSSE(cfg: MCPServerConfig): Promise<{ success: boolean; tools?: MCPTool[]; error?: string }> {
    if (!cfg.url) return { success: false, error: 'No URL specified for SSE transport' };

    const session: MCPSession = {
      config: cfg, tools: [], status: 'connecting',
      requestId: 1, pendingRequests: new Map(), buffer: '', initialized: false,
    };
    this.sessions.set(cfg.id, session);

    // MCP Streamable HTTP protocol (2025-03-26+):
    //   1. POST initialize with Accept: application/json, text/event-stream
    //   2. Send notifications/initialized
    //   3. POST tools/list
    //   4. Track Mcp-Session-Id returned by server for all subsequent requests
    const MCP_PROTOCOL_VERSION = '2025-03-26';

    try {
      const baseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        ...(cfg.headers || {}),
      };
      // Debug logging
      const headerKeys = Object.keys(baseHeaders).filter(k => k !== 'Content-Type' && k !== 'Accept' && k !== 'MCP-Protocol-Version');
      console.log(`[MCP:${cfg.id}] Connecting to ${cfg.url} with ${headerKeys.length} custom headers:`, headerKeys);

      // Step 1: initialize handshake
      const initResp = await fetch(cfg.url, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            clientInfo: { name: 'Prometheus', version: '2.0.0' },
          },
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!initResp.ok) {
        session.status = 'error';
        // Try to get more details from response body for debugging
        let bodyText = '';
        try {
          bodyText = await initResp.text();
        } catch {}
        const details = bodyText ? ` — ${bodyText.slice(0, 100)}` : '';
        session.error = `HTTP ${initResp.status} ${initResp.statusText}${details}`;
        console.warn(`[MCP:${cfg.id}] Connection failed: ${session.error}`);
        return { success: false, error: session.error };
      }

      // Capture session ID if server issued one
      const mcpSessionId = initResp.headers.get('mcp-session-id') || initResp.headers.get('Mcp-Session-Id');
      const sessionHeaders: Record<string, string> = { ...baseHeaders };
      if (mcpSessionId) sessionHeaders['Mcp-Session-Id'] = mcpSessionId;

      // Step 2: send notifications/initialized (fire-and-forget, expect 202)
      fetch(cfg.url, {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      // Step 3: list tools
      const toolsResp = await fetch(cfg.url, {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(12000),
      });

      if (!toolsResp.ok) {
        // Connected but tools/list failed — still mark as connected with 0 tools
        session.status = 'connected';
        session.initialized = true;
        // Persist session headers for future callTool requests
        (session as any)._sessionHeaders = sessionHeaders;
        console.log(`[MCP:${cfg.id}] HTTP connected (tools/list HTTP ${toolsResp.status}) — 0 tool(s)`);
        return { success: true, tools: [] };
      }

      const ct = toolsResp.headers.get('content-type') || '';
      let toolsData: any;
      if (ct.includes('text/event-stream')) {
        // Server chose SSE stream — read first data event
        const sseText = await toolsResp.text();
        const match = sseText.match(/^data:\s*(.+)$/m);
        toolsData = match ? JSON.parse(match[1]) : {};
      } else {
        toolsData = await toolsResp.json();
      }

      const tools: MCPTool[] = (toolsData?.result?.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        serverId: cfg.id,
        serverName: cfg.name,
      }));

      session.tools = tools;
      session.status = 'connected';
      session.initialized = true;
      (session as any)._sessionHeaders = sessionHeaders;
      console.log(`[MCP:${cfg.id}] HTTP connected — ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`);
      return { success: true, tools };
    } catch (e: any) {
      session.status = 'error';
      session.error = e.message;
      return { success: false, error: e.message };
    }
  }

  async disconnect(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.status = 'disconnected';
    if (session.process) { try { session.process.kill(); } catch {} }
    this.sessions.delete(id);
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.sessions.keys()) await this.disconnect(id);
  }

  // ── Tool execution ─────────────────────────────────────────────────────────

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    const session = this.sessions.get(serverId);
    if (!session) throw new Error(`MCP server "${serverId}" not connected`);
    if (session.status !== 'connected') throw new Error(`MCP server "${serverId}" is ${session.status}`);

    if (session.config.transport === 'sse' || session.config.transport === 'http') {
      const cfg = session.config;
      // Use session-scoped headers (includes Mcp-Session-Id if server issued one)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
        ...(cfg.headers || {}),
        ...((session as any)._sessionHeaders || {}),
      };
      const resp = await fetch(cfg.url!, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: session.requestId++, method: 'tools/call', params: { name: toolName, arguments: args } }),
        signal: AbortSignal.timeout(30000),
      });
      const ct = resp.headers.get('content-type') || '';
      let data: any;
      if (ct.includes('text/event-stream')) {
        const sseText = await resp.text();
        const match = sseText.match(/^data:\s*(.+)$/m);
        data = match ? JSON.parse(match[1]) : {};
      } else {
        data = await resp.json();
      }
      return {
        content: data?.result?.content || [{ type: 'text', text: JSON.stringify(data?.result) }],
        isError: data?.result?.isError === true,
      };
    }

    const result = await this.sendRequest(session, 'tools/call', { name: toolName, arguments: args });
    return {
      content: result?.content || [{ type: 'text', text: JSON.stringify(result) }],
      isError: result?.isError === true,
    };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(): MCPServerStatus[] {
    return this.configs.map(cfg => {
      const session = this.sessions.get(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        enabled: cfg.enabled,
        status: session?.status || 'disconnected',
        tools: session?.tools.length || 0,
        toolNames: session?.tools.map(t => t.name) || [],
        error: session?.error,
      };
    });
  }

  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const session of this.sessions.values()) {
      if (session.status === 'connected') tools.push(...session.tools);
    }
    return tools;
  }

  async startEnabledServers(): Promise<void> {
    const enabled = this.configs.filter(c => c.enabled);
    if (enabled.length === 0) {
      console.log('[MCP] No enabled servers configured');
      return;
    }
    console.log(`[MCP] Auto-connecting ${enabled.length} enabled server(s)...`);
    const results = await Promise.allSettled(enabled.map(c => this.connect(c.id)));
    const status = this.getStatus();
    const connected = status.filter(s => s.status === 'connected');
    const failed = status.filter(s => s.status === 'error');

    console.log(`[MCP] ${connected.length}/${enabled.length} server(s) connected`);

    if (failed.length > 0) {
      console.warn(`[MCP] ${failed.length} server(s) failed to connect:`);
      for (const f of failed) {
        console.warn(`  - ${f.name} (${f.id}): ${f.error}`);
      }
    }
  }

  // ── JSON-RPC ───────────────────────────────────────────────────────────────

  private processBuffer(session: MCPSession): void {
    const lines = session.buffer.split('\n');
    session.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { this.handleMessage(session, JSON.parse(trimmed)); } catch {}
    }
  }

  private handleMessage(session: MCPSession, msg: any): void {
    if (msg.id !== undefined && session.pendingRequests.has(msg.id)) {
      const pending = session.pendingRequests.get(msg.id)!;
      session.pendingRequests.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    }
  }

  private sendRequest(session: MCPSession, method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = session.requestId++;
      const timeout = setTimeout(() => {
        if (session.pendingRequests.has(id)) {
          session.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 15000);

      session.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      if (session.process?.stdin) {
        session.process.stdin.write(msg);
      } else {
        session.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new Error('No stdin — process not running'));
      }
    });
  }

  private sendNotification(session: MCPSession, method: string, params: any): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    if (session.process?.stdin) session.process.stdin.write(msg);
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!_mcpManager) {
    const { getConfig } = require('../config/config');
    const configDir = getConfig().getConfigDir();
    _mcpManager = new MCPManager(configDir);
  }
  return _mcpManager;
}
