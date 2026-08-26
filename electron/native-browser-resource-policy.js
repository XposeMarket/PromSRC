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

// Electron's app.getAppMetrics() memory fields are kilobytes. Keep that
// conversion at the Electron API boundary so every consumer below works in
// bytes, including the fallback supplied by webContents.getProcessMemoryInfo().
function kilobytesToBytes(value) {
  if (value == null || value === '') return null;
  const kilobytes = finiteNumber(value);
  return kilobytes == null ? null : Math.max(0, kilobytes * 1024);
}

function normalizeElectronProcessMetric(processMetric) {
  if (!processMetric || typeof processMetric !== 'object') return null;
  const memory = processMetric.memory && typeof processMetric.memory === 'object'
    ? processMetric.memory
    : {};
  return {
    ...processMetric,
    type: String(processMetric.type || '').slice(0, 48),
    cpu: processMetric.cpu && typeof processMetric.cpu === 'object'
      ? {
        ...processMetric.cpu,
        percentCPUUsage: nonNegativeNumber(processMetric.cpu.percentCPUUsage),
      }
      : processMetric.cpu,
    memory: {
      ...memory,
      privateBytes: kilobytesToBytes(memory.privateBytes),
      workingSetSize: kilobytesToBytes(memory.workingSetSize),
      peakWorkingSetSize: kilobytesToBytes(memory.peakWorkingSetSize),
    },
  };
}

function normalizeElectronProcessMetrics(processMetrics) {
  return (Array.isArray(processMetrics) ? processMetrics : [])
    .map(normalizeElectronProcessMetric)
    .filter(Boolean);
}

function getNativeBrowserOSProcessId(webContents) {
  const processId = Number(webContents?.getOSProcessId?.() || 0);
  return Number.isInteger(processId) && processId > 0 ? processId : null;
}

function findNativeBrowserProcessMetric(processMetrics, osProcessId) {
  const processId = Number(osProcessId);
  if (!Number.isInteger(processId) || processId <= 0) return null;
  return (Array.isArray(processMetrics) ? processMetrics : [])
    .find((candidate) => Number(candidate?.pid) === processId) || null;
}

function processType(processMetric) {
  return String(processMetric?.type || '').trim().toLowerCase();
}

function isMainProcess(processMetric) {
  const type = processType(processMetric);
  return type === 'browser' || type === 'main';
}

function isRendererProcess(processMetric) {
  const type = processType(processMetric);
  return type === 'tab' || type === 'renderer' || type.includes('renderer');
}

function isGPUProcess(processMetric) {
  const type = processType(processMetric);
  return type === 'gpu' || type.includes('gpu');
}

function isUtilityProcess(processMetric) {
  const type = processType(processMetric);
  return type === 'utility' || type.includes('utility');
}

function sumKnownMetricValues(processMetrics, selector) {
  const values = (Array.isArray(processMetrics) ? processMetrics : [])
    .map(selector)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map((value) => Math.max(0, Number(value)));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function summarizeNativeBrowserProcessGroup(processMetrics) {
  const metrics = Array.isArray(processMetrics) ? processMetrics : [];
  return {
    processCount: metrics.length,
    pids: metrics
      .map((metric) => Number(metric?.pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
    cpuPercent: sumKnownMetricValues(metrics, (metric) => metric?.cpu?.percentCPUUsage),
    memory: {
      privateBytes: sumKnownMetricValues(metrics, (metric) => metric?.memory?.privateBytes),
      workingSetBytes: sumKnownMetricValues(metrics, (metric) => metric?.memory?.workingSetSize),
      peakWorkingSetBytes: sumKnownMetricValues(metrics, (metric) => metric?.memory?.peakWorkingSetSize),
    },
  };
}

function buildNativeBrowserProcessBreakdown(processMetrics, activeRendererProcessId = null) {
  const metrics = Array.isArray(processMetrics) ? processMetrics : [];
  const main = metrics.filter(isMainProcess);
  const renderer = metrics.filter(isRendererProcess);
  const gpu = metrics.filter(isGPUProcess);
  const utility = metrics.filter(isUtilityProcess);
  const categorized = new Set([...main, ...renderer, ...gpu, ...utility]);
  const other = metrics.filter((metric) => !categorized.has(metric));
  const activeProcessId = Number(activeRendererProcessId);
  const activeRenderer = Number.isInteger(activeProcessId) && activeProcessId > 0
    ? metrics.filter((metric) => Number(metric?.pid) === activeProcessId)
    : [];
  const total = summarizeNativeBrowserProcessGroup(metrics);
  const totalPressure = classifyNativeBrowserResourcePressure({
    cpuPercent: total.cpuPercent,
    privateBytes: total.memory.privateBytes,
    page: {},
  });

  return {
    total,
    pressure: totalPressure,
    main: summarizeNativeBrowserProcessGroup(main),
    renderer: summarizeNativeBrowserProcessGroup(renderer),
    activeRenderer: summarizeNativeBrowserProcessGroup(activeRenderer),
    gpu: summarizeNativeBrowserProcessGroup(gpu),
    utility: summarizeNativeBrowserProcessGroup(utility),
    other: summarizeNativeBrowserProcessGroup(other),
  };
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
  attached = false,
  backgroundThrottling = true,
  processId = null,
  processMetric = null,
  processMemory = null,
  processBreakdown = null,
  gpu = null,
  page = null,
} = {}) {
  // processMetric and processMemory are already byte-normalized at this API.
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
    attached: attached === true,
    backgroundThrottling: backgroundThrottling !== false,
    processId: Number.isInteger(Number(processId)) && Number(processId) > 0 ? Number(processId) : null,
    cpuPercent,
    memory: {
      privateBytes,
      workingSetBytes,
      peakWorkingSetBytes,
    },
    processBreakdown,
    gpu,
    page: normalizedPage,
    pressure,
  };
}

module.exports = {
  NATIVE_BROWSER_RESOURCE_THRESHOLDS,
  buildNativeBrowserProcessBreakdown,
  buildNativeBrowserResourceRecord,
  classifyNativeBrowserResourcePressure,
  findNativeBrowserProcessMetric,
  getNativeBrowserOSProcessId,
  normalizeElectronProcessMetric,
  normalizeElectronProcessMetrics,
  normalizePageMetrics,
};
