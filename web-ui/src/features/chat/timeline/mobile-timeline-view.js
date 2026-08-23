import {
  chatTimelineRowSignature,
  createTimelineEntries,
  createWeightedTimelineController,
} from './weighted-timeline.js';
import { createAdaptiveStreamScheduler } from './adaptive-stream-scheduler.js';

function alignedRuntimeKeys(runtime, list) {
  const history = runtime?.snapshot?.history;
  const runtimeOrder = Array.isArray(history?.order) ? history.order : [];
  const runtimeTurns = history?.turns;
  if (runtimeOrder.length !== list.length || !(runtimeTurns instanceof Map)) return [];

  // A runtime snapshot can briefly lag the compatibility thread while a fresh
  // mobile send is being promoted/hydrated. Length equality is not enough to
  // prove positional alignment: reusing stale keys in that window makes keyed
  // DOM reconciliation paint the old assistant row over the optimistic user
  // row, and can leave a second assistant row until the chat is reopened.
  // Only borrow runtime keys when the runtime still points at these exact
  // source records. Otherwise createTimelineEntries derives keys from the live
  // thread itself and the next synchronized render can adopt runtime keys.
  for (let index = 0; index < list.length; index += 1) {
    const turn = runtimeTurns.get(runtimeOrder[index]);
    if (!turn || turn.source !== list[index]) return [];
  }
  return runtimeOrder;
}

export function createMobileTimelineView({ runtimeFor, isHiddenMessage = () => false } = {}) {
  const controller = createWeightedTimelineController({ surface: 'mobile', stepWeight: 22 });
  const scheduler = createAdaptiveStreamScheduler({ floorMs: 16, ceilingMs: 220, hiddenMs: 180 });
  function entries(sessionId, thread) {
    const list = Array.isArray(thread) ? thread : [];
    const runtime = runtimeFor?.(sessionId);
    const keys = alignedRuntimeKeys(runtime, list);
    return createTimelineEntries(list, { keys })
      .filter((entry) => !isHiddenMessage(entry.msg, entry.originalIndex));
  }
  return Object.freeze({ controller, scheduler, entries, rowSignature: chatTimelineRowSignature });
}
