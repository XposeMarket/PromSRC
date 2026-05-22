import http from 'http';
import https from 'https';
import { WebSocket, WebSocketServer } from 'ws';
import { getConfig } from '../../config/config';
import { getValidXAIToken, isXAIConnected } from '../../auth/xai-oauth';
import { evaluateGatewayRequest } from '../gateway-auth';
import { getSessionStatus } from '../routes/account.router';

type HttpServer = http.Server | https.Server;

type AttachedXaiVoiceStreaming = {
  close: () => void;
};

function apiKey(name: string): string {
  return String(process.env[name] || '').trim();
}

function providerConfig(providerId: string): any {
  const raw = getConfig().getConfig() as any;
  const providers = raw?.llm?.providers && typeof raw.llm.providers === 'object' ? raw.llm.providers : {};
  const cfg = providers?.[providerId];
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

function providerSecret(providerId: string, field = 'api_key'): string {
  const value = providerConfig(providerId)?.[field];
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('env:')) return String(process.env[trimmed.slice(4)] || '').trim();
  try {
    return String(getConfig().resolveSecret(trimmed) || '').trim();
  } catch {
    return '';
  }
}

function looksLikeXaiApiKey(value: string): boolean {
  return /^xai-[A-Za-z0-9_-]+/.test(String(value || '').trim());
}

function xaiApiKey(): string {
  const configured = apiKey('XAI_API_KEY') || providerSecret('xai', 'api_key');
  return looksLikeXaiApiKey(configured) ? configured : '';
}

async function xaiAuthToken(): Promise<string> {
  const key = xaiApiKey();
  if (key) return key;
  if (!isXAIConnected(getConfig().getConfigDir())) return '';
  return getValidXAIToken(getConfig().getConfigDir());
}

function xaiBaseUrl(): string {
  const configured = String(
    providerConfig('xai')?.endpoint
      || process.env.XAI_STT_ENDPOINT
      || process.env.XAI_ENDPOINT
      || 'https://api.x.ai/v1',
  ).trim();
  return (configured || 'https://api.x.ai/v1').replace(/\/+$/, '');
}

function xaiWebSocketUrl(pathname: '/stt' | '/tts', query: URLSearchParams): string {
  const base = xaiBaseUrl()
    .replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:');
  return `${base}${pathname}?${query.toString()}`;
}

function closeSocket(socket: any, code = 1008, reason = 'Unauthorized'): void {
  try {
    socket.write(`HTTP/1.1 ${code === 1008 ? 403 : 400} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {}
  try { socket.destroy(); } catch {}
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function attachXaiVoiceStreaming(server: HttpServer): AttachedXaiVoiceStreaming {
  const sttWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    let pathname = '';
    let searchParams = new URLSearchParams();
    try {
      const parsed = new URL(String(req.url || ''), 'http://localhost');
      pathname = parsed.pathname;
      searchParams = parsed.searchParams;
    } catch {
      return;
    }
    if (pathname !== '/api/voice/xai/stt-stream') return;

    const auth = evaluateGatewayRequest({
      headers: req.headers as Record<string, any>,
      socket: { remoteAddress: req.socket.remoteAddress },
      url: req.url || '',
    });
    if (!auth.ok) {
      closeSocket(socket, 1008, auth.message || 'Gateway auth required');
      return;
    }
    const account = getSessionStatus();
    if (!account.authenticated || (!account.subscriptionActive && !account.isAdmin)) {
      closeSocket(socket, 1008, 'Account login or active subscription required');
      return;
    }

    const token = await xaiAuthToken().catch(() => '');
    if (!token) {
      closeSocket(socket, 1008, 'xAI speech is not configured');
      return;
    }

    sttWss.handleUpgrade(req, socket, head, (client) => {
      sttWss.emit('connection', client, req, { token, searchParams });
    });
  });

  sttWss.on('connection', (client: WebSocket, _req: http.IncomingMessage, meta: any) => {
    const token = String(meta?.token || '');
    const incoming = meta?.searchParams instanceof URLSearchParams ? meta.searchParams : new URLSearchParams();
    const sampleRate = safeNumber(incoming.get('sample_rate'), 16000, 8000, 48000);
    const endpointing = safeNumber(incoming.get('endpointing'), 120, 0, 5000);
    const language = String(incoming.get('language') || 'en').trim();
    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      encoding: 'pcm',
      interim_results: 'true',
      endpointing: String(endpointing),
    });
    if (language) params.set('language', language);

    const upstream = new WebSocket(xaiWebSocketUrl('/stt', params), {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.XAI_TTS_USER_AGENT || 'Prometheus/xai-streaming-voice',
      },
    });
    const pendingAudio: Buffer[] = [];
    let upstreamReady = false;
    let upstreamOpen = false;
    let doneSent = false;
    const startedAt = Date.now();

    const sendClient = (payload: Record<string, any>) => {
      if (client.readyState !== WebSocket.OPEN) return;
      try { client.send(JSON.stringify(payload)); } catch {}
    };

    const flushAudio = () => {
      if (!upstreamOpen || !upstreamReady || upstream.readyState !== WebSocket.OPEN) return;
      while (pendingAudio.length) {
        const chunk = pendingAudio.shift();
        if (chunk?.length) upstream.send(chunk);
      }
      if (doneSent) upstream.send(JSON.stringify({ type: 'audio.done' }));
    };

    upstream.on('open', () => {
      upstreamOpen = true;
      sendClient({ type: 'xai_stt.upstream_open', elapsedMs: Date.now() - startedAt });
    });

    upstream.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      let event: any = null;
      try { event = JSON.parse(text); } catch {
        sendClient({ type: 'xai_stt.upstream_text', text });
        return;
      }
      if (event?.type === 'transcript.created') {
        upstreamReady = true;
        flushAudio();
      }
      sendClient({ ...event, proxyElapsedMs: Date.now() - startedAt });
    });

    upstream.on('error', (err: any) => {
      sendClient({ type: 'error', error: { message: String(err?.message || err) }, proxyElapsedMs: Date.now() - startedAt });
    });

    upstream.on('close', (code, reason) => {
      sendClient({ type: 'xai_stt.closed', code, reason: reason?.toString?.() || '', proxyElapsedMs: Date.now() - startedAt });
      try { client.close(); } catch {}
    });

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        if (!chunk.length || doneSent) return;
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(chunk);
        else pendingAudio.push(chunk);
        return;
      }
      let event: any = null;
      try { event = JSON.parse(data.toString()); } catch { return; }
      if (event?.type === 'audio.done') {
        doneSent = true;
        flushAudio();
      }
    });

    client.on('close', () => {
      try {
        if (!doneSent && upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'audio.done' }));
      } catch {}
      try { upstream.close(); } catch {}
    });

    client.on('error', () => {
      try { upstream.close(); } catch {}
    });
  });

  return {
    close: () => {
      try { sttWss.close(); } catch {}
    },
  };
}
