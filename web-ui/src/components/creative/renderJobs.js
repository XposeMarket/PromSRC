export function normalizeCreativeRenderJobStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['queued', 'running', 'retrying', 'uploading', 'completed', 'cancel_requested', 'canceled', 'failed'].includes(normalized)
    ? normalized
    : 'queued';
}

export function isCreativeRenderJobTerminalStatus(status) {
  return ['completed', 'canceled', 'failed'].includes(normalizeCreativeRenderJobStatus(status));
}

export function sortCreativeRenderJobEntries(entries = []) {
  return entries.slice().sort((left, right) => {
    const leftTime = Date.parse(String(left?.updatedAt || left?.createdAt || left?.requestedAt || '')) || 0;
    const rightTime = Date.parse(String(right?.updatedAt || right?.createdAt || right?.requestedAt || '')) || 0;
    return rightTime - leftTime;
  });
}

export function getCreativeRenderWorkerContext() {
  const source = window.__PROM_CREATIVE_RENDER_CONTEXT;
  if (!source || typeof source !== 'object' || source.enabled !== true) return null;
  const gatewayBaseUrl = String(source.gatewayBaseUrl || window.location.origin || '').trim().replace(/\/+$/, '');
  return {
    enabled: true,
    jobId: String(source.jobId || '').trim(),
    sessionId: String(source.sessionId || '').trim(),
    root: String(source.root || '').trim(),
    gatewayBaseUrl,
    token: String(source.token || '').trim(),
  };
}

export function isCreativeRenderWorkerMode() {
  return !!getCreativeRenderWorkerContext();
}

export function createCreativeRenderJobClient(deps = {}) {
  const reportState = {};

  function clearCreativeRenderJobReportState(jobId) {
    const normalizedId = String(jobId || '').trim();
    if (!normalizedId) return;
    const state = reportState[normalizedId];
    if (state?.timerId) clearTimeout(state.timerId);
    delete reportState[normalizedId];
  }

  async function createCreativeRenderJob(options = {}) {
    const sessionId = deps.getSessionId?.();
    const mode = deps.normalizeMode?.(options.mode || deps.getMode?.()) || '';
    if (!sessionId || !deps.isStructuredMode?.(mode)) return null;
    const response = await fetch('/api/canvas/creative-render-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        root: deps.getRoot?.() || '',
        mode,
        format: String(options.format || 'render').trim().toLowerCase(),
        renderer: options.renderer || 'browser-hybrid',
        autoStart: options.autoStart === true,
        progressLabel: options.progressLabel || 'Queued for export',
        doc: options.doc || deps.getSceneDoc?.() || null,
        summary: options.summary,
        exportOptions: options.exportOptions,
        metadata: options.metadata,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    await deps.ensureStorageRootVisible?.(data, mode);
    if (data?.job) deps.mergeJobEntry?.(data.job, { render: false });
    return data?.job || null;
  }

  async function startCreativeRenderJob(jobId) {
    const normalizedId = String(jobId || '').trim();
    const sessionId = deps.getSessionId?.();
    if (!normalizedId || !sessionId) return null;
    const response = await fetch(`/api/canvas/creative-render-jobs/${encodeURIComponent(normalizedId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        root: deps.getRoot?.() || '',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    if (data?.job) deps.mergeJobEntry?.(data.job, { render: false });
    return data?.job || null;
  }

  async function updateCreativeRenderJob(jobId, payload = {}, options = {}) {
    const normalizedId = String(jobId || '').trim();
    const sessionId = deps.getSessionId?.();
    if (!normalizedId || !sessionId) return null;
    const response = await fetch(`/api/canvas/creative-render-jobs/${encodeURIComponent(normalizedId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        root: deps.getRoot?.() || '',
        ...(payload || {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      if (options.silent) return null;
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    if (data?.job) deps.mergeJobEntry?.(data.job, { render: options.render !== false });
    return data?.job || null;
  }

  function reportCreativeRenderJobProgress(jobId, payload = {}, options = {}) {
    const normalizedId = String(jobId || '').trim();
    if (!normalizedId) return Promise.resolve(null);
    const throttleMs = Math.max(0, Number(options.throttleMs) || 550);
    const force = options.force === true;
    const now = Date.now();
    const state = reportState[normalizedId] || { lastSentAt: 0, timerId: 0, pending: {} };
    state.pending = { ...(state.pending || {}), ...(payload || {}) };
    reportState[normalizedId] = state;
    deps.mergeJobEntry?.({
      id: normalizedId,
      status: payload?.status,
      progress: payload?.progress,
      progressLabel: payload?.progressLabel,
      cancelRequested: payload?.cancelRequested,
      error: payload?.error,
      updatedAt: new Date().toISOString(),
      finishedAt: isCreativeRenderJobTerminalStatus(payload?.status) ? new Date().toISOString() : null,
    }, { render: false });
    if (!force && throttleMs > 0 && now - state.lastSentAt < throttleMs) {
      if (!state.timerId) {
        state.timerId = setTimeout(() => {
          const pending = state.pending || {};
          state.pending = {};
          state.timerId = 0;
          state.lastSentAt = Date.now();
          updateCreativeRenderJob(normalizedId, pending, { silent: true, render: false }).catch(() => {});
        }, Math.max(60, throttleMs - (now - state.lastSentAt)));
      }
      return Promise.resolve(null);
    }
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = 0;
    }
    const pending = state.pending || {};
    state.pending = {};
    state.lastSentAt = now;
    return updateCreativeRenderJob(normalizedId, pending, { silent: true, render: false });
  }

  async function cancelCreativeRenderJob(jobId, options = {}) {
    const normalizedId = String(jobId || '').trim();
    const sessionId = deps.getSessionId?.();
    if (!normalizedId || !sessionId) return null;
    clearCreativeRenderJobReportState(normalizedId);
    const response = await fetch(`/api/canvas/creative-render-jobs/${encodeURIComponent(normalizedId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        root: deps.getRoot?.() || '',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      if (options.silent) return null;
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    if (data?.job) deps.mergeJobEntry?.(data.job, { render: false });
    return data?.job || null;
  }

  async function completeCreativeRenderJob(jobId, { blob, filename, mimeType, mode, metadata } = {}) {
    const normalizedId = String(jobId || '').trim();
    const sessionId = deps.getSessionId?.();
    if (!normalizedId || !sessionId || !blob) return null;
    const response = await fetch(`/api/canvas/creative-render-jobs/${encodeURIComponent(normalizedId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        root: deps.getRoot?.() || '',
        mode: deps.normalizeMode?.(mode || deps.getMode?.()) || '',
        filename,
        mimeType,
        base64: await deps.blobToBase64?.(blob),
        metadata: metadata && typeof metadata === 'object' ? metadata : null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    clearCreativeRenderJobReportState(normalizedId);
    await deps.ensureStorageRootVisible?.(data, mode);
    if (data?.job) deps.mergeJobEntry?.(data.job, { render: false });
    await deps.loadCreativeAssets?.({ force: true, silent: true, renderStart: false, renderEnd: false }).catch(() => {});
    return data;
  }

  async function finalizeCreativeRenderJobBundle({ jobId, blob, extension, mimeType, mode, metadata } = {}) {
    if (!blob) return null;
    const normalizedMode = deps.normalizeMode?.(mode || deps.getMode?.()) || '';
    if (!jobId) {
      return deps.persistCreativeExportBundle?.({ blob, extension, mimeType, mode: normalizedMode });
    }
    const exportFilename = `${deps.getArtifactStem?.(normalizedMode)}-${deps.buildArtifactTimestamp?.()}.${String(extension || 'bin').trim().toLowerCase()}`;
    const results = await Promise.allSettled([
      deps.persistCreativeSceneSnapshot?.({ mode: normalizedMode, filename: `${normalizedMode}-scene.json` }),
      completeCreativeRenderJob(jobId, { blob, filename: exportFilename, mimeType, mode: normalizedMode, metadata }),
    ]);
    const [sceneResult, exportResult] = results;
    if (sceneResult?.status === 'fulfilled' && sceneResult.value?.path) {
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.(normalizedMode)}: saved scene snapshot ${sceneResult.value.path}.`);
    } else if (sceneResult?.status === 'rejected') {
      deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.(normalizedMode)}: could not save scene snapshot (${String(sceneResult.reason?.message || sceneResult.reason)})`);
    }
    if (exportResult?.status === 'fulfilled' && exportResult.value?.path) {
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.(normalizedMode)}: saved workspace export ${exportResult.value.path}.`);
      return exportResult.value;
    }
    if (exportResult?.status === 'rejected') {
      deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.(normalizedMode)}: could not save workspace export (${String(exportResult.reason?.message || exportResult.reason)})`);
    }
    return null;
  }

  async function fetchCreativeRenderJobForWorker(jobId, sessionId) {
    const ctx = getCreativeRenderWorkerContext();
    const normalizedId = String(jobId || '').trim();
    const normalizedSessionId = String(sessionId || deps.getSessionId?.() || '').trim();
    if (!normalizedId || !normalizedSessionId) throw new Error('Creative render worker is missing its job context.');
    const params = new URLSearchParams({ sessionId: normalizedSessionId });
    if (ctx?.root) params.set('root', ctx.root);
    const response = await fetch(`/api/canvas/creative-render-jobs/${encodeURIComponent(normalizedId)}?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data?.job || null;
  }

  return {
    clearCreativeRenderJobReportState,
    createCreativeRenderJob,
    startCreativeRenderJob,
    updateCreativeRenderJob,
    reportCreativeRenderJobProgress,
    cancelCreativeRenderJob,
    completeCreativeRenderJob,
    finalizeCreativeRenderJobBundle,
    fetchCreativeRenderJobForWorker,
  };
}

export function createCreativeRenderWorkerController(deps = {}) {
  let bootPromise = null;

  function ensureCreativeRenderWorkerSession(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim() || deps.generateSessionId?.();
    window.chatSessions = Array.isArray(window.chatSessions) ? window.chatSessions : [];
    let session = window.chatSessions.find((candidate) => candidate.id === normalizedSessionId) || null;
    if (!session) {
      session = {
        id: normalizedSessionId,
        title: 'Creative Render Worker',
        history: [],
        processLog: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        automated: true,
        unread: false,
      };
      window.chatSessions.push(session);
    }
    window.activeChatSessionId = normalizedSessionId;
    deps.setAgentSessionId?.(normalizedSessionId);
    return normalizedSessionId;
  }

  async function runCreativeRenderWorkerJob(job) {
    if (!job || typeof job !== 'object') throw new Error('Creative render worker could not load its render job.');
    const format = String(job.format || '').trim().toLowerCase();
    const creativeMode = deps.normalizeMode?.(job.creativeMode || 'video') || 'video';
    if (!['webm', 'gif', 'mp4'].includes(format)) {
      throw new Error(`Unsupported server render format: ${format || 'unknown'}`);
    }
    deps.applySessionCreativeMode?.(deps.getSessionId?.(), creativeMode);
    window.currentCreativeMode = creativeMode;
    deps.setInspectorTab?.('properties', { render: false, persist: false });
    if (job.storageRoot) {
      deps.setCanvasProjectState?.(job.storageRoot, deps.getCreativeWorkspaceLabel?.(creativeMode), { refreshPublish: false });
    }
    const nextDoc = deps.createSceneDocument?.(job.sceneDoc || {}) || job.sceneDoc || {};
    deps.restoreCreativeSnapshot?.({
      doc: nextDoc,
      selectedId: nextDoc.elements?.[nextDoc.elements.length - 1]?.id || null,
      timelineMs: 0,
    }, { render: false, persist: false });
    if (job.storageRoot) {
      await deps.ensureCreativeStorageRootVisible?.({ storageRoot: job.storageRoot }, creativeMode).catch(() => {});
    }
    await deps.loadCreativeLibraries?.({ force: true, silent: true, renderStart: false, renderEnd: false, mode: creativeMode }).catch(() => {});
    deps.renderCreativeWorkspace?.();
    await deps.waitForCreativeExportPaint?.(2);
    if (format === 'gif') {
      await deps.exportCreativeVideoGif?.({
        existingJobId: job.id,
        existingJob: job,
        skipDownload: true,
        skipSceneSnapshot: false,
        renderer: 'server-browser',
      });
      return;
    }
    await deps.exportCreativeVideoRecording?.(format, {
      existingJobId: job.id,
      existingJob: job,
      skipDownload: true,
      skipSceneSnapshot: false,
      renderer: 'server-browser',
    });
  }

  async function bootCreativeRenderWorkerMode() {
    if (bootPromise) return bootPromise;
    const ctx = getCreativeRenderWorkerContext();
    if (!ctx) return null;
    bootPromise = (async () => {
      try {
        document.body.classList.add('creative-render-worker');
        const sessionId = ensureCreativeRenderWorkerSession(ctx.sessionId || 'creative-render-worker');
        if (ctx.root) {
          deps.setCanvasProjectState?.(ctx.root, deps.getCreativeWorkspaceLabel?.('video'), { refreshPublish: false });
        }
        const job = await deps.fetchCreativeRenderJobForWorker?.(ctx.jobId, sessionId);
        if (!job) throw new Error('Creative render worker could not find its job.');
        deps.mergeJobEntry?.(job, { render: false });
        if (isCreativeRenderJobTerminalStatus(job.status)) return;
        await runCreativeRenderWorkerJob(job);
      } catch (err) {
        const ctxInner = getCreativeRenderWorkerContext();
        if (ctxInner?.jobId) {
          await deps.reportCreativeRenderJobProgress?.(ctxInner.jobId, {
            status: 'failed',
            progressLabel: 'Server render failed',
            error: String(err?.message || err),
            cancelRequested: false,
          }, { force: true });
          deps.clearCreativeRenderJobReportState?.(ctxInner.jobId);
        }
        throw err;
      }
    })();
    return bootPromise;
  }

  return {
    ensureCreativeRenderWorkerSession,
    runCreativeRenderWorkerJob,
    bootCreativeRenderWorkerMode,
  };
}
