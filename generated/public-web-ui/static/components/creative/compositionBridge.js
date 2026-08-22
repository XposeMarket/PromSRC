import { api } from '../../api.js';

function currentSessionId(deps = {}) {
  return String(
    deps.getSessionId?.()
      || window.currentCreativeSessionId
      || window.currentChatSessionId
      || window.activeChatSessionId
      || window.currentSessionId
      || '',
  ).trim();
}

function editorPlayheadMs() {
  return Math.max(0, Number(window.prometheusCreativeEditor?.store?.getState?.()?.timeMs) || 0);
}

function notifyEditor(bridge) {
  window.prometheusCreativeEditor?.setCompositionBridge?.(bridge);
}

export function createCreativeCompositionBridge(deps = {}) {
  let composition = null;
  let sequenceState = null;
  let loadedSessionId = '';
  let loadPromise = null;
  let lastError = null;

  function resetForSession(sessionId) {
    if (loadedSessionId === sessionId) return;
    composition = null;
    sequenceState = null;
    loadedSessionId = sessionId;
    lastError = null;
  }

  function setComposition(sessionId, nextComposition, lint = null) {
    resetForSession(sessionId);
    composition = nextComposition || null;
    sequenceState = composition
      ? {
          id: sessionId,
          title: 'Video edit',
          status: lint?.ok === false ? 'needs attention' : 'draft',
          lint: lint || null,
        }
      : null;
    lastError = null;
    notifyEditor(bridge);
    return composition;
  }

  async function openSequence(options = {}) {
    const sessionId = currentSessionId(deps);
    if (!sessionId) {
      if (!options.silent) throw new Error('Open a chat before loading the video composition.');
      return null;
    }
    resetForSession(sessionId);
    if (composition && options.force !== true) return composition;
    if (loadPromise && options.force !== true) return loadPromise;

    loadPromise = api(`/api/canvas/composition?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
      dedupe: false,
      timeoutMs: 20000,
    })
      .then((data) => setComposition(sessionId, data?.composition, data?.lint))
      .catch((error) => {
        lastError = error;
        if (!options.silent) throw error;
        return null;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  async function mutate(action, payload = {}) {
    const sessionId = currentSessionId(deps);
    if (!sessionId) throw new Error('Open a chat before editing the video composition.');
    resetForSession(sessionId);
    if (!composition) await openSequence();
    const data = await api('/api/canvas/composition', {
      method: 'POST',
      body: {
        sessionId,
        action,
        ...payload,
      },
      timeoutMs: 30000,
    });
    setComposition(sessionId, data?.composition, data?.lint);
    return data;
  }

  async function saveSequence() {
    const sessionId = currentSessionId(deps);
    if (!sessionId) throw new Error('Open a chat before saving the video composition.');
    resetForSession(sessionId);
    if (!composition) await openSequence();
    const data = await api('/api/canvas/composition', {
      method: 'POST',
      body: { sessionId, action: 'save', composition },
      timeoutMs: 30000,
    });
    setComposition(sessionId, data?.composition, data?.lint);
    return data;
  }

  async function render(options = {}) {
    const sessionId = currentSessionId(deps);
    if (!sessionId) throw new Error('Open a chat before rendering the video composition.');
    resetForSession(sessionId);
    if (!composition) await openSequence();
    const data = await api('/api/canvas/composition/render', {
      method: 'POST',
      body: {
        sessionId,
        composition,
        format: options.format || 'mp4',
        filename: options.filename,
      },
      timeoutMs: 720000,
    });
    try {
      window.dispatchEvent(new CustomEvent('prometheus:creative-composition-rendered', { detail: data }));
    } catch {}
    return data;
  }

  async function splitAtPlayhead(atMs = editorPlayheadMs()) {
    const clipId = composition?.selectedClipId || '';
    if (!clipId) throw new Error('Select a composition clip before splitting it.');
    return mutate('split_at', { clipId, atMs: Math.max(0, Number(atMs) || 0) });
  }

  async function deleteSelected(options = {}) {
    const clipId = composition?.selectedClipId || '';
    if (!clipId) return null;
    return mutate('delete_clip', { clipId, ripple: options.ripple === true });
  }

  async function selectClip(clipId) {
    return mutate('select_clip', { clipId: clipId == null ? null : String(clipId) });
  }

  const bridge = {
    getComposition() {
      const sessionId = currentSessionId(deps);
      if (sessionId && loadedSessionId !== sessionId) {
        resetForSession(sessionId);
        queueMicrotask(() => openSequence({ silent: true }).catch(() => {}));
      }
      return composition;
    },
    getSequenceState() {
      return sequenceState;
    },
    getPlayheadMs: editorPlayheadMs,
    getLastError() {
      return lastError;
    },
    openSequence,
    saveSequence,
    render,
    selectClip,
    splitAtPlayhead,
    deleteSelected,
    addTrack(kind = 'video', label) {
      return mutate('add_track', { kind, label });
    },
    addClip(clip) {
      return mutate('add_clip', { clip });
    },
    moveClip(clipId, options = {}) {
      return mutate('move_clip', { clipId, ...options });
    },
    trimClip(clipId, edge, toMs) {
      return mutate('trim_clip', { clipId, edge, toMs });
    },
    setTransition(clipId, edge, transition) {
      return mutate('set_transition', { clipId, edge, transition });
    },
  };

  return bridge;
}
