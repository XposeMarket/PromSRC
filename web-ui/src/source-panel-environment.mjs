const GIT_KIND = 'git';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pathKey(value) {
  return String(value || '').trim().replace(/\\/g, '/').toLowerCase();
}

function changedFileStats(files) {
  const rows = asArray(files);
  return {
    count: rows.length,
    insertions: rows.reduce((total, file) => total + Math.max(0, Number(file?.insertions) || 0), 0),
    deletions: rows.reduce((total, file) => total + Math.max(0, Number(file?.deletions) || 0), 0),
  };
}

function statusForGitContext({ loaded, loading, error, context }) {
  if (loading || !loaded) return 'loading';
  if (error) return 'error';
  if (!context) return 'empty';
  if (!Array.isArray(context.roots) || context.roots.length === 0) return 'empty';
  return 'ready';
}

/**
 * Converts the asynchronous coding/remote state into the small, explicit
 * state machine used by the desktop Sources Environment rows. Keeping this
 * pure makes it possible to regression-test loading, stale, and unavailable
 * states without booting the Electron renderer.
 */
export function buildSourcePanelEnvironmentState({
  context = null,
  loaded = false,
  loading = false,
  error = '',
  remoteData = null,
  remoteLoading = false,
  fallbackFiles = [],
} = {}) {
  const contextStatus = statusForGitContext({ loaded, loading, error, context });
  const displayContext = contextStatus === 'ready' ? context : null;
  const roots = asArray(displayContext?.roots);
  const rootItem = roots.find((item) => item?.repository?.vcs?.kind === GIT_KIND) || roots[0] || null;
  const repository = rootItem?.repository || null;
  const repositoryReady = repository?.vcs?.kind === GIT_KIND;
  const root = String(rootItem?.root || displayContext?.root || '').trim();
  const files = rootItem
    ? (asArray(rootItem.files).length ? asArray(rootItem.files) : asArray(fallbackFiles))
    : asArray(displayContext?.files);
  const stats = changedFileStats(files);
  const repositoryStatus = repositoryReady
    ? (repository?.dirtyFiles?.length || repository?.stagedFiles || repository?.unstagedFiles || repository?.untrackedFiles || stats.count ? 'dirty' : 'clean')
    : '';
  const branch = String(repository?.branch || '').trim();
  const branchLabel = branch || (repositoryReady ? 'detached' : 'Branch');
  const aheadBehind = [
    Number(repository?.ahead) ? `↑${Number(repository.ahead)}` : '',
    Number(repository?.behind) ? `↓${Number(repository.behind)}` : '',
  ].filter(Boolean).join(' ');

  let remoteStatus = contextStatus;
  let remoteValue = 'Loading…';
  if (contextStatus === 'ready') {
    if (!repositoryReady || !repository?.remoteUrl) {
      remoteStatus = 'unavailable';
      remoteValue = 'Local only';
    } else if (repository.provider !== 'GitHub') {
      remoteStatus = 'unavailable';
      remoteValue = 'Unavailable';
    } else if (remoteLoading || !remoteData || pathKey(remoteData.root) !== pathKey(root)) {
      remoteStatus = 'loading';
      remoteValue = 'Loading…';
    } else if (remoteData.error) {
      remoteStatus = 'error';
      remoteValue = 'Unavailable';
    } else if (remoteData.connected !== true) {
      remoteStatus = 'unavailable';
      remoteValue = 'Connect GitHub';
    } else {
      remoteStatus = 'ready';
      remoteValue = `${asArray(remoteData.prs).length} open`;
    }
  } else if (contextStatus === 'error') {
    remoteStatus = 'error';
    remoteValue = 'Unavailable';
  } else if (contextStatus === 'empty') {
    remoteStatus = 'empty';
    remoteValue = 'Unavailable';
  }

  const unavailableValue = contextStatus === 'loading'
    ? 'Loading…'
    : contextStatus === 'error'
      ? 'Unavailable'
      : contextStatus === 'empty'
        ? 'No workspace'
        : !repositoryReady
          ? 'Unavailable'
          : '';

  return {
    contextStatus,
    root,
    repository,
    repositoryReady,
    repositoryStatus,
    branch,
    branchLabel,
    aheadBehind,
    changedCount: stats.count,
    insertions: stats.insertions,
    deletions: stats.deletions,
    changesValue: contextStatus === 'ready'
      ? String(stats.count)
      : unavailableValue,
    localValue: contextStatus === 'ready' && repositoryReady ? repositoryStatus : unavailableValue,
    branchValue: contextStatus === 'ready' && repositoryReady ? (aheadBehind || 'up to date') : unavailableValue,
    remoteStatus,
    remoteValue,
    interactionValue: unavailableValue,
    visible: loaded || loading || Boolean(error),
  };
}
