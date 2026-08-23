export function chatProgressVisibility(event = {}) {
  const extra = event?.extra && typeof event.extra === 'object' ? event.extra : {};
  const visibility = String(event?.visibility || extra.visibility || '').trim().toLowerCase();
  if (visibility === 'private' || visibility === 'internal') return 'private';

  const type = String(event?.type || event?.eventType || extra.eventType || '').trim().toLowerCase();
  const source = String(event?.source || extra.source || '').trim().toLowerCase();
  if (type === 'thinking_delta' && source !== 'reasoning_summary') return 'private';
  if (type === 'reasoning_summary_delta' || type === 'reasoning_summary' || type === 'reasoning_delta' || source === 'reasoning_summary') {
    return 'summary';
  }
  // `thinking` is the legacy provider/full-thought channel and is private
  // unless the gateway explicitly marks a curated packet user-visible.
  if (type === 'thinking') return visibility === 'user' ? 'user' : 'private';
  if (type === 'agent_thought') return 'user';
  return visibility === 'user' ? 'user' : 'summary';
}

export function isUserSafeAgentProgress(event = {}) {
  return chatProgressVisibility(event) !== 'private';
}
