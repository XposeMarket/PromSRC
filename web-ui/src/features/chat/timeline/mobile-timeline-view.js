import {
  chatTimelineRowSignature,
  createTimelineEntries,
  createWeightedTimelineController,
} from './weighted-timeline.js';
import { createAdaptiveStreamScheduler } from './adaptive-stream-scheduler.js';

export function createMobileTimelineView({ runtimeFor, isHiddenMessage = () => false } = {}) {
  const controller = createWeightedTimelineController({ surface: 'mobile', stepWeight: 22 });
  const scheduler = createAdaptiveStreamScheduler({ floorMs: 16, ceilingMs: 220, hiddenMs: 180 });
  function entries(sessionId, thread) {
    const list = Array.isArray(thread) ? thread : [];
    const runtimeOrder = runtimeFor?.(sessionId)?.snapshot?.history?.order || [];
    const keys = runtimeOrder.length === list.length ? runtimeOrder : [];
    return createTimelineEntries(list, { keys })
      .filter((entry) => !isHiddenMessage(entry.msg, entry.originalIndex));
  }
  return Object.freeze({ controller, scheduler, entries, rowSignature: chatTimelineRowSignature });
}
