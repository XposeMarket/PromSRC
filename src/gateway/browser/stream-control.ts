
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

import { broadcastWS } from '../comms/broadcaster';
import { normalizeScreenshotBuffer } from '../screenshot-normalize.js';

import { getUserChromeExtensionOnboarding, getUserChromeRelay } from '../user-chrome-relay.js';

import { BrowserLiveStreamTransport, BrowserLiveStreamFocus, normalizeBrowserLiveStreamFocus, browserLiveStreams, refreshBrowserLiveStreamLease, broadcastBrowserLiveStreamStatus, BROWSER_STREAM_HEARTBEAT_STATUS, stopBrowserLiveStream, BrowserLiveStreamState, tryStartBrowserCDPStream, startBrowserSnapshotStreamLoop } from './streaming.js';
import { resolveSessionId } from './extraction.js';
import { getInHouseSession, callInHouseBrowser } from './inhouse.js';
import { getOrCreateSession, getStableBrowserIdentity, getPersistentBrowserPort, getRealChromeProfileDir, resolvePersistentBrowserProfileDir } from './profiles.js';
import { syncPageMetadata } from './observation.js';
import { sessions } from './state.js';
import { recoverInHouseSessionMapping, shouldUseInHouseBrowser } from './inhouse-sessions.js';
import { getBrowserSessionMetadata, registerBrowserSessionMetadata } from './sessions.js';
import { getMainBrowserTarget } from './target.js';
import { getUserChromeDebugPort, getMainChromeDebugPort, findBrowserExecutableForPlaywright, isPortOpen, getPW, connectOverCDPWithTimeout, getBrowserProfileLabel } from './chrome.js';


export async function startBrowserLiveStream(
  sessionId: string,
  options?: { focus?: unknown; preferCdp?: boolean; restoreUrl?: string; restoreTitle?: string },
): Promise<{
  sessionId: string;
  active: boolean;
  transport: BrowserLiveStreamTransport;
  focus: BrowserLiveStreamFocus;
  status: string;
}> {
  const resolved = resolveSessionId(sessionId);
  const focus = normalizeBrowserLiveStreamFocus(options?.focus);
  if (getInHouseSession(resolved)) {
    broadcastWS({
      type: 'browser:stream_status',
      sessionId: resolved,
      active: false,
      transport: 'snapshot',
      focus,
      status: 'Prometheus in-house browser is rendered natively; screenshot stream is idle.',
      timestamp: Date.now(),
    });
    return {
      sessionId: resolved,
      active: false,
      transport: 'snapshot',
      focus,
      status: 'Native Electron browser surface active.',
    };
  }
  const session = await getOrCreateSession(resolved, {
    url: String(options?.restoreUrl || '').trim(),
    title: String(options?.restoreTitle || '').trim(),
  });
  await syncPageMetadata(session).catch(() => {});
  const existing = browserLiveStreams.get(resolved);
  if (existing?.active && existing.focus === focus && existing.transport) {
    refreshBrowserLiveStreamLease(resolved);
    await broadcastBrowserLiveStreamStatus(resolved, existing, {
      active: true,
      transport: existing.transport,
      focus,
      status: existing.status || BROWSER_STREAM_HEARTBEAT_STATUS,
    });
    return {
      sessionId: resolved,
      active: true,
      transport: existing.transport,
      focus,
      status: existing.status || BROWSER_STREAM_HEARTBEAT_STATUS,
    };
  }
  if (existing) {
    await stopBrowserLiveStream(resolved, 'Reconfiguring live browser stream.');
  }
  const stream: BrowserLiveStreamState = {
    sessionId: resolved,
    active: true,
    focus,
    transport: null,
    status: 'Starting live browser stream...',
    startedAt: Date.now(),
    lastFrameAt: 0,
    loopToken: 0,
    leaseTimer: null,
    cdpSession: null,
    cdpFrameHandler: null,
  };
  browserLiveStreams.set(resolved, stream);
  refreshBrowserLiveStreamLease(resolved);
  const startedCDP = options?.preferCdp === false ? false : await tryStartBrowserCDPStream(resolved, stream);
  if (!startedCDP) {
    await startBrowserSnapshotStreamLoop(resolved, stream);
  }
  const current = browserLiveStreams.get(resolved) || stream;
  return {
    sessionId: resolved,
    active: true,
    transport: current.transport || 'snapshot',
    focus,
    status: current.status || BROWSER_STREAM_HEARTBEAT_STATUS,
  };
}

export async function browserDoctor(sessionId: string): Promise<string> {
  const lines: string[] = ['Browser doctor:'];
  const ok = (label: string, detail: string) => lines.push(`PASS ${label}: ${detail}`);
  const warn = (label: string, detail: string) => lines.push(`WARN ${label}: ${detail}`);
  const fail = (label: string, detail: string) => lines.push(`FAIL ${label}: ${detail}`);

  try {
    await import('playwright');
    ok('Playwright install', 'module is importable');
  } catch (err: any) {
    fail('Playwright install', err?.message || String(err));
  }

  const resolved = resolveSessionId(sessionId);
  const session = sessions.get(resolved);
  // Let Electron re-establish the lane before selecting the diagnostic branch;
  // this also makes doctor useful for subagent tabs after a gateway restart.
  await recoverInHouseSessionMapping(resolved);
  const metadata = getBrowserSessionMetadata(resolved);
  const selectedTarget = shouldUseInHouseBrowser(resolved)
    ? 'inhouse'
    : (metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus');
  if (selectedTarget === 'user' || session?.transport === 'extension') {
    const relay = getUserChromeRelay();
    const status = relay.getStatus();
    lines.push('INFO Browser profile target: user Chrome via Personal Chrome extension (not CDP).');
    (status.connected ? ok : fail)('Extension relay', status.connected
      ? `connected${status.extensionVersion ? ` (extension ${status.extensionVersion})` : ''}; loopback 127.0.0.1:${status.port}`
      : `not connected. ${getUserChromeExtensionOnboarding().replace(/\n/g, ' ')}`);
    ok('CDP port', 'not applicable: port 9223 is intentionally not used for the default Chrome profile.');
    if (session?.transport === 'extension') {
      ok('Session', `active id=${resolved}, tab=${session.page.url() || '(blank)'}`);
      try { await session.page.screenshot({ type: 'png' }); ok('Screenshot transport', 'Page.captureScreenshot via chrome.debugger succeeded'); }
      catch (err: any) { fail('Screenshot transport', String(err?.message || err)); }
    }
    return lines.join('\n');
  }
  if (selectedTarget === 'inhouse') {
    lines.push('INFO Browser profile target: Prometheus in-house browser (Electron native surface).');
    try {
      const state: any = await callInHouseBrowser('state', { sessionId: resolved });
      const available = state?.available !== false;
      (available ? ok : fail)('Electron browser RPC', available ? 'connected on the authenticated loopback bridge' : 'RPC responded but native surface is unavailable');
      if (state?.attached && Array.isArray(state?.tabs)) {
        ok('Session', `active id=${resolved}, ${state.tabs.length} tab${state.tabs.length === 1 ? '' : 's'}`);
        ok('Current page', `${state.title || '(untitled)'} ${state.url || 'about:blank'}`.trim());
      } else {
        warn('Session', 'no active in-app browser tab; browser_open will create one');
      }
      try {
        const resource = await callInHouseBrowser<any>('metrics', { sessionId: resolved });
        const sample = resource?.metrics;
        if (!sample) {
          warn('Native browser resources', 'no renderer sample is available yet');
        } else {
          const formatPercent = (value: unknown) => value == null || !Number.isFinite(Number(value))
            ? 'unknown'
            : `${Number(value).toFixed(1)}%`;
          const formatMemoryMb = (value: unknown) => value == null || !Number.isFinite(Number(value))
            ? 'unknown'
            : `${(Number(value) / (1024 * 1024)).toFixed(1)} MB`;
          const formatProcessGroup = (group: any, fallback: any = {}) => {
            const cpu = group?.cpuPercent ?? fallback.cpuPercent;
            const privateBytes = group?.memory?.privateBytes ?? fallback.memory?.privateBytes;
            const processCount = group?.processCount;
            return `${formatPercent(cpu)} CPU, ${formatMemoryMb(privateBytes)} private${processCount == null ? '' : `, ${processCount} process${processCount === 1 ? '' : 'es'}`}`;
          };
          const breakdown = sample.processBreakdown || {};
          const rendererFallback = { cpuPercent: sample.cpuPercent, memory: sample.memory };
          const activeRenderer = breakdown.activeRenderer?.processCount
            ? breakdown.activeRenderer
            : rendererFallback;
          const total = breakdown.total || {};
          const gpu = breakdown.gpu || {};
          const utility = breakdown.utility || {};
          const main = breakdown.main || {};
          const heap = sample.page?.jsHeapRatio == null
            ? 'JS heap unavailable'
            : `${(Number(sample.page.jsHeapRatio) * 100).toFixed(1)}% JS heap`;
          const pageState = sample.page?.hidden === true
            ? 'page hidden'
            : `page ${sample.page?.visibilityState || 'visibility unknown'}`;
          const canvasCount = sample.page?.canvasCount == null ? 'unknown' : String(sample.page.canvasCount);
          const gpuFeatureStatus = sample.gpu?.gpuFeatureStatus && typeof sample.gpu.gpuFeatureStatus === 'object'
            ? Object.entries(sample.gpu.gpuFeatureStatus)
              .slice(0, 8)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(', ')
              .slice(0, 360) || 'unavailable'
            : 'unavailable';
          const acceleration = sample.gpu?.hardwareAccelerationEnabled == null
            ? 'unknown'
            : (sample.gpu.hardwareAccelerationEnabled ? 'on' : 'off');
          const detail = [
            `active renderer ${formatProcessGroup(activeRenderer, rendererFallback)}`,
            `Electron total ${formatPercent(total.cpuPercent)} CPU, ${formatMemoryMb(total.memory?.privateBytes)} private`,
            `main ${formatProcessGroup(main)}`,
            `GPU ${formatProcessGroup(gpu)}`,
            `utility ${formatProcessGroup(utility)}`,
            `${heap}, ${canvasCount} canvas${canvasCount === '1' ? '' : 'es'}`,
            `${sample.visible ? 'surface visible' : 'surface background'}, ${pageState}, attached=${sample.attached === true ? 'yes' : 'no'}`,
            `background throttling=${sample.backgroundThrottling ? 'on' : 'off'}`,
            `GPU acceleration=${acceleration}, features=${gpuFeatureStatus}`,
          ].join('; ');
          const pressureReasons = new Set<string>([
            ...(sample.pressure?.reasons || []),
            ...(breakdown.pressure?.reasons || []),
          ]);
          if (total.cpuPercent != null && Number(total.cpuPercent) >= 60) pressureReasons.add('electron-total-cpu');
          if (sample.backgroundThrottling !== true) fail('Native browser resources', `${detail}; hidden-page throttling is disabled`);
          else if (sample.pressure?.level === 'elevated' || pressureReasons.size) warn('Native browser resources', `${detail}; pressure=${[...pressureReasons].join(',') || 'elevated'}`);
          else ok('Native browser resources', detail);
          if (sample.gpu?.hardwareAccelerationEnabled === false) {
            warn('GPU acceleration', `disabled; Three.js/WebGL may be using software rendering; features=${gpuFeatureStatus}`);
          } else if (sample.gpu?.hardwareAccelerationEnabled === true) {
            ok('GPU acceleration', `enabled; features=${gpuFeatureStatus}`);
          } else {
            warn('GPU acceleration', `status unavailable; features=${gpuFeatureStatus}`);
          }
        }
      } catch (err: any) {
        warn('Native browser resources', `sample unavailable: ${String(err?.message || err)}`);
      }
    } catch (err: any) {
      fail('Electron browser RPC', String(err?.message || err));
    }
    return lines.join('\n');
  }
  if (!session) {
    warn('Session', 'no active browser session');
    const metadata = registerBrowserSessionMetadata(resolved);
    const identity = getStableBrowserIdentity(resolved, metadata);
    const target = metadata.ownerType === 'main' ? getMainBrowserTarget(resolved) : 'prometheus';
    const debugPort = metadata.ownerType === 'main'
      ? (target === 'user' ? getUserChromeDebugPort() : getMainChromeDebugPort())
      : getPersistentBrowserPort(identity);
    const profileDir = metadata.ownerType === 'main'
      ? (target === 'user'
        ? getRealChromeProfileDir()
        : (process.env.CHROME_PROFILE || path.join(os.homedir(), '.prometheus', 'chrome-debug-profile')))
      : resolvePersistentBrowserProfileDir(identity, resolved, metadata);
    try {
      const chromePath = await findBrowserExecutableForPlaywright();
      chromePath ? ok('Chrome executable', chromePath) : fail('Chrome executable', 'not found; configure CHROME_PATH or install Chrome/Chromium');
      const portOpen = await isPortOpen(debugPort);
      (portOpen ? ok : warn)('CDP port probe', `${debugPort}${portOpen ? ' responded' : ' is not responding yet; browser_open will launch Chrome'}`);
      if (portOpen) {
        try {
          const pw = await getPW();
          if (pw) {
            const browser = await connectOverCDPWithTimeout(pw, debugPort, 3000);
            await browser.close().catch(() => {});
            ok('CDP attach', 'Playwright connected successfully');
          }
        } catch (err: any) {
          fail('CDP attach', `${String(err?.message || err).split('\n')[0]} � restart the existing Chrome process for this profile/port`);
        }
      }
      const profileExists = fs.existsSync(profileDir);
      (profileExists ? ok : warn)('Chrome profile', `${profileDir}${profileExists ? '' : ' (will be created on browser_open)'}`);
      ok('Next browser_open target', `${getBrowserProfileLabel(target)} on port ${debugPort}`);
    } catch (err: any) {
      fail('Launch readiness', err?.message || String(err));
    }
    return lines.join('\n');
  }

  ok('Session', `active id=${resolved}, url=${session.page.url() || '(blank)'}`);
  ok('Browser profile target', `${getBrowserProfileLabel(session.profileKind)} (${session.browserTarget})`);
  if (session.profileDir) {
    const exists = fs.existsSync(session.profileDir);
    (exists ? ok : warn)('Chrome profile', `${session.profileDir}${exists ? '' : ' (missing on disk)'}`);
  } else {
    warn('Chrome profile', session.isolated ? 'isolated session has no profileDir metadata' : 'attached/browser session has no profileDir metadata');
  }

  if (session.debugPort) ok('CDP port', `configured on ${session.debugPort}`);
  else warn('CDP port', 'no debugPort metadata on this session');

  try {
    const cdp = await session.context.newCDPSession(session.page);
    const version = await cdp.send('Browser.getVersion').catch(() => null);
    await cdp.detach().catch(() => null);
    ok('CDP reachability', version?.product ? String(version.product) : 'CDP session opened');
  } catch (err: any) {
    fail('CDP reachability', err?.message || String(err));
  }

  try {
    const viewport = session.page.viewportSize() || { width: 0, height: 0 };
    const buf: Buffer = await session.page.screenshot({ type: 'png', fullPage: false, timeout: 5000 });
    const normalized = await normalizeScreenshotBuffer(buf, {
      maxSide: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_SIDE || process.env.PROMETHEUS_SCREENSHOT_MAX_SIDE || 1800),
      maxBytes: Number(process.env.PROMETHEUS_BROWSER_SCREENSHOT_MAX_BYTES || process.env.PROMETHEUS_SCREENSHOT_MAX_BYTES || 4 * 1024 * 1024),
      preferJpeg: true,
    });
    ok(
      'Screenshot budget',
      `${viewport.width}x${viewport.height}, raw=${Math.round(buf.byteLength / 1024)}KB, transport=${normalized.width}x${normalized.height} ${normalized.mimeType} ${Math.round(normalized.bytes / 1024)}KB`,
    );
  } catch (err: any) {
    fail('Screenshot budget', err?.message || String(err));
  }

  const ageMs = session.lastSnapshotAt ? Date.now() - session.lastSnapshotAt : Infinity;
  if (!session.lastSnapshot) warn('Snapshot cache', 'no cached DOM snapshot yet');
  else if (ageMs > 30_000) warn('Snapshot cache', `last snapshot is ${Math.round(ageMs / 1000)}s old`);
  else ok('Snapshot cache', `fresh (${Math.round(ageMs / 1000)}s old)`);

  return lines.join('\n');
}
