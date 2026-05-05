function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_WAVEFORM_BUCKETS = 240;

let creativeAudioPreviewElement = null;

function resolveCreativeAudioSourceUrl(track = {}, options = {}) {
  const normalized = normalizeCreativeAudioTrackConfig(track);
  const source = String(normalized.source || '').trim();
  if (!source) return '';
  if (typeof options.resolveSourceUrl === 'function') {
    const resolved = String(options.resolveSourceUrl(source, normalized) || '').trim();
    if (resolved) return resolved;
  }
  return source;
}

export function normalizeCreativeAudioTrackConfig(source = {}) {
  const analysis = source?.analysis && typeof source.analysis === 'object' && !Array.isArray(source.analysis)
    ? {
        status: String(source.analysis.status || '').trim().toLowerCase() || 'unavailable',
        sourceType: String(source.analysis.sourceType || '').trim().toLowerCase() || 'missing',
        source: String(source.analysis.source || ''),
        resolvedPath: source.analysis.resolvedPath ? String(source.analysis.resolvedPath) : null,
        resolvedPathRelative: source.analysis.resolvedPathRelative ? String(source.analysis.resolvedPathRelative) : null,
        analyzedAt: source.analysis.analyzedAt ? String(source.analysis.analyzedAt) : null,
        durationMs: Number.isFinite(Number(source.analysis.durationMs)) ? Math.max(0, Number(source.analysis.durationMs)) : null,
        sampleRate: Number.isFinite(Number(source.analysis.sampleRate)) ? Math.max(1, Number(source.analysis.sampleRate)) : null,
        channels: Number.isFinite(Number(source.analysis.channels)) ? Math.max(1, Number(source.analysis.channels)) : null,
        bitRate: Number.isFinite(Number(source.analysis.bitRate)) ? Math.max(0, Number(source.analysis.bitRate)) : null,
        codec: source.analysis.codec ? String(source.analysis.codec) : null,
        mimeType: source.analysis.mimeType ? String(source.analysis.mimeType) : null,
        size: Number.isFinite(Number(source.analysis.size)) ? Math.max(0, Number(source.analysis.size)) : null,
        waveformBucketCount: Math.max(0, Number(source.analysis.waveformBucketCount) || 0),
        waveformPeaks: Array.isArray(source.analysis.waveformPeaks)
          ? source.analysis.waveformPeaks
              .map((entry) => clamp(Number(entry) || 0, 0, 1))
              .filter((entry) => Number.isFinite(entry))
          : [],
        cachePath: source.analysis.cachePath ? String(source.analysis.cachePath) : null,
        cachePathRelative: source.analysis.cachePathRelative ? String(source.analysis.cachePathRelative) : null,
        error: source.analysis.error ? String(source.analysis.error) : null,
      }
    : null;
  return {
    source: String(source.source || ''),
    label: String(source.label || ''),
    startMs: Math.max(0, Number(source.startMs) || 0),
    durationMs: Math.max(0, Number(source.durationMs) || 0),
    trimStartMs: Math.max(0, Number(source.trimStartMs) || 0),
    trimEndMs: Math.max(0, Number(source.trimEndMs) || 0),
    volume: clamp(Number.isFinite(Number(source.volume)) ? Number(source.volume) : 1, 0, 1),
    muted: source.muted === true,
    fadeInMs: Math.max(0, Number(source.fadeInMs) || 0),
    fadeOutMs: Math.max(0, Number(source.fadeOutMs) || 0),
    analysis,
  };
}

export function hasCreativeAudioTrackConfig(doc = {}) {
  return !!String(normalizeCreativeAudioTrackConfig(doc?.audioTrack || doc).source || '').trim();
}

export function stopCreativeAudioPreview(options = {}) {
  if (!creativeAudioPreviewElement) return;
  try {
    creativeAudioPreviewElement.pause();
    if (options.reset) creativeAudioPreviewElement.currentTime = 0;
  } catch {}
  if (options.dispose) creativeAudioPreviewElement = null;
}

export function ensureCreativeAudioPreviewElement(track = {}, options = {}) {
  const normalized = normalizeCreativeAudioTrackConfig(track);
  const src = resolveCreativeAudioSourceUrl(normalized, options);
  if (!src) {
    stopCreativeAudioPreview({ reset: true, dispose: true });
    return null;
  }
  if (!creativeAudioPreviewElement || String(creativeAudioPreviewElement.src || '') !== src) {
    stopCreativeAudioPreview({ dispose: true });
    creativeAudioPreviewElement = new Audio(src);
    creativeAudioPreviewElement.preload = 'auto';
    creativeAudioPreviewElement.crossOrigin = 'anonymous';
  }
  return creativeAudioPreviewElement;
}

export function getCreativeAudioTrackWindow(track = {}, durationMs = 12000) {
  const normalized = normalizeCreativeAudioTrackConfig(track);
  const startMs = Math.max(0, Number(normalized.startMs) || 0);
  const trimStartMs = Math.max(0, Number(normalized.trimStartMs) || 0);
  const trimEndMs = Math.max(0, Number(normalized.trimEndMs) || 0);
  const analysisDurationMs = Math.max(0, Number(normalized.analysis?.durationMs) || 0);
  const sourceDurationMs = Math.max(0, Number(normalized.durationMs) || analysisDurationMs || 0);
  const remainingSourceMs = Math.max(0, sourceDurationMs - trimStartMs - trimEndMs);
  const activeDurationMs = normalized.durationMs
    ? Math.min(Math.max(0, Number(normalized.durationMs) || 0), remainingSourceMs || Number(normalized.durationMs) || 0)
    : (remainingSourceMs || Math.max(0, Number(durationMs) - startMs));
  return {
    startMs,
    trimStartMs,
    trimEndMs,
    sourceDurationMs,
    activeDurationMs: Math.max(0, activeDurationMs),
    endMs: startMs + Math.max(0, activeDurationMs),
  };
}

export function getCreativeExportAudioReadiness(track = {}, durationMs = 12000) {
  const normalized = normalizeCreativeAudioTrackConfig(track);
  const timing = getCreativeAudioTrackWindow(normalized, durationMs);
  const src = String(normalized.source || '').trim();
  const analysisStatus = String(normalized.analysis?.status || '').trim().toLowerCase() || 'unavailable';
  if (!src) {
    return {
      requested: false,
      enabled: false,
      reason: 'missing_source',
      analysisStatus,
      track: normalized,
      timing,
    };
  }
  if (typeof MediaStream === 'undefined') {
    return {
      requested: true,
      enabled: false,
      reason: 'media_stream_unavailable',
      analysisStatus,
      track: normalized,
      timing,
    };
  }
  if (!(window.AudioContext || window.webkitAudioContext)) {
    return {
      requested: true,
      enabled: false,
      reason: 'audio_context_unavailable',
      analysisStatus,
      track: normalized,
      timing,
    };
  }
  if (analysisStatus === 'error') {
    return {
      requested: true,
      enabled: false,
      reason: 'analysis_error',
      analysisStatus,
      track: normalized,
      timing,
    };
  }
  if (timing.activeDurationMs <= 0) {
    return {
      requested: true,
      enabled: false,
      reason: 'empty_window',
      analysisStatus,
      track: normalized,
      timing,
    };
  }
  return {
    requested: true,
    enabled: true,
    reason: 'ready',
    analysisStatus,
    track: normalized,
    timing,
  };
}

function getFadeGain(track, relativeMs, activeDurationMs) {
  const normalized = normalizeCreativeAudioTrackConfig(track);
  if (normalized.muted) return 0;
  const base = clamp(Number(normalized.volume) || 0, 0, 1);
  if (relativeMs < 0 || relativeMs > activeDurationMs) return 0;
  let gain = base;
  if (normalized.fadeInMs > 0 && relativeMs < normalized.fadeInMs) {
    gain *= clamp(relativeMs / normalized.fadeInMs, 0, 1);
  }
  if (normalized.fadeOutMs > 0 && relativeMs > Math.max(0, activeDurationMs - normalized.fadeOutMs)) {
    const fadeRemainingMs = Math.max(0, activeDurationMs - relativeMs);
    gain *= clamp(fadeRemainingMs / normalized.fadeOutMs, 0, 1);
  }
  return clamp(gain, 0, 1);
}

export function syncCreativeAudioPreviewToTimeline({
  mode = 'video',
  exportActive = false,
  timelineMs = 0,
  durationMs = 12000,
  track = {},
  playing = false,
  forceSeek = false,
  resolveSourceUrl = null,
} = {}) {
  if (String(mode || '').trim().toLowerCase() !== 'video' || exportActive) {
    stopCreativeAudioPreview();
    return;
  }
  const normalized = normalizeCreativeAudioTrackConfig(track);
  const audio = ensureCreativeAudioPreviewElement(normalized, { resolveSourceUrl });
  if (!audio) return;
  const timing = getCreativeAudioTrackWindow(normalized, durationMs);
  const relativeMs = Number(timelineMs) - timing.startMs;
  const desiredMediaTimeMs = timing.trimStartMs + relativeMs;
  const withinActiveWindow = relativeMs >= 0 && relativeMs <= timing.activeDurationMs;
  audio.volume = getFadeGain(normalized, relativeMs, timing.activeDurationMs);
  audio.muted = normalized.muted === true;

  if (!withinActiveWindow) {
    try { audio.pause(); } catch {}
    return;
  }

  const desiredTime = Math.max(0, desiredMediaTimeMs / 1000);
  const currentTime = Number(audio.currentTime) || 0;
  const shouldSeek = forceSeek === true || Math.abs(currentTime - desiredTime) > (playing ? 0.24 : 0.05);
  if (shouldSeek) {
    try {
      audio.currentTime = desiredTime;
    } catch {}
  }

  if (playing) {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  } else {
    try { audio.pause(); } catch {}
  }
}

export function waitForCreativeMediaReady(media) {
  return new Promise((resolve, reject) => {
    if (!media) {
      reject(new Error('Creative media element is unavailable.'));
      return;
    }
    if (Number(media.readyState) >= 1) {
      resolve(media);
      return;
    }
    const onReady = () => {
      cleanup();
      resolve(media);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not load the creative audio track.'));
    };
    const cleanup = () => {
      media.removeEventListener('loadedmetadata', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', onError);
    };
    media.addEventListener('loadedmetadata', onReady, { once: true });
    media.addEventListener('canplay', onReady, { once: true });
    media.addEventListener('error', onError, { once: true });
  });
}

export async function createCreativeExportAudioSession(track = {}, durationMs = 12000, options = {}) {
  const readiness = getCreativeExportAudioReadiness(track, durationMs);
  const normalized = readiness.track;
  const src = resolveCreativeAudioSourceUrl(normalized, options);
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!readiness.enabled || !src || !AudioContextCtor) {
    return {
      destination: null,
      audio: null,
      audioContext: null,
      track: normalized,
      readiness,
      ...readiness.timing,
      async sync() {},
      stop() {},
    };
  }
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  audio.playsInline = true;
  audio.muted = true;
  audio.volume = 1;
  await waitForCreativeMediaReady(audio);
  const audioContext = new AudioContextCtor();
  const destination = audioContext.createMediaStreamDestination();
  const sourceNode = audioContext.createMediaElementSource(audio);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = normalized.muted ? 0 : normalized.volume;
  sourceNode.connect(gainNode);
  gainNode.connect(destination);
  const timing = readiness.timing;
  let started = false;
  let ended = false;
  return {
    audio,
    audioContext,
    destination,
    track: normalized,
    readiness,
    ...timing,
    async sync(exportAtMs = 0, options = {}) {
      if (ended) return;
      const relativeMs = Number(exportAtMs) - timing.startMs;
      const desiredTime = Math.max(0, (timing.trimStartMs + relativeMs) / 1000);
      gainNode.gain.value = getFadeGain(normalized, relativeMs, timing.activeDurationMs);
      if (relativeMs < 0) {
        if (started) {
          try { audio.pause(); } catch {}
        }
        return;
      }
      if (relativeMs > timing.activeDurationMs) {
        ended = true;
        try { audio.pause(); } catch {}
        return;
      }
      if (!started || options.forceSeek === true || Math.abs((Number(audio.currentTime) || 0) - desiredTime) > 0.18) {
        try { audio.currentTime = desiredTime; } catch {}
      }
      if (audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch {}
      }
      if (audio.paused) {
        try {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.then === 'function') await playPromise.catch(() => {});
        } catch {}
      }
      started = true;
    },
    stop() {
      ended = true;
      try { audio.pause(); } catch {}
      try { sourceNode.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      try { destination.disconnect?.(); } catch {}
      try { audio.removeAttribute('src'); audio.load(); } catch {}
      try {
        if (audioContext && typeof audioContext.close === 'function' && audioContext.state !== 'closed') audioContext.close();
      } catch {}
    },
  };
}

export async function fetchCreativeAudioAnalysis({
  sessionId,
  root = '',
  source = '',
  force = false,
  bucketCount = DEFAULT_WAVEFORM_BUCKETS,
} = {}) {
  const normalizedSource = String(source || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId || !normalizedSource) return null;
  const params = new URLSearchParams({
    sessionId: normalizedSessionId,
    source: normalizedSource,
  });
  if (String(root || '').trim()) params.set('root', String(root || '').trim());
  if (force) params.set('force', '1');
  if (bucketCount) params.set('bucketCount', String(bucketCount));
  const response = await fetch(`/api/canvas/creative-audio-analysis?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data?.track || data?.analysis || null;
}
