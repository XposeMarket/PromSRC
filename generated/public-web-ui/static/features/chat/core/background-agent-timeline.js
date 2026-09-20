function eventTime(entry) {
  const value = Number(entry?.at || entry?.timestamp || entry?.activity?.startedAt
    || entry?.extra?.at || entry?.extra?.timestamp || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function segmentFor(entry, steers, streamId) {
  const seq = Number(entry?.seq || entry?.activity?.seq || entry?.extra?.seq || 0) || 0;
  const entryStream = String(entry?.streamId || entry?.activity?.streamId || entry?.extra?.streamId || streamId || '').trim();
  const at = eventTime(entry);
  for (let index = 0; index < steers.length; index += 1) {
    const steer = steers[index];
    const steerSeq = Number(steer.seq || 0) || 0;
    const steerStream = String(steer.streamId || streamId || '').trim();
    if (seq > 0 && steerSeq > 0 && entryStream && steerStream === entryStream) {
      if (seq <= steerSeq) return index;
      continue;
    }
    if (at > 0 && Number(steer.timestamp || 0) > 0) {
      if (at <= Number(steer.timestamp)) return index;
      continue;
    }
    // Older cached traces lack stream coordinates. Keep them before the first
    // visible steer; never replay an unknown old event after the user message.
    if (!seq && !at) return 0;
  }
  return steers.length;
}

export function splitBackgroundAgentTimeline(message, steerMessages = [], streamId = '') {
  const steers = [...steerMessages].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const buckets = Array.from({ length: steers.length + 1 }, () => ({ processEntries: [], liveTraceEntries: [] }));
  for (const field of ['processEntries', 'liveTraceEntries']) {
    for (const entry of Array.isArray(message?.[field]) ? message[field] : []) {
      buckets[segmentFor(entry, steers, streamId)][field].push(entry);
    }
  }
  const segments = buckets.map((bucket, index) => {
    const last = index === steers.length;
    const startedAt = index === 0
      ? Number(message?.workStartedAt || message?.timestamp || 0)
      : Number(steers[index - 1]?.timestamp || 0);
    const endedAt = last ? Number(message?.workEndedAt || 0) : Number(steers[index]?.timestamp || 0);
    return {
      ...message,
      ...bucket,
      content: last ? String(message?.content || '') : '',
      body: {
        ...(message?.body || {}),
        text: last ? String(message?.body?.text || message?.content || '') : '',
        processEntries: bucket.processEntries,
      },
      streaming: last && message?.streaming === true,
      _done: last && message?._done === true,
      _pmFinalReceived: last && message?._pmFinalReceived === true,
      _progress: last ? message?._progress : '',
      fileChanges: last ? message?.fileChanges : null,
      workStartedAt: startedAt || undefined,
      workEndedAt: endedAt || undefined,
      workDurationMs: startedAt && endedAt ? Math.max(0, endedAt - startedAt) : undefined,
      suppressWorkTimer: index > 0,
    };
  });
  return { steers, segments };
}
