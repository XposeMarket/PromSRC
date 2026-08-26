'use strict';

// Resource diagnostics are intentionally advisory. A visible page may be a
// game, video, or other legitimate high-CPU workload, so the policy records
// pressure and throttles only views that are not presented. It never destroys
// or reloads a page based on a sample.
const NATIVE_BROWSER_RESOURCE_THRESHOLDS = Object.freeze({
  cpuPercent: 60,
  privateBytes: 512 * 1024 * 1024,
  jsHeapRatio: 0.75,
});

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  return number == null ? fallback : Math.max(0, number);
}

function normalizePageMetrics(page = {}) {
  const usedJSHeapBytes = nonNegativeNumber(page.usedJSHeapBytes);
  const totalJSHeapBytes = nonNegativeNumber(page.totalJSHeapBytes);
  const jsHeapLimitBytes = nonNegativeNumber(page.jsHeapLimitBytes);
  const jsHeapRatio = totalJSHeapBytes > 0
    ? Math.min(1, Math.max(0, usedJSHeapBytes / totalJSHeapBytes))
    : null;

  return {
    visibilityState: String(page.visibilityState || '').slice(0, 24),
    hidden: page.hidden === true,
    readyState: String(page.readyState || '').slice(0, 24),
    canvasCount: Math.max(0, Math.floor(nonNegativeNumber(page.canvasCount, 0))),
    devicePixelRatio: nonNegativeNumber(page.devicePixelRatio),
    usedJSHeapBytes,
    totalJSHeapBytes,
    jsHeapLimitBytes,
    jsHeapRatio,
    timedOut: page.timedOut === true,
    unavailable: page.unavailable === true,
  };
}

function classifyNativeBrowserResourcePressure({ cpuPercent, privateBytes, page } = {}) {
  const reasons = [];
  const normalizedPage = normalizePageMetrics(page);
  if (cpuPercent != null && cpuPercent >= NATIVE_BROWSER_RESOURCE_THRESHOLDS.cpuPercent) {
    reasons.push('cpu');
  }
  if (privateBytes != null && privateBytes >= NATIVE_BROWSER_RESOURCE_THRESHOLDS.privateBytes) {
    reasons.push('private-memory');
  }
  if (normalizedPage.jsHeapRatio != null && normalizedPage.jsHeapRatio >= NATIVE_BROWSER_RESOURCE_THRESHOLDS.jsHeapRatio) {
    reasons.push('js-heap');
  }
  return {
    level: reasons.length ? 'elevated' : 'normal',
    reasons,
  };
}

function buildNativeBrowserResourceRecord({
  sampledAt = Date.now(),
  sessionId = '',
  tabId = '',
  presented = false,
  visible = false,
  backgroundThrottling = true,
  processId = null,
  processMetric = null,
  processMemory = null,
  page = null,
} = {}) {
  const metric = processMetric || {};
  const memory = metric.memory || {};
  const privateBytes = nonNegativeNumber(memory.privateBytes, nonNegativeNumber(processMemory?.privateBytes));
  const workingSetBytes = nonNegativeNumber(memory.workingSetSize, nonNegativeNumber(processMemory?.workingSetBytes));
  const peakWorkingSetBytes = nonNegativeNumber(memory.peakWorkingSetSize);
  const cpuPercent = nonNegativeNumber(metric.cpu?.percentCPUUsage);
  const normalizedPage = normalizePageMetrics(page || { unavailable: true });
  const pressure = classifyNativeBrowserResourcePressure({ cpuPercent, privateBytes, page: normalizedPage });

  return {
    sampledAt: nonNegativeNumber(sampledAt, Date.now()),
    sessionId: String(sessionId || '').slice(0, 160),
    tabId: String(tabId || '').slice(0, 160),
    presented: presented === true,
    visible: visible === true,
    backgroundThrottling: backgroundThrottling !== false,
    processId: Number.isInteger(Number(processId)) && Number(processId) > 0 ? Number(processId) : null,
    cpuPercent,
    memory: {
      privateBytes,
      workingSetBytes,
      peakWorkingSetBytes,
    },
    page: normalizedPage,
    pressure,
  };
}

module.exports = {
  NATIVE_BROWSER_RESOURCE_THRESHOLDS,
  buildNativeBrowserResourceRecord,
  classifyNativeBrowserResourcePressure,
  normalizePageMetrics,
};
