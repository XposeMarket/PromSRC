const RENDERER_SAMPLE_INTERVAL_MS = 2000;

export function installRendererPerformanceTelemetry({
  windowRef = globalThis.window,
  markClientPerformance = () => {},
  shouldBootMobile = false,
} = {}) {
  let rendererPerformanceObserver = null;
  let rendererPerformanceSampleTimer = null;
  const performanceRef = windowRef?.performance || globalThis.performance;

  function rendererPerformanceDetails() {
    const details = {
      surface: shouldBootMobile ? 'mobile' : 'desktop',
    };
    try {
      details.domNodes = windowRef?.document?.getElementsByTagName?.('*')?.length || 0;
    } catch {}
    const memory = performanceRef?.memory;
    if (memory && typeof memory === 'object') {
      details.jsHeapUsedBytes = memory.usedJSHeapSize;
      details.jsHeapTotalBytes = memory.totalJSHeapSize;
      details.jsHeapLimitBytes = memory.jsHeapSizeLimit;
    }
    return details;
  }

  function markRendererPerformanceSample() {
    markClientPerformance('renderer_sample', rendererPerformanceDetails());
  }

  function stopRendererPerformanceTelemetry() {
    if (rendererPerformanceObserver) {
      try { rendererPerformanceObserver.disconnect(); } catch {}
      rendererPerformanceObserver = null;
    }
    if (rendererPerformanceSampleTimer !== null) {
      windowRef?.clearInterval?.(rendererPerformanceSampleTimer);
      rendererPerformanceSampleTimer = null;
    }
  }

  const PerformanceObserverCtor = windowRef?.PerformanceObserver;
  if (typeof PerformanceObserverCtor === 'function') {
    try {
      rendererPerformanceObserver = new PerformanceObserverCtor((list) => {
        const entries = list.getEntries();
        if (!entries.length) return;
        let totalDurationMs = 0;
        let maxDurationMs = 0;
        entries.forEach((entry) => {
          const durationMs = Math.max(0, Number(entry.duration) || 0);
          totalDurationMs += durationMs;
          maxDurationMs = Math.max(maxDurationMs, durationMs);
        });
        markClientPerformance('renderer_long_task_batch', {
          surface: shouldBootMobile ? 'mobile' : 'desktop',
          count: entries.length,
          durationMs: totalDurationMs,
          longTaskMaxMs: maxDurationMs,
        });
      });
      rendererPerformanceObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      rendererPerformanceObserver = null;
    }
  }
  rendererPerformanceSampleTimer = windowRef?.setInterval?.(markRendererPerformanceSample, RENDERER_SAMPLE_INTERVAL_MS) ?? null;
  windowRef?.addEventListener?.('pagehide', stopRendererPerformanceTelemetry, { once: true });
  if (windowRef) windowRef.__PROM_RENDERER_PERF_STOP = stopRendererPerformanceTelemetry;
  return stopRendererPerformanceTelemetry;
}
