let sceneGraphPromise = null;

export function createDormantSceneDocument(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const captions = Array.isArray(source.captions)
    ? source.captions
    : (Array.isArray(source.subtitles) ? source.subtitles : []);
  return {
    ...source,
    id: source.id || `scene_dormant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : 1,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : 1280,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : 720,
    background: source.background || '#ffffff',
    durationMs: Math.max(1000, Number(source.durationMs) || 12000),
    frameRate: Math.max(1, Number(source.frameRate) || 60),
    audioTrack: source.audioTrack && typeof source.audioTrack === 'object'
      ? { ...source.audioTrack }
      : { source: '', label: '', startMs: 0, durationMs: 0, trimStartMs: 0, trimEndMs: 0, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, analysis: null },
    elements: Array.isArray(source.elements) ? source.elements.slice() : [],
    motionTemplates: Array.isArray(source.motionTemplates) ? source.motionTemplates.slice() : [],
    captions: captions.slice(),
    subtitles: captions.slice(),
    brandKit: source.brandKit || null,
    selectedId: source.selectedId || null,
  };
}

export function loadCreativeSceneGraph() {
  if (!sceneGraphPromise) {
    sceneGraphPromise = import('../../../components/creative/sceneGraph.js').catch((error) => {
      sceneGraphPromise = null;
      throw error;
    });
  }
  return sceneGraphPromise;
}
