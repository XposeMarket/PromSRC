let thinkingOrbPromise = null;

export function loadThinkingOrbFeature() {
  if (!thinkingOrbPromise) {
    thinkingOrbPromise = import('../../../vendor/thinking-orb.js').catch((error) => {
      thinkingOrbPromise = null;
      throw error;
    });
  }
  return thinkingOrbPromise;
}

export async function mountThinkingOrbWhenReady(host, options = {}) {
  if (!host) return null;
  const module = await loadThinkingOrbFeature();
  if (!host.isConnected) return null;
  return module.mountThinkingOrb(host, options);
}
