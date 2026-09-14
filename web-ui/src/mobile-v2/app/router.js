import { mountChatPage } from '../features/chat/chat-page.js';
import { mountPlaceholderPage } from '../features/placeholder/placeholder-page.js';

function parseRoute() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [name = 'chat', encodedId = ''] = raw.split('/');
  return { name: name || 'chat', id: encodedId ? decodeURIComponent(encodedId) : '' };
}

const PLACEHOLDERS = {
  voice: ['voice', 'Voice', 'Voice is next after the new chat transport and recovery path are proven.'],
  tasks: ['tasks', 'Tasks', 'Tasks will use the existing gateway endpoints through the V2 client layer.'],
  hub: ['hub', 'Hub', 'Hub will be rebuilt as an independent V2 feature rather than another shared page module.'],
  schedule: ['chat', 'Schedule', 'Schedule keeps the same mobile destination and will be migrated as an independent V2 feature.'],
  teams: ['chat', 'Teams', 'Teams keeps the same mobile destination and will be migrated as an independent V2 feature.'],
  subagents: ['chat', 'Subagents', 'Subagents keeps the same mobile destination and will be migrated as an independent V2 feature.'],
  proposals: ['chat', 'Proposals', 'Proposals keeps the same mobile destination and will be migrated as an independent V2 feature.'],
  more: ['chat', 'More', 'The legacy More destination is preserved in the V2 navigation skeleton while its tools move into isolated features.'],
};

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
    const placeholder = PLACEHOLDERS[route.name];
    if (placeholder) {
      cleanup = mountPlaceholderPage({ shell, tab: placeholder[0], title: placeholder[1], message: placeholder[2] });
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
