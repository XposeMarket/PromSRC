import { GatewayClient } from './core/gateway-client.js';
import { ChatStore } from './core/chat-store.js';
import { createMobileV2Router } from './app/router.js';
import { createMobileV2Shell } from './ui/shell.js';

const root = document.getElementById('mobile-v2-root');
if (!root) throw new Error('Prometheus Mobile V2 root was not found.');

document.body.classList.add('pm-mobile-active', 'pm-mobile-document-scroll', 'pm-mobile-v2');

const gateway = new GatewayClient({
  id: 'current',
  name: 'This gateway',
  origin: window.location.origin,
});
const chatStore = new ChatStore();
const shell = createMobileV2Shell({ root, gateway });
const router = createMobileV2Router({ shell, gateway, chatStore });

shell.setNavigate((route) => router.navigate(route));
router.start();

window.addEventListener('pm-v2-device-revoked', () => {
  shell.showNotice('This phone is no longer paired with the gateway. Open the legacy pairing screen to pair again while V2 pairing is being migrated.');
});
