/**
 * End-to-end bridge smoke (real ChatGPT, real connector, fake tool):
 *
 *   1. Serves the real chatgpt-bridge.router on 127.0.0.1:<port>.
 *   2. Opens a bridge "turn" exposing one harmless tool (prometheus_ping).
 *   3. Sends a ChatGPT message through OpenAICodexAdapter (model=chatgpt),
 *      which registers the connector (first run) and attaches it.
 *   4. Reports whether ChatGPT actually called the tool over MCP.
 *
 *   PROMETHEUS_DATA_DIR=... CHATGPT_BRIDGE_PUBLIC_URL=https://... npx tsx scripts/smoke-chatgpt-bridge-e2e.ts <port>
 */

import express from 'express';
import { router } from '../src/gateway/routes/chatgpt-bridge.router';
import { beginChatGPTBridgeTurn } from '../src/providers/chatgpt-web/chatgpt-bridge-sessions';
import { getConfig } from '../src/config/config';

async function main() {
  const port = Number(process.argv[2] || 18999);
  const publicUrl = String(process.env.CHATGPT_BRIDGE_PUBLIC_URL || '').trim();
  if (publicUrl) {
    const cfg: any = getConfig().getConfig();
    cfg.llm = cfg.llm || {};
    cfg.llm.providers = cfg.llm.providers || {};
    cfg.llm.providers.openai_codex = cfg.llm.providers.openai_codex || {};
    cfg.llm.providers.openai_codex.chatgpt = { ...(cfg.llm.providers.openai_codex.chatgpt || {}), bridge_public_url: publicUrl };
  }
  {
    // The smoke always exercises the bridge; TEMPORARY=0 sends a normal
    // (non-temporary) chat, since the web client strips connectors in temp chats.
    const cfg: any = getConfig().getConfig();
    cfg.llm = cfg.llm || {}; cfg.llm.providers = cfg.llm.providers || {};
    cfg.llm.providers.openai_codex = cfg.llm.providers.openai_codex || {};
    cfg.llm.providers.openai_codex.chatgpt = {
      ...(cfg.llm.providers.openai_codex.chatgpt || {}),
      tool_bridge: true,
      ...(process.env.TEMPORARY === '0' ? { temporary_chats: false } : {}),
    };
  }
  const app = express();
  const hits: string[] = [];
  app.use(express.json());
  app.use((req, res, next) => {
    const body: any = (req as any).body || {};
    const label = `${req.method} ${Array.isArray(body) ? body.map((b: any) => b.method).join(',') : body.method || ''} ${body?.params?.name || ''}`.trim();
    const origJson = res.json.bind(res);
    (res as any).json = (payload: any) => {
      const r = payload?.result;
      hits.push(`${label} -> ${r?.tools ? `tools=[${r.tools.map((t: any) => t.name).join(',')}]` : r?.content ? `content=${String(r.content?.[0]?.text || '').slice(0, 60)}` : r?.serverInfo ? 'initialized' : JSON.stringify(payload).slice(0, 80)}`);
      return origJson(payload);
    };
    if (!['POST'].includes(req.method)) hits.push(label);
    next();
  });
  app.use('/', router);
  const server = app.listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  console.log(`bridge listening on 127.0.0.1:${port}`);

  const calls: any[] = [];
  // SMOKE_ROOT=<dir>: expose real read-only file tools scoped to that folder
  // (list_directory + read_file) instead of the fake ping tool.
  const smokeRoot = String(process.env.SMOKE_ROOT || '').trim();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const inRoot = (rel: unknown) => {
    const full = pathMod.resolve(smokeRoot, String(rel || '.'));
    if (!full.startsWith(pathMod.resolve(smokeRoot))) throw new Error('path escapes SMOKE_ROOT');
    return full;
  };
  const realTools = [
    { name: 'list_directory', description: 'List files in a folder on the user\'s computer (relative to the Prometheus workspace).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder path relative to the workspace, e.g. "."' } }, required: ['path'] } },
    { name: 'read_file', description: 'Read a text file on the user\'s computer (relative to the Prometheus workspace).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the workspace' } }, required: ['path'] } },
  ];
  const pingTool = [{
    name: 'prometheus_ping',
    description: 'Returns a secret word from the user\'s Prometheus computer. Call this whenever asked for the Prometheus word.',
    parameters: { type: 'object', properties: { note: { type: 'string' } } },
  }];
  const end = beginChatGPTBridgeTurn({
    sessionId: 'smoke',
    turnId: 'smoke-1',
    startedAt: Date.now(),
    allowedTools: () => (smokeRoot ? realTools : pingTool),
    executeTool: async (name, args: any) => {
      calls.push({ name, args, at: new Date().toISOString() });
      if (!smokeRoot) return { result: 'The Prometheus word is: OBSIDIAN-FALCON-42', error: false };
      try {
        if (name === 'list_directory') return { result: fsMod.readdirSync(inRoot(args?.path)).join('\n'), error: false };
        if (name === 'read_file') return { result: fsMod.readFileSync(inRoot(args?.path), 'utf8').slice(0, 20_000), error: false };
        return { result: `unknown tool ${name}`, error: true };
      } catch (error: any) {
        return { result: String(error?.message || error), error: true };
      }
    },
  });
  const prompt = String(process.env.SMOKE_PROMPT || '').trim()
    || (smokeRoot
      ? 'Using the Prometheus tools: list the folder "chatgpt-smoke", then read the note file inside it and tell me the exact code it contains.'
      : 'Use the Prometheus connector tool prometheus_ping to get the Prometheus word, then tell me the word.');

  const { buildProviderById } = await import('../src/providers/factory');
  const adapter: any = buildProviderById('openai_codex');
  try {
    const res = await adapter.chat([
      { role: 'system', content: 'You are Prom inside Prometheus.' },
      { role: 'user', content: prompt },
    ], 'chatgpt', {
      think: 'medium',
      onModelEvent: (e: any) => {
        if (e.type === 'provider_event') console.log(`  [${e.nativeType}] ${e.data?.name} viaBridge=${!!e.data?.viaBridge} ${String(e.data?.args || e.data?.result || '').slice(0, 140)}`);
        if (e.type === 'tool_call_start') console.log(`  [ui row] ${e.name}`);
      },
    });
    console.log('\nFINAL:', String(res.message.content).slice(0, 400));
  } catch (error: any) {
    console.log('CHAT FAILED:', error?.code || '', error?.message || error);
  } finally {
    end();
  }
  const fs = await import('fs');
  const path = await import('path');
  const statePath = path.join(getConfig().getConfigDir(), 'chatgpt-bridge.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  console.log('\nbridge state:', JSON.stringify({ accounts: Object.keys(state.accounts || {}), connector: Object.values(state.accounts || {}).map((a: any) => a.connectorId), lastError: state.lastError?.message }, null, 2));
  console.log('MCP hits:', hits.length, hits.slice(0, 12));
  console.log('tool calls via bridge:', JSON.stringify(calls));
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
