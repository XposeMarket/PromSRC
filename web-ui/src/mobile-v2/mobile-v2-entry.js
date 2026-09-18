import { GatewayManager } from './core/gateway-manager.js';
import { FeatureClient } from './core/feature-client.js';
import { ChatStore } from './core/chat-store.js';
import { bootMobileV2Theme } from './core/theme.js';
import './core/pwa.js';
import { createMobileV2Router } from './app/router.js';
import { createMobileV2Shell } from './ui/shell.js';
import { attachMobileV2DrawerBootstrap } from './ui/drawer-bootstrap.js';

const root = document.getElementById('mobile-v2-root');
if (!root) throw new Error('Prometheus Mobile V2 root was not found.');
document.body.classList.add('pm-mobile-active', 'pm-mobile-document-scroll', 'pm-mobile-v2');
bootMobileV2Theme();

const gateways = new GatewayManager();
const features = new FeatureClient(gateways);
const chatStore = new ChatStore();
const shell = createMobileV2Shell({ root, gateways, features });
const router = createMobileV2Router({ shell, gateways, features, chatStore });
shell.setNavigate((route) => router.navigate(route));
const disposeDrawerParity = attachMobileV2DrawerBootstrap({ root, shell, gateways, router });
router.start();

window.addEventListener('pm-v2-device-revoked', (event) => {
  const gatewayId = String(event.detail?.gatewayId || gateways.activeId || '');
  shell.showNotice('This phone grant was revoked. Reconnect the gateway to continue.');
  gateways.probe(gatewayId).catch(() => {});
  if (gatewayId === gateways.activeId) router.navigate(`pair/${encodeURIComponent(gatewayId)}`);
});

window.addEventListener('beforeunload', () => {
  disposeDrawerParity?.();
  router.dispose();
  shell.dispose();
}, { once: true });
