/**
 * Creative feature runtime.
 *
 * ChatPage owns Creative state and public handlers. This module is the lazy
 * dependency boundary for the secondary editor/export/render surfaces so a
 * normal desktop chat boot does not parse or execute the full Creative graph.
 */

import { createCreativeCompositionBridge } from './compositionBridge.js';
import { installCreativeCompositionTimelineInteractions } from './compositionInteractions.js';

export {
  normalizeCreativeAudioTrackConfig,
  hasCreativeAudioTrackConfig,
  stopCreativeAudioPreview,
  ensureCreativeAudioPreviewElement,
  syncCreativeAudioPreviewToTimeline,
  getCreativeAudioTrackWindow,
  waitForCreativeMediaReady,
  createCreativeExportAudioSession,
  fetchCreativeAudioAnalysis,
} from './audioEngine.js';

export {
  normalizeCreativeRenderJobStatus,
  isCreativeRenderJobTerminalStatus,
  sortCreativeRenderJobEntries,
  createCreativeRenderJobClient,
  createCreativeRenderWorkerController,
} from './renderJobs.js';

export { createCreativeExportEngine } from './exportEngine.js';
export { createCreativeMotionTemplateClient } from './motionTemplates.js';
export { createCreativeCompositionBridge } from './compositionBridge.js';
export { installCreativeCompositionTimelineInteractions } from './compositionInteractions.js';
export { syncCreativeEditor } from './editor/index.js';

if (typeof window !== 'undefined') {
  if (!window.prometheusCreativeCompositionBridge) {
    window.prometheusCreativeCompositionBridge = createCreativeCompositionBridge();
  }
  if (!window.prometheusCreativeCompositionTimelineInteractions) {
    window.prometheusCreativeCompositionTimelineInteractions = installCreativeCompositionTimelineInteractions();
  }
}

let hyperframesFeatureLoader = null;

export function loadHyperframesFeature(options = {}) {
  if (!hyperframesFeatureLoader) {
    hyperframesFeatureLoader = import('./hyperframesFeature.js')
      .then(({ createHyperframesFeature }) => createHyperframesFeature(options))
      .catch((error) => {
        hyperframesFeatureLoader = null;
        throw error;
      });
  }
  return hyperframesFeatureLoader;
}
