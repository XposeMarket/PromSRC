function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createCreativeExportEngine(deps = {}) {
  function getCreativeVideoExportConfig(format = 'webm') {
    if (typeof MediaRecorder === 'undefined') return null;
    const normalized = String(format || 'webm').trim().toLowerCase();
    const presets = {
      mp4: {
        format: 'mp4',
        extension: 'mp4',
        label: 'MP4',
        candidates: [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=h264,aac',
          'video/mp4',
        ],
      },
      webm: {
        format: 'webm',
        extension: 'webm',
        label: 'WEBM',
        candidates: [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ],
      },
    };
    const preset = presets[normalized] || presets.webm;
    const mimeType = preset.candidates.find((candidate) => (
      typeof MediaRecorder.isTypeSupported !== 'function'
        ? true
        : MediaRecorder.isTypeSupported(candidate)
    )) || '';
    return mimeType ? { ...preset, mimeType } : null;
  }

  function getCreativeGifExportConfig() {
    const GifCtor = window.GIF;
    if (typeof GifCtor !== 'function') return null;
    return {
      format: 'gif',
      extension: 'gif',
      label: 'GIF',
      GifCtor,
      mimeType: 'image/gif',
      workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js',
    };
  }

  function waitForCreativeExportDelay(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function waitForCreativeExportPaint(frames = 1) {
    const count = Math.max(1, Number(frames) || 1);
    return new Promise((resolve) => {
      let remaining = count;
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) resolve(null);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function getExistingRenderJob(options = {}) {
    const explicitJob = options?.existingJob && typeof options.existingJob === 'object'
      ? options.existingJob
      : null;
    if (explicitJob?.id) return explicitJob;
    const existingJobId = String(options?.existingJobId || '').trim();
    if (!existingJobId) return null;
    return deps.getRenderJobEntryById?.(existingJobId) || null;
  }

  function resolveCreativeExportContext(requestedFormat = 'webm', options = {}) {
    const existingJob = getExistingRenderJob(options);
    const workerInput = existingJob?.workerInput && typeof existingJob.workerInput === 'object'
      ? existingJob.workerInput
      : null;
    const sceneDoc = workerInput?.sceneDoc || existingJob?.sceneDoc || deps.getSceneDoc?.() || {};
    const exportOptions = workerInput?.exportOptions || existingJob?.exportOptions || null;
    const audioTrack = workerInput?.audioTrack || sceneDoc?.audioTrack || deps.getAudioTrackConfig?.(sceneDoc) || {};
    const format = String(workerInput?.format || existingJob?.format || requestedFormat || 'webm').trim().toLowerCase();
    const durationMs = Math.max(
      0,
      Number(exportOptions?.durationMs)
        || Number(sceneDoc?.durationMs)
        || Number(deps.getTimelineDurationMs?.())
        || 0,
    );
      const frameRateCap = format === 'gif' ? 16 : 60;
      const frameRate = Math.max(
        format === 'gif' ? 6 : 60,
        Math.min(
          frameRateCap,
          Number(exportOptions?.frameRate)
            || Number(sceneDoc?.frameRate)
            || Number(deps.getTimelineFrameRate?.())
            || (format === 'gif' ? 12 : 60),
        ),
      );
    const width = Math.max(1, Number(exportOptions?.width) || Number(sceneDoc?.width) || 1);
    const height = Math.max(1, Number(exportOptions?.height) || Number(sceneDoc?.height) || 1);
    const frameDelay = Math.max(40, Math.round(1000 / Math.max(1, frameRate)));
    const frameCount = Math.max(
      2,
      Number(exportOptions?.frameCount) || Math.floor(durationMs / frameDelay) + 1,
    );
    return {
      existingJob,
      existingJobId: String(existingJob?.id || options?.existingJobId || '').trim(),
      workerInput,
      sceneDoc,
      exportOptions,
      audioTrack,
      format,
      renderer: String(options?.renderer || workerInput?.renderer || existingJob?.renderer || 'browser-hybrid').trim() || 'browser-hybrid',
      durationMs,
      frameRate,
      width,
      height,
      frameDelay,
      frameCount,
      hasAudioLane: exportOptions?.audioRequested === true || !!String(audioTrack?.source || '').trim(),
    };
  }

  async function renderCreativeExportCanvasAtTimeline(atMs = 0, format = 'png') {
    const durationMs = deps.getTimelineDurationMs?.() || 0;
    const nextAtMs = Math.max(0, Math.min(durationMs, Number(atMs) || 0));
    deps.setTimelinePosition?.(nextAtMs, { render: false, persist: false });
    deps.renderWorkspace?.();
    await waitForCreativeExportPaint(1);
    await deps.syncVideoElements?.({ atMs: nextAtMs });
    if (deps.isFabricRendererAvailable?.(deps.getMode?.())) {
      await Promise.resolve(deps.getFabricRenderPromise?.()).catch(() => null);
    }
    return deps.renderExportCanvas?.(format);
  }

  async function exportCreativeVideoRecording(format = 'webm', options = {}) {
    const context = resolveCreativeExportContext(format, options);
    const exportConfig = getCreativeVideoExportConfig(context.format || format);
    if (deps.normalizeMode?.(deps.getMode?.()) !== 'video') {
      throw new Error(`${String(format || 'video').toUpperCase()} export is only available in Video mode.`);
    }
    if (deps.isExportActive?.()) {
      deps.showToast?.('Creative export already running', 'Wait for the current export to finish before starting another one.', 'info');
      return;
    }
    if (!exportConfig?.mimeType) {
      throw new Error(`No supported ${String(format || 'video').toUpperCase()} encoder is available in this browser.`);
    }
    const durationMs = context.durationMs;
    const exportFrameRate = context.frameRate;
    const sceneDoc = context.sceneDoc;
    const width = context.width;
    const height = context.height;
    const videoBitsPerSecond = Math.max(2_000_000, Math.min(12_000_000, Math.round(width * height * exportFrameRate * 0.18)));
    const hasAudioLane = context.hasAudioLane;
    const wasPlaying = deps.isPlaybackActive?.();
    const previousTimelineMs = deps.getTimelineMs?.() || 0;
    const previousExportState = deps.getActiveExport?.() || null;
    let exportStream = null;
    let exportAudioSession = null;
    let exportCanceled = false;
    let exportAudioOutcome = {
      requested: hasAudioLane,
      included: false,
      reason: hasAudioLane ? 'pending' : 'not_requested',
      analysisStatus: context.exportOptions?.audioAnalysisStatus || sceneDoc?.audioTrack?.analysis?.status || null,
    };
    let serverRenderJob = context.existingJobId ? { id: context.existingJobId } : null;
    const recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = width;
    recordingCanvas.height = height;
    const recordingCtx = recordingCanvas.getContext('2d', { alpha: false });
    if (!recordingCtx) {
      throw new Error('Video export canvas is unavailable.');
    }

    const restoreTimelineState = () => {
      deps.setTimelinePosition?.(previousTimelineMs, { render: false, persist: false });
      deps.setActiveExport?.(previousExportState);
      if (wasPlaying) {
        deps.playPlayback?.();
      } else {
        deps.renderWorkspace?.();
      }
      deps.persistActiveChat?.();
    };

    try {
      if (wasPlaying) deps.stopPlayback?.({ persist: false });
      if (!serverRenderJob?.id) {
        try {
          serverRenderJob = await deps.createCreativeRenderJob?.({
            mode: 'video',
            format: exportConfig.extension,
            renderer: context.renderer,
            autoStart: options.autoStart === true,
            doc: sceneDoc,
            exportOptions: {
              durationMs,
              frameRate: exportFrameRate,
              width,
              height,
              audioRequested: hasAudioLane,
              audioAnalysisStatus: context.exportOptions?.audioAnalysisStatus || sceneDoc?.audioTrack?.analysis?.status || null,
              audioSourceDurationMs: context.exportOptions?.audioSourceDurationMs ?? sceneDoc?.audioTrack?.analysis?.durationMs ?? null,
              audioActiveDurationMs: context.exportOptions?.audioActiveDurationMs ?? sceneDoc?.audioTrack?.durationMs ?? null,
              audioTrimStartMs: context.exportOptions?.audioTrimStartMs ?? sceneDoc?.audioTrack?.trimStartMs ?? 0,
              audioTrimEndMs: context.exportOptions?.audioTrimEndMs ?? sceneDoc?.audioTrack?.trimEndMs ?? 0,
            },
            metadata: {
              audioRequested: hasAudioLane,
              exportLabel: exportConfig.label,
              audioAnalysisStatus: context.exportOptions?.audioAnalysisStatus || sceneDoc?.audioTrack?.analysis?.status || null,
            },
          });
        } catch (jobErr) {
          deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.()}: could not create backend render job (${String(jobErr?.message || jobErr)}).`);
        }
      }
      deps.resetExportUiStamp?.();
      deps.setActiveExport?.({
        format: exportConfig.format,
        serverJobId: serverRenderJob?.id || '',
        renderer: context.renderer,
        startedAt: Date.now(),
        frameRate: exportFrameRate,
        progress: 0,
        elapsedMs: 0,
        cancelRequested: false,
        status: 'recording',
        audioRequested: hasAudioLane,
        audioEnabled: false,
      });
      deps.renderWorkspace?.();
      if (serverRenderJob?.id) {
        deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
          status: 'running',
          progress: 0,
          progressLabel: 'Preparing recorder',
        }, { force: true });
      }
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: recording ${exportConfig.label} export (${deps.formatTimelineTime?.(durationMs)} at ${exportFrameRate} fps).`);
      deps.showToast?.(
        `Recording ${exportConfig.label} export`,
        hasAudioLane ? 'The draft is recording in real time and will try to include the armed audio lane.' : 'This first pass records the full draft in real time.',
        'info',
      );

      const firstFrame = await renderCreativeExportCanvasAtTimeline(0, 'png');
      recordingCtx.clearRect(0, 0, width, height);
      recordingCtx.drawImage(firstFrame, 0, 0, width, height);

      const stream = recordingCanvas.captureStream(exportFrameRate);
      exportStream = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (hasAudioLane) {
        try {
          exportAudioSession = await deps.createCreativeExportAudioSession?.(context.audioTrack, durationMs);
          if (exportAudioSession?.readiness) {
            exportAudioOutcome = {
              requested: true,
              included: false,
              reason: exportAudioSession.readiness.reason || 'pending',
              analysisStatus: exportAudioSession.readiness.analysisStatus || exportAudioOutcome.analysisStatus || null,
            };
          }
          const audioTracks = exportAudioSession?.destination?.stream?.getAudioTracks?.() || [];
          audioTracks.forEach((track) => stream.addTrack(track));
          exportAudioOutcome = {
            ...exportAudioOutcome,
            included: audioTracks.length > 0,
            reason: audioTracks.length > 0 ? 'attached' : (exportAudioOutcome.reason || 'no_audio_tracks'),
          };
          deps.refreshExportChrome?.({ audioEnabled: audioTracks.length > 0 }, { force: true });
          if (!audioTracks.length) {
            deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.()}: audio lane was armed but no export audio track could be attached in this browser.`);
          }
        } catch (err) {
          exportAudioSession = null;
          exportAudioOutcome = {
            requested: true,
            included: false,
            reason: 'attach_failed',
            analysisStatus: exportAudioOutcome.analysisStatus || null,
            error: String(err?.message || err),
          };
          deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.()}: could not attach export audio (${String(err?.message || err)}).`);
        }
      }
      const chunks = [];
      const stopPromise = new Promise((resolve, reject) => {
        let settled = false;
        const finalize = (handler, value) => {
          if (settled) return;
          settled = true;
          handler(value);
        };
        const recorder = new MediaRecorder(stream, { mimeType: exportConfig.mimeType, videoBitsPerSecond });
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = (event) => {
          const error = event?.error || new Error('Creative video export failed.');
          finalize(reject, error);
        };
        recorder.onstop = () => finalize(resolve, recorder);
        recorder.start(Math.max(200, Math.round(1000 / exportFrameRate)));
        videoTrack?.requestFrame?.();

        (async () => {
          const startedAt = performance.now();
          let nextTickAt = startedAt;
          await exportAudioSession?.sync(0, { forceSeek: true });
          while (true) {
            if (deps.getActiveExport?.()?.cancelRequested) {
              exportCanceled = true;
              throw new Error('Creative export canceled.');
            }
            const elapsedMs = performance.now() - startedAt;
            if (elapsedMs >= durationMs) break;
            const targetMs = Math.min(durationMs, elapsedMs);
            await exportAudioSession?.sync(targetMs, { forceSeek: false });
            const frameCanvas = await renderCreativeExportCanvasAtTimeline(targetMs, 'png');
            recordingCtx.clearRect(0, 0, width, height);
            recordingCtx.drawImage(frameCanvas, 0, 0, width, height);
            videoTrack?.requestFrame?.();
            deps.refreshExportChrome?.({
              progress: durationMs > 0 ? targetMs / durationMs : 0,
              elapsedMs: targetMs,
              status: 'recording',
            });
            nextTickAt += 1000 / exportFrameRate;
            const waitMs = nextTickAt - performance.now();
            if (waitMs > 4) await waitForCreativeExportDelay(waitMs);
          }
          await exportAudioSession?.sync(durationMs, { forceSeek: true });
          const finalFrame = await renderCreativeExportCanvasAtTimeline(durationMs, 'png');
          recordingCtx.clearRect(0, 0, width, height);
          recordingCtx.drawImage(finalFrame, 0, 0, width, height);
          videoTrack?.requestFrame?.();
          deps.refreshExportChrome?.({ progress: 1, elapsedMs: durationMs, status: 'finalizing' }, { force: true });
          await waitForCreativeExportDelay(Math.max(80, Math.round(1000 / exportFrameRate)));
          recorder.stop();
        })().catch((err) => {
          finalize(reject, err);
          try {
            recorder.stop();
          } catch {}
        });
      });

      await stopPromise;
      if (exportCanceled) {
        if (serverRenderJob?.id) {
          await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
            status: 'canceled',
            progressLabel: 'Canceled',
            cancelRequested: false,
          }, { force: true });
          deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
        }
        deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: canceled ${exportConfig.label} export.`);
        deps.showToast?.(`${exportConfig.label} export canceled`, 'The export stopped before writing a file.', 'info');
        return;
      }
      const blob = new Blob(chunks, { type: chunks[0]?.type || exportConfig.mimeType || `video/${exportConfig.extension}` });
      const filename = `${deps.getExportBaseName?.(exportConfig.extension)}.${exportConfig.extension}`;
      if (!options.skipDownload) deps.downloadBlob?.(blob, filename);
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: exported ${exportConfig.label} (${deps.formatTimelineTime?.(durationMs)}).`);
      deps.refreshExportChrome?.({ progress: 1, elapsedMs: durationMs, status: 'uploading' }, { force: true });
      let exportResult = null;
      if (serverRenderJob?.id) {
        exportResult = await deps.finalizeCreativeRenderJobBundle?.({
          jobId: serverRenderJob?.id,
          blob,
          extension: exportConfig.extension,
          mimeType: blob.type || exportConfig.mimeType,
          mode: 'video',
          metadata: {
            audioRequested: exportAudioOutcome.requested,
            audioIncluded: exportAudioOutcome.included,
            audioOutcome: exportAudioOutcome.reason,
            audioAnalysisStatus: exportAudioOutcome.analysisStatus || null,
            audioError: exportAudioOutcome.error || null,
          },
        });
      } else {
        exportResult = await deps.persistCreativeExportBundle?.({ blob, extension: exportConfig.extension, mimeType: blob.type || exportConfig.mimeType, mode: 'video' });
      }
      deps.showToast?.(`${exportConfig.label} export complete`, `${filename} is ready.`, 'success');
      return {
        format: exportConfig.format,
        extension: exportConfig.extension,
        mimeType: blob.type || exportConfig.mimeType,
        filename,
        path: exportResult?.path || null,
        absPath: exportResult?.absPath || null,
        size: exportResult?.size || blob.size || 0,
        storageRoot: exportResult?.storageRoot || null,
        storageRootRelative: exportResult?.storageRootRelative || null,
      };
    } catch (err) {
      if (exportCanceled || /canceled/i.test(String(err?.message || err))) {
        if (serverRenderJob?.id) {
          await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
            status: 'canceled',
            progressLabel: 'Canceled',
            cancelRequested: false,
          }, { force: true });
          deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
        }
        deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: canceled ${exportConfig?.label || 'video'} export.`);
        deps.showToast?.(`${exportConfig?.label || 'Video'} export canceled`, 'The export stopped before writing a file.', 'info');
        return;
      }
      if (serverRenderJob?.id) {
        await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
          status: 'failed',
          progressLabel: 'Export failed',
          error: String(err?.message || err),
          cancelRequested: false,
        }, { force: true });
        deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
      }
      throw err;
    } finally {
      exportAudioSession?.stop?.();
      exportStream?.getTracks?.().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      restoreTimelineState();
    }
  }

  async function exportCreativeVideoGif(options = {}) {
    const context = resolveCreativeExportContext('gif', options);
    const exportConfig = getCreativeGifExportConfig();
    if (deps.normalizeMode?.(deps.getMode?.()) !== 'video') {
      throw new Error('GIF export is only available in Video mode.');
    }
    if (deps.isExportActive?.()) {
      deps.showToast?.('Creative export already running', 'Wait for the current export to finish before starting another one.', 'info');
      return;
    }
    if (!exportConfig) {
      throw new Error('GIF export is unavailable because the encoder did not load.');
    }
    const durationMs = context.durationMs;
    const gifFrameRate = context.frameRate;
    const frameDelay = context.frameDelay;
    const frameCount = context.frameCount;
    const wasPlaying = deps.isPlaybackActive?.();
    const previousTimelineMs = deps.getTimelineMs?.() || 0;
    const previousExportState = deps.getActiveExport?.() || null;
    const hasAudioLane = context.hasAudioLane;
    let exportCanceled = false;
    let gifEncoder = null;
    const exportAudioOutcome = {
      requested: hasAudioLane,
      included: false,
      reason: hasAudioLane ? 'gif_unsupported' : 'not_requested',
      analysisStatus: context.exportOptions?.audioAnalysisStatus || context.sceneDoc?.audioTrack?.analysis?.status || null,
      error: null,
    };
    let serverRenderJob = context.existingJobId ? { id: context.existingJobId } : null;

    const restoreTimelineState = () => {
      deps.setTimelinePosition?.(previousTimelineMs, { render: false, persist: false });
      deps.setActiveExport?.(previousExportState);
      if (wasPlaying) {
        deps.playPlayback?.();
      } else {
        deps.renderWorkspace?.();
      }
      deps.persistActiveChat?.();
    };

    try {
      if (wasPlaying) deps.stopPlayback?.({ persist: false });
      if (!serverRenderJob?.id) {
        try {
          serverRenderJob = await deps.createCreativeRenderJob?.({
            mode: 'video',
            format: 'gif',
            renderer: context.renderer,
            autoStart: options.autoStart === true,
            doc: context.sceneDoc,
            exportOptions: {
              durationMs,
              frameRate: gifFrameRate,
              frameCount,
              audioRequested: hasAudioLane,
              audioAnalysisStatus: context.exportOptions?.audioAnalysisStatus || context.sceneDoc?.audioTrack?.analysis?.status || null,
              audioSourceDurationMs: context.exportOptions?.audioSourceDurationMs ?? context.sceneDoc?.audioTrack?.analysis?.durationMs ?? null,
              audioActiveDurationMs: context.exportOptions?.audioActiveDurationMs ?? context.sceneDoc?.audioTrack?.durationMs ?? null,
              audioTrimStartMs: context.exportOptions?.audioTrimStartMs ?? context.sceneDoc?.audioTrack?.trimStartMs ?? 0,
              audioTrimEndMs: context.exportOptions?.audioTrimEndMs ?? context.sceneDoc?.audioTrack?.trimEndMs ?? 0,
            },
            metadata: {
              audioRequested: hasAudioLane,
              exportLabel: 'GIF',
              audioAnalysisStatus: context.exportOptions?.audioAnalysisStatus || context.sceneDoc?.audioTrack?.analysis?.status || null,
            },
          });
        } catch (jobErr) {
          deps.addProcessEntry?.('warn', `${deps.getStructuredModeLabel?.()}: could not create backend render job (${String(jobErr?.message || jobErr)}).`);
        }
      }
      deps.resetExportUiStamp?.();
      deps.setActiveExport?.({
        format: exportConfig.format,
        serverJobId: serverRenderJob?.id || '',
        renderer: context.renderer,
        startedAt: Date.now(),
        frameRate: gifFrameRate,
        progress: 0,
        elapsedMs: 0,
        cancelRequested: false,
        status: 'capturing',
        audioRequested: hasAudioLane,
        audioEnabled: false,
        abort: () => {
          exportCanceled = true;
          try { gifEncoder?.abort?.(); } catch {}
        },
      });
      deps.renderWorkspace?.();
      if (serverRenderJob?.id) {
        deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
          status: 'running',
          progress: 0,
          progressLabel: 'Preparing GIF encoder',
        }, { force: true });
      }
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: capturing GIF export (${frameCount} frames at ${gifFrameRate} fps).`);
      deps.showToast?.('Capturing GIF export', hasAudioLane ? 'GIF export is visual-only, so the armed audio lane will not be included.' : 'Rendering frames for the animated GIF now.', 'info');

      gifEncoder = new exportConfig.GifCtor({
        workers: 2,
        quality: 10,
        width: context.width,
        height: context.height,
        workerScript: exportConfig.workerScript,
        background: context.sceneDoc?.background || '#ffffff',
      });

      for (let index = 0; index < frameCount; index += 1) {
        if (deps.getActiveExport?.()?.cancelRequested) {
          exportCanceled = true;
          throw new Error('Creative export canceled.');
        }
        const atMs = index === frameCount - 1
          ? durationMs
          : Math.min(durationMs, Math.round(index * frameDelay));
        const frameCanvas = await renderCreativeExportCanvasAtTimeline(atMs, 'png');
        gifEncoder.addFrame(frameCanvas, { copy: true, delay: frameDelay });
        deps.refreshExportChrome?.({
          progress: frameCount > 0 ? ((index + 1) / frameCount) * 0.72 : 0,
          elapsedMs: atMs,
          status: 'capturing',
        });
      }

      deps.refreshExportChrome?.({ progress: 0.74, elapsedMs: durationMs, status: 'encoding' }, { force: true });
      const gifBlob = await new Promise((resolve, reject) => {
        gifEncoder.on('progress', (progress) => {
          deps.refreshExportChrome?.({
            progress: 0.74 + (clamp(Number(progress) || 0, 0, 1) * 0.24),
            elapsedMs: durationMs,
            status: deps.getActiveExport?.()?.cancelRequested ? 'canceling' : 'encoding',
          });
          if (deps.getActiveExport?.()?.cancelRequested) {
            exportCanceled = true;
            try { gifEncoder.abort(); } catch {}
          }
        });
        gifEncoder.on('finished', (blob) => resolve(blob));
        gifEncoder.on('abort', () => reject(new Error('Creative export canceled.')));
        gifEncoder.on('error', (error) => reject(error || new Error('GIF export failed.')));
        gifEncoder.render();
      });

      if (exportCanceled) {
        if (serverRenderJob?.id) {
          await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
            status: 'canceled',
            progressLabel: 'Canceled',
            cancelRequested: false,
          }, { force: true });
          deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
        }
        deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: canceled GIF export.`);
        deps.showToast?.('GIF export canceled', 'The export stopped before writing a file.', 'info');
        return;
      }
      const blob = gifBlob instanceof Blob ? gifBlob : new Blob([gifBlob], { type: exportConfig.mimeType });
      const filename = `${deps.getExportBaseName?.('gif')}.gif`;
      if (!options.skipDownload) deps.downloadBlob?.(blob, filename);
      deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: exported GIF (${deps.formatTimelineTime?.(durationMs)}).`);
      deps.refreshExportChrome?.({ progress: 1, elapsedMs: durationMs, status: 'uploading' }, { force: true });
      let exportResult = null;
      if (serverRenderJob?.id) {
        exportResult = await deps.finalizeCreativeRenderJobBundle?.({
          jobId: serverRenderJob?.id,
          blob,
          extension: 'gif',
          mimeType: exportConfig.mimeType,
          mode: 'video',
          metadata: {
            audioRequested: exportAudioOutcome.requested,
            audioIncluded: exportAudioOutcome.included,
            audioOutcome: exportAudioOutcome.reason,
            audioAnalysisStatus: exportAudioOutcome.analysisStatus || null,
            audioError: exportAudioOutcome.error,
          },
        });
      } else {
        exportResult = await deps.persistCreativeExportBundle?.({ blob, extension: 'gif', mimeType: exportConfig.mimeType, mode: 'video' });
      }
      deps.showToast?.('GIF export complete', `${filename} is ready.`, 'success');
      return {
        format: 'gif',
        extension: 'gif',
        mimeType: exportConfig.mimeType,
        filename,
        path: exportResult?.path || null,
        absPath: exportResult?.absPath || null,
        size: exportResult?.size || blob.size || 0,
        storageRoot: exportResult?.storageRoot || null,
        storageRootRelative: exportResult?.storageRootRelative || null,
      };
    } catch (err) {
      if (exportCanceled || /canceled/i.test(String(err?.message || err))) {
        if (serverRenderJob?.id) {
          await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
            status: 'canceled',
            progressLabel: 'Canceled',
            cancelRequested: false,
          }, { force: true });
          deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
        }
        deps.addProcessEntry?.('info', `${deps.getStructuredModeLabel?.()}: canceled GIF export.`);
        deps.showToast?.('GIF export canceled', 'The export stopped before writing a file.', 'info');
        return;
      }
      if (serverRenderJob?.id) {
        await deps.reportCreativeRenderJobProgress?.(serverRenderJob.id, {
          status: 'failed',
          progressLabel: 'GIF export failed',
          error: String(err?.message || err),
          cancelRequested: false,
        }, { force: true });
        deps.clearCreativeRenderJobReportState?.(serverRenderJob.id);
      }
      throw err;
    } finally {
      restoreTimelineState();
    }
  }

  return {
    getCreativeVideoExportConfig,
    getCreativeGifExportConfig,
    waitForCreativeExportDelay,
    waitForCreativeExportPaint,
    renderCreativeExportCanvasAtTimeline,
    exportCreativeVideoRecording,
    exportCreativeVideoGif,
  };
}
