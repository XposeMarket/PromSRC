/** Pure server-history reconciliation used by reconnecting/mobile clients. */
export function historyMessageMergeKey(msg: any): string {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : msg?.role === 'user' ? 'user' : '';
  const messageId = String(msg?.messageId || msg?.id || '').trim();
  if (role && messageId) return `${role}|id:${messageId}`;
  const content = String(msg?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!role || !content) return '';
  const eventId = String(msg?.voiceInterruptionEventId || msg?.eventId || '').trim();
  if (eventId) return `${role}|event:${eventId}|${content}`;
  return `${role}|${content}`;
}

function isInterruptedAssistantMessage(msg: any): boolean {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : '';
  const content = String(msg?.content || '').trim();
  return !!role && !!content && (/^\[(?:Stopped by user|Generation stopped|Interrupted by user)\]/i.test(content)
    || /^Restart Context Packet\b/i.test(content)
    || /\b(?:stopped|interrupted|aborted) by user\b/i.test(content));
}

function mergeHistoryMetadataFromPrior(raw: any, prior: any): any {
  if (!prior || typeof prior !== 'object' || !raw || typeof raw !== 'object') return raw;
  const next: any = { ...raw };
  if (!Array.isArray(next.processEntries) && Array.isArray(prior.processEntries)) next.processEntries = prior.processEntries;
  if (!next.toolLog && prior.toolLog) next.toolLog = prior.toolLog;
  if (!next.thinking && prior.thinking) next.thinking = prior.thinking;
  if (!next.fileChanges && prior.fileChanges) next.fileChanges = prior.fileChanges;
  for (const key of ['generatedImages', 'generatedVideos', 'canvasFiles', 'files', 'artifacts', 'richArtifacts', 'attachmentPreviews']) {
    if ((!Array.isArray(next[key]) || next[key].length === 0) && Array.isArray(prior[key]) && prior[key].length) next[key] = prior[key];
  }
  const priorBodyFiles = Array.isArray(prior?.body?.files) ? prior.body.files : [];
  const nextBodyFiles = Array.isArray(next?.body?.files) ? next.body.files : [];
  if (!nextBodyFiles.length && priorBodyFiles.length) next.body = { ...(next.body && typeof next.body === 'object' ? next.body : {}), files: priorBodyFiles };
  return next;
}

/**
 * Merge a client snapshot with durable server history. Mobile snapshots may be
 * truncated, so preserve every omitted server message while accepting genuine
 * new client messages and collapsing repeated stable message identities.
 */
export function mergeHistoryWithExistingMessageMetadata(
  existingHistory: any[],
  incomingHistory: any[],
  options: { preserveAllExisting?: boolean } = {},
): any[] {
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : [];
  const existing = Array.isArray(existingHistory) ? existingHistory : [];
  if (!incoming.length) return options.preserveAllExisting ? [...existing] : incoming;
  const byKey = new Map<string, any>();
  for (const msg of existing) {
    const key = historyMessageMergeKey(msg);
    if (key && !byKey.has(key)) byKey.set(key, msg);
  }
  const interruptedExisting = existing.filter(isInterruptedAssistantMessage)
    .filter((msg: any) => Array.isArray(msg?.processEntries) || msg?.toolLog || msg?.fileChanges)
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const mergedIncoming: any[] = [];
  const incomingByKey = new Map<string, number>();
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') { mergedIncoming.push(raw); continue; }
    let merged = byKey.get(historyMessageMergeKey(raw));
    merged = merged && typeof merged === 'object' ? mergeHistoryMetadataFromPrior(raw, merged) : raw;
    if (isInterruptedAssistantMessage(raw)) {
      const rawTs = Number(raw?.timestamp || 0);
      const nearestInterrupted = interruptedExisting.find((msg: any) => !rawTs || !Number(msg?.timestamp || 0) || Math.abs(Number(msg.timestamp) - rawTs) < 10 * 60_000);
      if (nearestInterrupted) merged = mergeHistoryMetadataFromPrior(merged, nearestInterrupted);
    }
    const key = historyMessageMergeKey(merged);
    const duplicateIndex = key ? incomingByKey.get(key) : undefined;
    if (duplicateIndex !== undefined) mergedIncoming[duplicateIndex] = mergeHistoryMetadataFromPrior(merged, mergedIncoming[duplicateIndex]);
    else { mergedIncoming.push(merged); if (key) incomingByKey.set(key, mergedIncoming.length - 1); }
  }
  const represented = new Set(mergedIncoming.map(historyMessageMergeKey).filter(Boolean));
  for (const serverMessage of existing) {
    const key = historyMessageMergeKey(serverMessage);
    const serverOnly = String(serverMessage?.channel || '') === 'system' || !!serverMessage?.messageKind || !!serverMessage?.goalId || Array.isArray(serverMessage?.processEntries) || !!serverMessage?.toolLog;
    if ((options.preserveAllExisting || serverOnly) && key && !represented.has(key)) { mergedIncoming.push(serverMessage); represented.add(key); }
  }
  return mergedIncoming.sort((a: any, b: any) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
}
