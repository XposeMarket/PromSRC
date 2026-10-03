// Hot-swap newly activated Prometheus tool categories into a live realtime
// voice session (OpenAI / xAI data channel). Codex app-server bridge tools are
// fixed per call; there the model reaches new tools through prometheus_tools.
export function applyRealtimeToolRefresh(conn, directive) {
  if (directive?.action !== 'refresh_tools' || !Array.isArray(directive.tools) || !directive.tools.length) return false;
  if (!conn?.dc || conn.dc.readyState !== 'open' || conn.transport === 'codex_app_server') return true;
  try {
    conn.dc.send(JSON.stringify({
      type: 'session.update',
      session: conn.provider === 'xai'
        ? { tools: directive.tools, tool_choice: 'auto' }
        : { type: 'realtime', tools: directive.tools, tool_choice: 'auto' },
    }));
  } catch (err) {
    console.warn('[voice] realtime tool refresh failed:', err);
  }
  return true;
}
