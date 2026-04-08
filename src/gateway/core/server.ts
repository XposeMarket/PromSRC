/**
 * core/server.ts — B3 Refactor
 *
 * HTTP + WebSocket server factory.
 * Creates the http.Server and WebSocketServer, wires the WS event handlers,
 * and attaches error listeners that exit on EADDRINUSE.
 *
 * Called once by server-v2.ts immediately after createApp().
 * Returns { server, wss } — the same objects used everywhere else.
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { setWss } from '../comms/broadcaster';
import { hookBus } from '../hooks';
import { listPendingStartupNotifications, markStartupNotificationDelivered } from '../lifecycle';

export interface ServerBundle {
  server: http.Server;
  wss: WebSocketServer;
}

export function createServer(
  app: http.RequestListener,
  port: number,
  host: string,
): ServerBundle {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Register wss with the broadcaster so broadcastWS() works everywhere
  setWss(wss);

  wss.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Gateway] Port ${host}:${port} is already in use.`);
      console.error('[Gateway] Another gateway instance is likely already running.');
      console.error('[Gateway] Use one instance only, then open http://127.0.0.1:18789');
      process.exit(1);
      return;
    }
    console.error('[Gateway] WebSocket error:', err?.message || err);
    process.exit(1);
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[Prom] WS connected');

    const pending = listPendingStartupNotifications().filter((n) => !n.delivered?.web);
    const sendStartupNotification = (item: any) => {
      const payload = {
        type: 'session_notification',
        notificationId: item.id,
        sessionId: item.sessionId,
        text: item.text,
        title: item.title,
        source: item.source,
        automatedSession: item.automatedSession,
        previousSessionId: item.previousSessionId,
      };
      try {
        ws.send(JSON.stringify(payload));
        console.log(`[Prom] Sent startup notification ${item.id} -> session ${item.sessionId}`);
      } catch (err: any) {
        console.warn(`[Prom] Failed to send startup notification ${item.id}: ${err?.message || err}`);
      }
    };
    for (const item of pending) {
      sendStartupNotification(item);
      // Retry once in case frontend handlers are not ready yet.
      setTimeout(() => {
        try {
          const stillPending = listPendingStartupNotifications().some((n) => n.id === item.id && !n.delivered?.web);
          if (stillPending && ws.readyState === 1) sendStartupNotification(item);
        } catch {}
      }, 4000);
    }

    ws.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg?.type === 'startup_notification_ack' && msg?.notificationId) {
          markStartupNotificationDelivered(String(msg.notificationId), 'web');
          return;
        }
        // Handle approve_goal_request fired from Telegram (broadcast round-trip)
        if (msg?.type === 'approve_goal_request' && msg?.goalId) {
          hookBus.fire({ type: 'gateway:approve_goal', goalId: msg.goalId, chatId: msg.chatId })
            .catch((e: any) => console.warn('[WS] approve_goal_request error:', e?.message));
        }
      } catch {}
    });
    ws.on('close', () => console.log('[Prom] WS disconnected'));
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[Gateway] Port ${host}:${port} is already in use.`);
      console.error('[Gateway] Another gateway instance is likely already running.');
      console.error('[Gateway] Use one instance only, then open http://127.0.0.1:18789');
      process.exit(1);
      return;
    }
    console.error('[Gateway] HTTP server error:', err?.message || err);
    process.exit(1);
  });

  return { server, wss };
}
