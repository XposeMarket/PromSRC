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
import {
  browserHandleUserInput,
  browserInspectPoint,
  getBrowserNamedElementsForSession,
  saveBrowserNamedElement,
  saveBrowserTeachSessionSnapshot,
  clearBrowserTeachSessionSnapshot,
  browserReopenSession,
  browserNavigateControl,
  startBrowserLiveStream,
  stopBrowserLiveStream,
  setBrowserControlCaptureState,
  setBrowserInteractionModeState,
} from '../browser-tools';
import { evaluateGatewayRequest } from '../gateway-auth';
import { getSessionStatus } from '../routes/account.router';
import { handleCreativeCommandResult } from '../creative/command-bus';

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

  wss.on('connection', (ws: WebSocket, req) => {
    const auth = evaluateGatewayRequest({
      headers: req.headers as Record<string, any>,
      socket: { remoteAddress: req.socket.remoteAddress },
      url: req.url || '',
    });
    if (!auth.ok) {
      try { ws.close(1008, auth.message); } catch {}
      return;
    }
    const account = getSessionStatus();
    if (!account.authenticated || (!account.subscriptionActive && !account.isAdmin)) {
      try { ws.close(1008, 'Account login or active subscription required'); } catch {}
      return;
    }
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
        const broadcastPayload = (payload: any) => {
          wss.clients.forEach((client: any) => {
            if (client.readyState === 1) {
              try { client.send(JSON.stringify(payload)); } catch {}
            }
          });
        };
        if (msg?.type === 'startup_notification_ack' && msg?.notificationId) {
          markStartupNotificationDelivered(String(msg.notificationId), 'web');
          return;
        }
        if (msg?.type === 'creative_command_result' && msg?.commandId) {
          handleCreativeCommandResult(msg);
          return;
        }
        if (msg?.type === 'browser:mode:set' && msg?.sessionId) {
          const interactionState = setBrowserInteractionModeState(String(msg.sessionId || ''), msg.mode);
          const payload = {
            type: 'browser:mode',
            sessionId: String(msg.sessionId || ''),
            mode: interactionState.mode,
            captured: interactionState.captured,
            controlOwner: interactionState.controlOwner,
            timestamp: Date.now(),
          };
          broadcastPayload(payload);
          return;
        }
        if (msg?.type === 'browser:control:set' && msg?.sessionId) {
          const interactionState = setBrowserControlCaptureState(String(msg.sessionId || ''), {
            captured: msg.captured === true,
            owner: String(msg.owner || '').trim().toLowerCase() === 'agent' ? 'agent' : 'user',
            reason: String(msg.reason || '').trim(),
          });
          const payload = {
            type: 'browser:control',
            sessionId: String(msg.sessionId || ''),
            mode: interactionState.mode,
            captured: interactionState.captured,
            controlOwner: interactionState.controlOwner,
            statusLabel: interactionState.lastActorSummary,
            timestamp: Date.now(),
          };
          broadcastPayload(payload);
          return;
        }
        if (msg?.type === 'browser:stream:set' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          if (msg.active === false) {
            stopBrowserLiveStream(sessionId, String(msg.reason || 'Live browser stream stopped by the canvas.').trim() || 'Live browser stream stopped by the canvas.')
              .catch(() => {});
            return;
          }
          startBrowserLiveStream(sessionId, {
            focus: msg.focus,
            preferCdp: msg.preferCdp !== false,
            restoreUrl: String(msg.restoreUrl || '').trim(),
            restoreTitle: String(msg.restoreTitle || '').trim(),
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:stream_status',
                sessionId,
                active: false,
                transport: '',
                focus: String(msg.focus || 'passive'),
                status: String(err?.message || err || 'Could not start live browser stream.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:reopen' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          browserReopenSession(sessionId, {
            url: String(msg.restoreUrl || '').trim(),
            title: String(msg.restoreTitle || '').trim(),
          }).then((knowledge) => {
            if (!knowledge) {
              try {
                ws.send(JSON.stringify({
                  type: 'browser:input:error',
                  sessionId,
                  error: 'Could not reopen the browser session.',
                  timestamp: Date.now(),
                }));
              } catch {}
              return;
            }
            broadcastPayload({
              type: 'browser:status',
              sessionId: knowledge.sessionId,
              active: knowledge.active,
              url: knowledge.url,
              title: knowledge.title,
              mode: knowledge.mode,
              captured: knowledge.captured,
              controlOwner: knowledge.controlOwner,
              streamActive: knowledge.streamActive,
              streamTransport: knowledge.streamTransport,
              streamFocus: knowledge.streamFocus,
              source: 'system',
              tool: 'browser_reopen',
              statusLabel: 'Reopened the last browser page.',
              frameBase64: knowledge.frameBase64,
              frameWidth: knowledge.frameWidth,
              frameHeight: knowledge.frameHeight,
              frameFormat: 'png',
              timestamp: Date.now(),
            });
            try {
              ws.send(JSON.stringify({
                type: 'browser:knowledge',
                action: 'loaded',
                sessionId: knowledge.sessionId,
                active: knowledge.active,
                url: knowledge.url,
                site: knowledge.site,
                title: knowledge.title,
                mode: knowledge.mode,
                captured: knowledge.captured,
                controlOwner: knowledge.controlOwner,
                streamActive: knowledge.streamActive,
                streamTransport: knowledge.streamTransport,
                streamFocus: knowledge.streamFocus,
                frameBase64: knowledge.frameBase64,
                frameWidth: knowledge.frameWidth,
                frameHeight: knowledge.frameHeight,
                elements: knowledge.elements,
                itemRoots: knowledge.itemRoots,
                extractionSchemas: knowledge.extractionSchemas,
                timestamp: Date.now(),
              }));
            } catch {}
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId,
                error: String(err?.message || err || 'Could not reopen the browser session.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:navigation' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          browserNavigateControl(sessionId, {
            action: msg.action,
            url: String(msg.url || '').trim(),
          }).then((status) => {
            broadcastPayload({
              type: 'browser:status',
              ...status,
              source: 'system',
              tool: `browser_${String(msg.action || 'navigate').trim().toLowerCase()}`,
            });
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId,
                error: String(err?.message || err || 'Browser navigation failed.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:input' && msg?.sessionId) {
          browserHandleUserInput(String(msg.sessionId || ''), {
            action: String(msg.action || ''),
            x: Number(msg.x),
            y: Number(msg.y),
            button: msg.button,
            deltaX: Number(msg.deltaX),
            deltaY: Number(msg.deltaY),
            key: msg.key,
            text: msg.text,
            ctrlKey: msg.ctrlKey === true,
            altKey: msg.altKey === true,
            metaKey: msg.metaKey === true,
            shiftKey: msg.shiftKey === true,
          }).then((payload) => {
            broadcastPayload({
              type: 'browser:status',
              ...payload,
            });
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:input:error',
                sessionId: String(msg.sessionId || ''),
                error: String(err?.message || err || 'Browser input failed.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
          return;
        }
        if (msg?.type === 'browser:inspect_point' && msg?.sessionId) {
          browserInspectPoint(
            String(msg.sessionId || ''),
            Number(msg.x),
            Number(msg.y),
          ).then((selection) => {
            const payload = {
              type: 'browser:selection',
              sessionId: String(msg.sessionId || ''),
              selection,
              timestamp: Date.now(),
            };
            broadcastPayload(payload);
          }).catch(() => {});
          return;
        }
        if (msg?.type === 'browser:knowledge:request' && msg?.sessionId) {
          getBrowserNamedElementsForSession(String(msg.sessionId || ''), {
            url: String(msg.restoreUrl || '').trim(),
            title: String(msg.restoreTitle || '').trim(),
          })
            .then((knowledge) => {
              if (!knowledge) return;
              try {
                ws.send(JSON.stringify({
                  type: 'browser:knowledge',
                  action: 'loaded',
                  sessionId: knowledge.sessionId,
                  active: knowledge.active,
                  url: knowledge.url,
                  site: knowledge.site,
                  title: knowledge.title,
                  mode: knowledge.mode,
                  captured: knowledge.captured,
                  controlOwner: knowledge.controlOwner,
                  streamActive: knowledge.streamActive,
                  streamTransport: knowledge.streamTransport,
                  streamFocus: knowledge.streamFocus,
                  frameBase64: knowledge.frameBase64,
                  frameWidth: knowledge.frameWidth,
                  frameHeight: knowledge.frameHeight,
                  elements: knowledge.elements,
                  itemRoots: knowledge.itemRoots,
                  extractionSchemas: knowledge.extractionSchemas,
                  timestamp: Date.now(),
                }));
              } catch {}
            })
            .catch(() => {});
          return;
        }
        if (msg?.type === 'browser:teach:sync' && msg?.sessionId) {
          const sessionId = String(msg.sessionId || '');
          const teachSession = msg?.teachSession;
          if (teachSession && typeof teachSession === 'object' && teachSession.active === true) {
            saveBrowserTeachSessionSnapshot(sessionId, teachSession);
          } else {
            clearBrowserTeachSessionSnapshot(sessionId);
          }
          return;
        }
        if (msg?.type === 'browser:element:save' && msg?.sessionId) {
          saveBrowserNamedElement(String(msg.sessionId || ''), {
            name: String(msg.name || '').trim(),
            kind: String(msg.kind || '').trim().toLowerCase() === 'item_root' ? 'item_root' : 'element',
            selector: String(msg?.selection?.selector || '').trim(),
            tagName: String(msg?.selection?.tagName || '').trim(),
            id: String(msg?.selection?.id || '').trim(),
            text: String(msg?.selection?.text || '').trim(),
            url: String(msg?.selection?.url || '').trim(),
          }).then((knowledge) => {
            const payload = {
              type: 'browser:knowledge',
              action: 'saved',
              sessionId: knowledge.sessionId,
              url: knowledge.url,
              site: knowledge.site,
              savedKind: knowledge.kind,
              saved: knowledge.saved,
              elements: knowledge.elements,
              itemRoots: knowledge.itemRoots,
              extractionSchemas: knowledge.extractionSchemas,
              timestamp: Date.now(),
            };
            broadcastPayload(payload);
          }).catch((err: any) => {
            try {
              ws.send(JSON.stringify({
                type: 'browser:knowledge:error',
                sessionId: String(msg.sessionId || ''),
                error: String(err?.message || err || 'Failed to save browser memory entry.'),
                timestamp: Date.now(),
              }));
            } catch {}
          });
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
