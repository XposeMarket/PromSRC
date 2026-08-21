export const SOURCE_PANEL_SURFACE = Object.freeze({
  NONE: 'none',
  MAIN_CHAT: 'main_chat',
  SUBAGENT_CHAT: 'subagent_chat',
});

export function sanitizeSourcePanelAgentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function subagentChatSessionId(agentId) {
  const id = sanitizeSourcePanelAgentId(agentId);
  return id ? `subagent_chat_${id}` : '';
}

export function normalizeSourcePanelContext(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const surface = String(source.surface || source.kind || '').trim().toLowerCase();
  if (surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT || source.agentId) {
    const agentId = sanitizeSourcePanelAgentId(source.agentId);
    const sessionId = String(source.sessionId || source.sourceSessionId || subagentChatSessionId(agentId)).trim();
    if (!agentId || !sessionId || sessionId !== subagentChatSessionId(agentId)) {
      return { surface: SOURCE_PANEL_SURFACE.NONE, sessionId: '', agentId: '', key: 'none' };
    }
    return {
      surface: SOURCE_PANEL_SURFACE.SUBAGENT_CHAT,
      sessionId,
      agentId,
      key: `subagent:${agentId}:${sessionId}`,
    };
  }
  if (surface === SOURCE_PANEL_SURFACE.MAIN_CHAT || source.sessionId || source.sourceSessionId) {
    const sessionId = String(source.sessionId || source.sourceSessionId || '').trim();
    return sessionId
      ? { surface: SOURCE_PANEL_SURFACE.MAIN_CHAT, sessionId, agentId: '', key: `main:${sessionId}` }
      : { surface: SOURCE_PANEL_SURFACE.NONE, sessionId: '', agentId: '', key: 'none' };
  }
  return { surface: SOURCE_PANEL_SURFACE.NONE, sessionId: '', agentId: '', key: 'none' };
}

export function sourcePanelContextIsVisible(context, { mode = '', activeSessionId = '' } = {}) {
  const normalized = normalizeSourcePanelContext(context);
  const active = String(activeSessionId || '').trim();
  if (normalized.surface === SOURCE_PANEL_SURFACE.MAIN_CHAT) {
    return mode === 'chat' && (!active || active === normalized.sessionId);
  }
  if (normalized.surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT) {
    return mode === 'subagents' && (!active || active === normalized.sessionId);
  }
  return false;
}

export function sourcePanelResourceBelongsToContext(resource, context) {
  const normalized = normalizeSourcePanelContext(context);
  if (normalized.surface === SOURCE_PANEL_SURFACE.NONE) return false;
  const owner = String(
    resource?.threadId
    || resource?.sessionId
    || resource?.sourceSessionId
    || resource?.metadata?.threadId
    || resource?.metadata?.sessionId
    || resource?.metadata?.sourceSessionId
    || '',
  ).trim();
  if (normalized.surface === SOURCE_PANEL_SURFACE.SUBAGENT_CHAT) return owner === normalized.sessionId;
  return !owner || owner === normalized.sessionId;
}
