export function compactMobileThreadCacheFileChanges(value) {
  if (!value || typeof value !== 'object') return undefined;
  const compactPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const files = (Array.isArray(payload.files) ? payload.files : []).slice(-12).map((file) => {
      if (!file || typeof file !== 'object') return null;
      return {
        path: String(file.path || '').trim() || undefined,
        displayPath: String(file.displayPath || file.path || '').trim() || undefined,
        status: String(file.status || 'modified').trim() || 'modified',
        insertions: Math.max(0, Number(file.insertions) || 0),
        deletions: Math.max(0, Number(file.deletions) || 0),
        binary: file.binary === true || undefined,
      };
    }).filter((file) => file && (file.path || file.displayPath));
    if (!files.length) return null;
    const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const checkpointValue = payload.checkpoint && typeof payload.checkpoint === 'object'
      ? {
        id: String(payload.checkpoint.id || payload.checkpoint.checkpoint_id || payload.checkpoint.checkpointId || '').trim() || undefined,
        createdAt: Number(payload.checkpoint.createdAt || payload.checkpoint.created_at || 0) || undefined,
        snapshotCount: Math.max(0, Number(payload.checkpoint.snapshotCount || payload.checkpoint.snapshot_count || 0) || 0),
      }
      : undefined;
    const checkpoint = checkpointValue?.id ? checkpointValue : undefined;
    return {
      summary: {
        fileCount: Math.max(files.length, Number(summary.fileCount) || 0),
        insertions: Math.max(0, Number(summary.insertions) || files.reduce((sum, file) => sum + file.insertions, 0)),
        deletions: Math.max(0, Number(summary.deletions) || files.reduce((sum, file) => sum + file.deletions, 0)),
      },
      files,
      ...(checkpoint ? { checkpoint } : {}),
    };
  };
  const primary = compactPayload(value);
  const groups = (Array.isArray(value.groups) ? value.groups : []).slice(-8).map((group, index) => {
    const data = compactPayload(group?.fileChanges || group);
    if (!data) return null;
    return {
      id: String(group?.id || group?.source || `group_${index + 1}`).trim() || `group_${index + 1}`,
      source: String(group?.source || '').trim() || undefined,
      label: String(group?.label || '').trim() || undefined,
      fileChanges: data,
    };
  }).filter(Boolean);
  if (!primary && !groups.length) return undefined;
  return {
    ...(primary || {}),
    ...(groups.length ? { groups } : {}),
  };
}

