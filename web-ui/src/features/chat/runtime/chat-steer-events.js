export function steerAttachmentsToPreviews(attachments) {
  return (Array.isArray(attachments) ? attachments : []).map((attachment) => {
    const base64 = String(attachment?.base64 || '').trim();
    const mimeType = String(attachment?.mimeType || 'image/png').trim() || 'image/png';
    const name = String(attachment?.name || 'attachment').trim() || 'attachment';
    return {
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
      name,
      mimeType,
      dataUrl: base64 ? `data:${mimeType};base64,${base64.replace(/^data:[^;]+;base64,/, '')}` : '',
    };
  }).filter((attachment) => attachment.dataUrl);
}

export function findChatSteerRow(history, data = {}) {
  return (Array.isArray(history) ? history : []).find((row) => row?.role === 'user'
    && ((data.messageId && row.messageId === data.messageId)
      || (data.clientSteerId && row.clientSteerId === data.clientSteerId)
      || (data.workflowGroupId && row.workflowGroupId === data.workflowGroupId && row.workflowPart === 'interruption')));
}

export function appendRemoteChatSteer(event, append) {
  const sessionId = String(event?.sessionId || '').trim();
  if (!sessionId || typeof append !== 'function') return false;
  return append(sessionId, event.displayMessage || event.message || '', event);
}

export function appendChatSteerWorkflowSplit({
  sessionId,
  steerText,
  data = {},
  getSession,
  getStreamState,
  addProcessEntry,
  workflowGroupIds,
  persistSession,
  syncHistory,
  activateSession,
} = {}) {
  const sid = String(sessionId || '').trim();
  const sess = getSession?.(sid);
  if (!sess) return false;
  if (!Array.isArray(sess.history)) sess.history = [];
  if (!Array.isArray(sess.processLog)) sess.processLog = [];
  const st = getStreamState?.(sid);
  const start = Number.isFinite(Number(st?.currentTurnStartIndex)) ? Math.max(0, Number(st.currentTurnStartIndex)) : 0;
  const entries = sess.processLog.slice(start);
  const traces = Array.isArray(st?.liveTraceEntries) ? st.liveTraceEntries.slice() : [];
  const groupId = String(data.workflowGroupId || '').trim() || `chat_steer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const text = String(steerText || '').trim();
  const previews = Array.isArray(data.attachmentPreviews) && data.attachmentPreviews.length
    ? data.attachmentPreviews : steerAttachmentsToPreviews(data.attachments);
  const existing = findChatSteerRow(sess.history, data);
  if (existing) {
    if (previews.length) existing.attachmentPreviews = previews;
    return true;
  }
  const started = Number(st?.turnStartedAt || Date.now()) || Date.now();
  const timerAnchor = st?.steerTimerAnchored !== true;
  addProcessEntry?.(sid, 'warn', `Chat steer queued: ${text.slice(0, 180)}`, { actor: 'Chat Steer', eventId: data.eventId, runtimeId: data.runtimeId });
  const continuationStart = sess.processLog.length;
  if (st || entries.length || traces.length) sess.history.push({
    role: 'assistant', content: '', timestamp: Date.now(), workStartedAt: started,
    liveTraceEntries: traces, processEntries: entries, _steerTimerAnchor: timerAnchor,
    suppressWorkTimer: !timerAnchor, workflowGroupId: groupId, workflowPart: 'before_interruption',
    workflowLabel: 'Tool stream before steer', ...(data.beforeMessageId ? { messageId: data.beforeMessageId } : {}),
  });
  sess.history.push({
    role: 'user', ...(data.messageId ? { messageId: data.messageId } : {}), content: text,
    ...(data.clientSteerId ? { clientSteerId: data.clientSteerId } : {}),
    attachmentPreviews: previews.length ? previews : undefined, timestamp: Date.now(), channel: 'web', channelLabel: 'steer',
    workflowGroupId: groupId, workflowPart: 'interruption', workflowLabel: 'Message sent as steer',
  });
  if (st) {
    st.forceAppendAssistantAfterInterruption = true;
    st.pendingInterruptionWorkflowGroupId = groupId;
    st.pendingInterruptionWorkflowLabel = 'Response after steer';
    st.pendingInterruptionWorkflowPresentationCleared = false;
    st.steerWorkflowGroupIds = workflowGroupIds(st).concat(groupId).filter((id, index, all) => all.indexOf(id) === index);
    st.steerTimerAnchored = true;
    st.currentTurnStartIndex = continuationStart;
    st.liveTraceEntries = [];
    st.currentPreflightStatus = '';
    st.currentProgressLines = [];
    st.currentProgressThinkingText = '';
  }
  persistSession?.(sid);
  syncHistory?.(sid, sess.history);
  activateSession?.(sid, sess.history);
  return true;
}
