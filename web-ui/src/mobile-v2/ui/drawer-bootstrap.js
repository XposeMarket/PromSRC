import { sessionRef } from '../core/gateway-manager.js';
import { attachMobileV2DrawerParity } from './drawer-parity.js';

const ACTIVE_SESSION_KEY = 'pm_mobile_v2_active_session';

function ensureDrawerStyles() {
  const id = 'pm-mobile-v2-drawer-parity-css';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = new URL('../mobile-v2-drawer.css', import.meta.url).href;
  document.head.appendChild(link);
}

function stamp(row) {
  return Number(new Date(row?.updatedAt || row?.lastActivityAt || row?.lastMessageAt || row?.createdAt || 0));
}

function readActiveSessionRef() {
  try { return String(localStorage.getItem(ACTIVE_SESSION_KEY) || ''); } catch { return ''; }
}

export function attachMobileV2DrawerBootstrap({ root, shell, gateways, router }) {
  const drawer = root?.querySelector('#pm-v2-drawer');
  const list = root?.querySelector('#pm-v2-session-list');
  if (!drawer || !list) return () => {};

  ensureDrawerStyles();
  let disposed = false;
  let baseSessions = [];

  async function loadBaseSessions() {
    const results = await Promise.allSettled(gateways.list().map(async (entry) => {
      const body = await gateways.client(entry.id).listSessions({ state: 'active', limit: 80 });
      return (body.sessions || []).map((row) => ({
        ...row,
        _gatewayId: entry.id,
        _gatewayName: entry.name,
        _ref: sessionRef(entry.id, row.id),
      }));
    }));
    if (disposed) return;
    baseSessions = results
      .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .sort((a, b) => stamp(b) - stamp(a));
  }

  async function refreshBaseSessions() {
    await Promise.allSettled([
      Promise.resolve(shell.refreshSessions?.()),
      loadBaseSessions(),
    ]);
  }

  const parity = attachMobileV2DrawerParity({
    drawer,
    list,
    gateways,
    navigate: (route) => router.navigate(route),
    setDrawer: (open) => shell.setDrawer(open),
    showNotice: (message) => shell.showNotice(message),
    refreshBaseSessions,
    getBaseSessions: () => baseSessions,
    getActiveSessionRef: readActiveSessionRef,
  });

  // The parity controller inserts its search/switch chrome after the Chats
  // heading. Move that chrome immediately before the heading so the controller
  // can continue using list.previousElementSibling as the live section label.
  const parityChrome = drawer.querySelector('.pm-v2-drawer-parity');
  const chatLabel = parityChrome?.previousElementSibling;
  if (parityChrome && chatLabel?.classList?.contains('pm-v2-drawer-label')) {
    chatLabel.insertAdjacentElement('beforebegin', parityChrome);
  }

  const menu = root.querySelector('.pm-v2-menu');
  const refreshParity = () => {
    parity.refresh({ base: true }).catch(() => {});
  };
  const onGatewayChange = () => refreshParity();
  const onSessionClickCapture = (event) => {
    const row = event.target?.closest?.('.pm-v2-session-row[data-session-ref]');
    if (!row || drawer.querySelector('.pm-v2-session-sheet')) return;
    const ref = String(row.dataset.sessionRef || '');
    if (!ref) return;
    event.preventDefault();
    event.stopPropagation();
    try { localStorage.setItem(ACTIVE_SESSION_KEY, ref); } catch {}
    shell.setDrawer(false);
    router.navigate(`chat/${encodeURIComponent(ref)}`);
  };

  menu?.addEventListener('click', refreshParity);
  drawer.addEventListener('click', onSessionClickCapture, true);
  gateways.addEventListener('change', onGatewayChange);
  refreshParity();

  return () => {
    disposed = true;
    menu?.removeEventListener('click', refreshParity);
    drawer.removeEventListener('click', onSessionClickCapture, true);
    gateways.removeEventListener('change', onGatewayChange);
    parity.dispose?.();
  };
}
