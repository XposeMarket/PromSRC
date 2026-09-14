import { mountChatPage } from '../features/chat/chat-page.js';
import { mountPlaceholderPage } from '../features/placeholder/placeholder-page.js';

function parseRoute() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [name = 'chat', encodedId = ''] = raw.split('/');
  return { name: name || 'chat', id: encodedId ? decodeURIComponent(encodedId) : '' };
}

export function createMobileV2Router({ shell, gateway, chatStore }) {
  let cleanup = () => {};

  async function render() {
    cleanup?.();
    cleanup = () => {};
    const route = parseRoute();
    if (route.name === 'chat') {
      let sessionId = route.id;
      if (!sessionId) {
        try { sessionId = localStorage.getItem('pm_mobile_v2_active_session') || 'mobile_default'; }
        catch { sessionId = 'mobile_default'; }
      }
      cleanup = await mountChatPage({ shell, gateway, chatStore, sessionId });
      return;
    }
    if (route.name === 'voice') {
      cleanup = mountPlaceholderPage({ shell, tab: 'voice', title: 'Voice', message: 'Voice is next after the new chat transport and recovery path are proven.' });
      return;
    }
    if (route.name === 'tasks') {
      cleanup = mountPlaceholderPage({ shell, tab: 'tasks', title: 'Tasks', message: 'Tasks will use the existing gateway endpoints through the V2 client layer.' });
      return;
    }
    if (route.name === 'hub') {
      cleanup = mountPlaceholderPage({ shell, tab: 'hub', title: 'Hub', message: 'Hub will be rebuilt as an independent V2 feature rather than another shared page module.' });
      return;
    }
    navigate('chat');
  }

  function navigate(route) {
    const next = String(route || 'chat').replace(/^#\/?/, '');
    if (location.hash === `#${next}`) render();
    else location.hash = next;
  }

  function start() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = 'chat';
    else render();
  }

  return { start, navigate, render };
}
