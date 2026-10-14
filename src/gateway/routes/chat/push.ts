import type { Router, RequestHandler } from 'express';
import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../comms/broadcaster';
import {
  getWebPushPublicKey,
  listWebPushSubscriptions,
  removeWebPushSubscription,
  sendWebPushToAll,
  upsertWebPushSubscription,
} from '../../notifications/web-push';



export function registerPushRoutes(router: Router): void {
router.get('/api/push/public-key', (_req, res) => {
  try {
    res.json({ success: true, publicKey: getWebPushPublicKey() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/push/status', (_req, res) => {
  try {
    const subscriptions = listWebPushSubscriptions();
    const endpoint = String(_req.query?.endpoint || '').trim();
    const current = endpoint ? subscriptions.find((item) => item.endpoint === endpoint) : null;
    res.json({
      success: true,
      supported: true,
      subscriptionCount: subscriptions.length,
      subscriptions: subscriptions.map((item) => ({
        id: item.id,
        deviceId: item.deviceId || '',
        deviceName: item.deviceName || '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastSuccessAt: item.lastSuccessAt || 0,
        lastErrorAt: item.lastErrorAt || 0,
        lastError: item.lastError || '',
      })),
      currentSubscription: endpoint ? {
        registered: !!current,
        lastSuccessAt: current?.lastSuccessAt || 0,
        lastErrorAt: current?.lastErrorAt || 0,
        lastError: current?.lastError || '',
      } : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/subscribe', (req, res) => {
  try {
    const saved = upsertWebPushSubscription({
      subscription: req.body?.subscription || req.body,
      deviceId: String(req.body?.deviceId || req.headers['x-pairing-token'] || '').trim(),
      deviceName: String(req.body?.deviceName || '').trim(),
      userAgent: String(req.headers['user-agent'] || '').trim(),
    });
    res.json({ success: true, id: saved.id, subscriptionCount: listWebPushSubscriptions().length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/unsubscribe', (req, res) => {
  try {
    const endpointOrId = String(req.body?.endpoint || req.body?.id || '').trim();
    const removed = removeWebPushSubscription(endpointOrId);
    res.json({ success: true, removed, subscriptionCount: listWebPushSubscriptions().length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/push/test', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || getLastMainSessionId?.() || 'default').trim() || 'default';
    const endpoint = String(req.body?.endpoint || '').trim();
    void sendWebPushToAll({
      title: 'Notifications are on',
      body: 'Chat response notifications are ready.',
      url: `/?source=pwa#mobile/chat/${encodeURIComponent(sessionId)}`,
      tag: 'prometheus-push-test',
      data: { kind: 'push_test', sessionId },
    }, { endpoint }).then((deliveries) => {
      const delivery = endpoint
        ? deliveries.find((item) => item.endpoint === endpoint) || { ok: false, error: 'This device is not registered for push notifications.' }
        : undefined;
      res.json({ success: delivery ? delivery.ok === true : true, subscriptionCount: listWebPushSubscriptions().length, delivery });
    }).catch((err: any) => {
      res.status(500).json({ success: false, error: String(err?.message || err) });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});
}

