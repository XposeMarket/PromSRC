'use strict';

const MAX_SUPERSEDED_NAVIGATIONS = 12;

function normalizeTarget(value) {
  return String(value || '').trim();
}

function isNativeBrowserNavigationAbort(error) {
  const message = String(error?.message || error || '').toUpperCase();
  return message.includes('ERR_ABORTED') || Number(error?.errno) === -3 || Number(error?.code) === -3;
}

function createNativeBrowserNavigationController({ loadURL, stop } = {}) {
  if (typeof loadURL !== 'function') throw new Error('Native browser navigation requires a loadURL function.');

  let generation = 0;
  let latest = null;
  let inFlight = null;
  const superseded = [];

  function rememberSuperseded(entry) {
    if (!entry?.target) return;
    superseded.push({ generation: entry.generation, target: entry.target });
    if (superseded.length > MAX_SUPERSEDED_NAVIGATIONS) {
      superseded.splice(0, superseded.length - MAX_SUPERSEDED_NAVIGATIONS);
    }
  }

  async function load(url, ...args) {
    const target = normalizeTarget(url);
    const previous = inFlight;
    const entry = {
      generation: generation + 1,
      target,
      superseded: false,
      settled: false,
    };

    // Establish the replacement as authoritative BEFORE stopping the prior
    // load. Electron may synchronously emit did-fail-load(-3) from stop(), and
    // that event must already see the newer generation/target as the owner.
    generation = entry.generation;
    latest = { generation: entry.generation, target };
    inFlight = entry;

    if (previous && previous.settled !== true) {
      previous.superseded = true;
      rememberSuperseded(previous);
      try { stop?.(); } catch {}
    }

    try {
      return await Promise.resolve().then(() => loadURL(url, ...args));
    } catch (error) {
      if (entry.superseded && isNativeBrowserNavigationAbort(error)) return null;
      throw error;
    } finally {
      entry.settled = true;
      if (inFlight === entry) inFlight = null;
    }
  }

  function classifyFailure({ errorCode, validatedURL } = {}) {
    if (Number(errorCode) !== -3) return { authoritative: true, ignored: false };
    const failedTarget = normalizeTarget(validatedURL);

    // A generic ERR_ABORTED is not safe to ignore. Suppress it only when the
    // failed URL matches a target that this controller explicitly superseded
    // and a DIFFERENT newer target now owns the view. Same-URL A→B navigation
    // is intentionally ambiguous and therefore remains authoritative.
    if (!failedTarget || !latest?.target || failedTarget === latest.target) {
      return { authoritative: true, ignored: false };
    }

    // Keep the bounded superseded record after a match. Electron may surface
    // duplicate failure notifications for the same obsolete navigation, and
    // stale presentation must stay idempotent rather than becoming authoritative
    // merely because the first notification consumed the evidence.
    const matched = superseded.find((candidate) => (
      candidate.target === failedTarget && candidate.generation < latest.generation
    ));
    if (!matched) return { authoritative: true, ignored: false };
    return {
      authoritative: false,
      ignored: true,
      supersededGeneration: matched.generation,
      latestGeneration: latest.generation,
      latestTarget: latest.target,
    };
  }

  function snapshot() {
    return {
      generation,
      latest: latest ? { ...latest } : null,
      superseded: superseded.map((entry) => ({ ...entry })),
      inFlight: inFlight ? { ...inFlight } : null,
    };
  }

  return { load, classifyFailure, snapshot };
}

module.exports = {
  createNativeBrowserNavigationController,
  isNativeBrowserNavigationAbort,
};
