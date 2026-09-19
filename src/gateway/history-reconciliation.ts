/** Pure server-history reconciliation used by reconnecting/mobile clients. */
export function historyMessageMergeKey(msg: any): string {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : msg?.role === 'user' ? 'user' : '';
  const messageId = String(msg?.messageId || msg?.id || '').trim();
  const syntheticRequest = /^mobile-request:(.+):(user|assistant|ai)$/.exec(messageId);
  if (role === 'user' && syntheticRequest?.[2] === 'user') return `user|client:${syntheticRequest[1]}`;
  if (role && messageId) return `${role}|id:${messageId}`;
  const clientRequestId = String(msg?.clientRequestId || msg?._clientRequestId || '').trim();
  if (role === 'user' && clientRequestId) return `${role}|client:${clientRequestId}`;
  const content = String(msg?.content || '').replace(/\s+/g, ' ').trim();
  if (!role || !content) return '';
  const eventId = String(msg?.voiceInterruptionEventId || msg?.eventId || '').trim();
  if (eventId) return `${role}|event:${eventId}|${content}`;
  // One runtime request can produce multiple assistant segments after a steer.
  // Identical text sent twice is also two turns, so neither request nor text
  // alone is a safe fallback identity.
  if (clientRequestId) return `${role}|client:${clientRequestId}|${content}`;
  return `${role}|at:${Number(msg?.timestamp || 0) || 0}|${content}`;
}

function isInterruptedAssistantMessage(msg: any): boolean {
  const role = msg?.role === 'assistant' || msg?.role === 'ai' ? 'assistant' : '';
  const content = String(msg?.content || '').trim();
  return !!role && !!content && (/^\[(?:Stopped by user|Generation stopped|Interrupted by user)\]/i.test(content)
    || /^Restart Context Packet\b/i.test(content)
    || /\b(?:stopped|interrupted|aborted) by user\b/i.test(content));
}

function matchingCanonicalAssistant(existing: any[], incoming: any): any | null {
  const role = incoming?.role === 'assistant' || incoming?.role === 'ai' ? 'assistant' : '';
  const requestId = String(incoming?.clientRequestId || incoming?._clientRequestId || '').trim();
  const content = String(incoming?.content || '').replace(/\s+/g, ' ').trim();
  const incomingAt = Number(incoming?.workEndedAt || incoming?.timestamp || 0) || 0;
  if (role !== 'assistant' || !requestId || !content) return null;
  return [...existing].reverse().find((candidate) => {
    if (candidate?.role !== 'assistant' && candidate?.role !== 'ai') return false;
    const candidateRequestId = String(candidate?.clientRequestId || candidate?._clientRequestId || '').trim();
    if (candidateRequestId && candidateRequestId !== requestId) return false;
    const candidateContent = String(candidate?.content || '').replace(/\s+/g, ' ').trim();
    if (!candidateContent || candidateContent !== content) return false;
    const candidateAt = Number(candidate?.workEndedAt || candidate?.timestamp || 0) || 0;
    return !incomingAt || !candidateAt || Math.abs(candidateAt - incomingAt) < 2 * 60_000;
  }) || null;
}

function mergeHistoryMetadataFromPrior(raw: any, prior: any): any {
  if (!prior || typeof prior !== 'object' || !raw || typeof raw !== 'object') return raw;
  const next: any = { ...raw };
  if ((!Array.isArray(next.processEntries) || next.processEntries.length === 0)
    && Array.isArray(prior.processEntries) && prior.processEntries.length) next.processEntries = prior.processEntries;
  if ((!Array.isArray(next.liveTraceEntries) || next.liveTraceEntries.length === 0)
    && Array.isArray(prior.liveTraceEntries) && prior.liveTraceEntries.length) next.liveTraceEntries = prior.liveTraceEntries;
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
  options: { preserveAllExisting?: boolean; preferIncomingContent?: boolean } = {},
): any[] {
  const incoming = Array.isArray(incomingHistory) ? incomingHistory : [];
  const existing = Array.isArray(existingHistory) ? existingHistory : [];
  if (!incoming.length) return options.preserveAllExisting ? [...existing] : incoming;
  const preserve = options.preserveAllExisting === true;
  const base: any[] = [];
  const byKey = new Map<string, number>();
  for (const msg of existing) {
    const key = historyMessageMergeKey(msg);
    const duplicateIndex = key ? byKey.get(key) : undefined;
    if (duplicateIndex !== undefined) {
      const prior = base[duplicateIndex];
      const priorSynthetic = /^mobile-request:/.test(String(prior?.messageId || ''));
      const canonical = priorSynthetic && !String(msg?.messageId || '') ? msg : prior;
      base[duplicateIndex] = mergeHistoryMetadataFromPrior(canonical, canonical === msg ? prior : msg);
    } else {
      base.push(msg);
      if (key) byKey.set(key, base.length - 1);
    }
  }
  const interruptedExisting = existing.filter(isInterruptedAssistantMessage)
    .filter((msg: any) => Array.isArray(msg?.processEntries) || msg?.toolLog || msg?.fileChanges)
    .sort((a: any, b: any) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const mergedIncoming: any[] = [];
  const incomingByKey = new Map<string, number>();
  const representedExistingKeys = new Set<string>();
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') { mergedIncoming.push(raw); continue; }
    const priorIndex = byKey.get(historyMessageMergeKey(raw));
    let merged = priorIndex === undefined ? undefined : base[priorIndex];
    if (options.preferIncomingContent && (raw.role === 'assistant' || raw.role === 'ai')) {
      const requestId = String(raw.clientRequestId || raw._clientRequestId || '').trim();
      const endedAt = Number(raw.workEndedAt || 0) || 0;
      const sameTurn = requestId && endedAt ? existing.filter((candidate) =>
        (candidate?.role === 'assistant' || candidate?.role === 'ai')
        && String(candidate.clientRequestId || candidate._clientRequestId || '').trim() === requestId
        && Number(candidate.workEndedAt || 0) === endedAt) : [];
      if (sameTurn.length) {
        for (const candidate of sameTurn) {
          const key = historyMessageMergeKey(candidate);
          if (key) representedExistingKeys.add(key);
        }
        merged = sameTurn.sort((a, b) =>
          (Array.isArray(b.processEntries) ? b.processEntries.length : 0)
          - (Array.isArray(a.processEntries) ? a.processEntries.length : 0))[0];
      }
    }
    if (!merged) {
      // The server is authoritative for transcript text while mobile owns rich
      // visual/process metadata. Older canonical assistant rows omitted the
      // request id, so a completed optimistic row came back under a different
      // key and was appended as a duplicate. Join that exact, recent echo and
      // mark the canonical key represented before preserving server-only rows.
      const canonicalAssistant = matchingCanonicalAssistant(existing, raw);
      if (canonicalAssistant) {
        merged = canonicalAssistant;
        const canonicalKey = historyMessageMergeKey(canonicalAssistant);
        if (canonicalKey) representedExistingKeys.add(canonicalKey);
      }
    }
    merged = merged && typeof merged === 'object'
      ? options.preferIncomingContent ? {
          ...merged,
          content: raw.content,
          body: raw.body && typeof raw.body === 'object'
            ? { ...(merged.body && typeof merged.body === 'object' ? merged.body : {}), text: String(raw.body.text ?? raw.content ?? '') }
            : merged.body,
        } : {
          ...mergeHistoryMetadataFromPrior(raw, merged),
          content: merged.content || raw.content,
          timestamp: Number(merged.timestamp || 0) || raw.timestamp,
          messageId: merged.messageId || (/^mobile-request:/.test(String(raw.messageId || '')) ? undefined : raw.messageId),
        }
      : raw;
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
  const result = preserve ? [...base] : [...mergedIncoming];
  if (preserve) {
    // Keep the durable transcript as the ordering spine. Insert missing mobile
    // rows next to their nearest matching snapshot neighbor, never by timestamp.
    const findIndex = (message: any) => result.findIndex((candidate) => {
      const key = historyMessageMergeKey(message);
      return (!!key && key === historyMessageMergeKey(candidate))
        || matchingCanonicalAssistant([candidate], message) === candidate;
    });
    for (let index = 0; index < mergedIncoming.length; index += 1) {
      const message = mergedIncoming[index];
      let position = findIndex(message);
      if (position >= 0) {
        result[position] = mergeHistoryMetadataFromPrior(message, result[position]);
        continue;
      }
      const next = mergedIncoming.slice(index + 1).find((candidate) => findIndex(candidate) >= 0);
      const previous = [...mergedIncoming.slice(0, index)].reverse().find((candidate) => findIndex(candidate) >= 0);
      position = next ? findIndex(next) : previous ? findIndex(previous) + 1 : result.length;
      result.splice(position, 0, message);
    }
  } else {
    const represented = new Set(mergedIncoming.map(historyMessageMergeKey).filter(Boolean));
    for (const serverMessage of base) {
      const key = historyMessageMergeKey(serverMessage);
      const serverOnly = String(serverMessage?.channel || '') === 'system' || !!serverMessage?.messageKind || !!serverMessage?.goalId || Array.isArray(serverMessage?.processEntries) || !!serverMessage?.toolLog;
      if (serverOnly && key && !represented.has(key) && !representedExistingKeys.has(key)) { result.push(serverMessage); represented.add(key); }
    }
  }
  // Earlier timestamp sorting could persist a completed reply before its own
  // prompt. Repair only exact request-ID pairs; never infer order from text.
  for (let index = 0; index < result.length; index += 1) {
    const user = result[index];
    if (user?.role !== 'user') continue;
    const requestId = String(user.clientRequestId || user._clientRequestId || '').trim();
    if (!requestId) continue;
    const earlierAssistant = result.findIndex((message, candidateIndex) => candidateIndex < index
      && (message?.role === 'assistant' || message?.role === 'ai')
      && String(message.clientRequestId || message._clientRequestId || '').trim() === requestId);
    if (earlierAssistant < 0) continue;
    const [reply] = result.splice(earlierAssistant, 1);
    const userPosition = result.indexOf(user);
    result.splice(userPosition + 1, 0, reply);
  }
  return result;
}
