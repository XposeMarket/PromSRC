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
  const end = beginChatGPTBridgeTurn({
    sessionId: 'smoke',
    turnId: 'smoke-1',
    startedAt: Date.now(),
    allowedTools: () => [{
      name: 'prometheus_ping',
      description: 'Returns a secret word from the user\'s Prometheus computer. Call this whenever asked for the Prometheus word.',
      parameters: { type: 'object', properties: { note: { type: 'string' } } },
    }],
    executeTool: async (name, args) => {
      calls.push({ name, args, at: new Date().toISOString() });
      return { result: 'The Prometheus word is: OBSIDIAN-FALCON-42', error: false };
    },
  });

  const { buildProviderById } = await import('../src/providers/factory');
  const adapter: any = buildProviderById('openai_codex');
  try {
    const res = await adapter.chat([
      { role: 'system', content: 'You are Prom inside Prometheus.' },
      { role: 'user', content: 'Use the Prometheus connector tool prometheus_ping to get the Prometheus word, then tell me the word.' },
    ], 'chatgpt', {
      think: 'medium',
      onModelEvent: (e: any) => {
        if (e.type === 'provider_event') console.log(`  [${e.nativeType}] ${e.data?.name} ${String(e.data?.args || e.data?.result || '').slice(0, 140)}`);
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
