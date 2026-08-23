import { chatTimelineRowSignature, createTimelineEntries, createWeightedTimelineController } from './weighted-timeline.js';
import { captureKeyedScrollState } from './keyed-dom.js';

export function createDesktopTimelineView({
  windowRef = globalThis.window,
  runtimeFor,
  isInternalMessage = () => false,
  getHistory = () => [],
  renderGatewayPager = () => '',
  render = () => {},
  encode = (value) => JSON.stringify(String(value || '')),
} = {}) {
  const controller = createWeightedTimelineController({ surface: 'desktop', stepWeight: 32 });
  const keyFor = (sessionId) => `desktop:main:${String(sessionId || '').trim()}`;

  function entries(history = [], sessionId = windowRef.activeChatSessionId) {
    const runtimeKeys = runtimeFor?.(sessionId)?.snapshot?.history?.order || [];
    return createTimelineEntries(history, { keys: runtimeKeys })
      .filter((entry) => !isInternalMessage(entry.msg));
  }

  function renderHead(timeline, sessionId) {
    if (timeline?.omittedBefore > 0) {
      return `<div class="chat-history-pager" data-chat-row-key="timeline-pager:older" role="navigation" aria-label="Earlier messages">
        <button type="button" class="btn btn-sm" onclick="showEarlierDesktopTimeline(${encode(sessionId)})">Show earlier messages</button>
      </div>`;
    }
    return renderGatewayPager(sessionId);
  }

  function renderTail(timeline, sessionId) {
    if (timeline?.omittedAfter <= 0) return '';
    return `<div class="chat-history-pager" data-chat-row-key="timeline-pager:latest" role="navigation" aria-label="Latest messages">
      <button type="button" class="btn btn-sm" onclick="showLatestDesktopTimeline(${encode(sessionId)})">Jump to latest</button>
    </div>`;
  }

  function navigatorEntries(source = [], maximum = 120) {
    const list = Array.isArray(source) ? source : [];
    const limit = Math.max(2, Number(maximum) || 120);
    if (list.length <= limit) return list;
    const sampled = [];
    for (let index = 0; index < limit; index += 1) {
      sampled.push(list[Math.round((index * (list.length - 1)) / (limit - 1))]);
    }
    return sampled;
  }

  function wireScroller(element, timelineKey, { trackPrimary = false } = {}) {
    if (!element || element.dataset.chatTimelineScrollBound === '1') return;
    element.dataset.chatTimelineScrollBound = '1';
    element.addEventListener('scroll', () => {
      const state = captureKeyedScrollState(element, element, { bottomThreshold: 60 });
      const key = typeof timelineKey === 'function' ? timelineKey() : timelineKey;
      const atTrueTail = state.nearBottom && !(controller.peek(key)?.omittedAfter > 0);
      if (atTrueTail) controller.followTail(key);
      else if (state.anchorKey) controller.anchorKey(key, state.anchorKey);
      if (trackPrimary) windowRef.chatMessagesUserScrolledUp = !atTrueTail;
    }, { passive: true });
  }

  windowRef.showEarlierDesktopTimeline = (sessionId = windowRef.activeChatSessionId) => {
    const sid = String(sessionId || windowRef.activeChatSessionId || '').trim();
    if (!controller.stepEarlier(keyFor(sid), entries(getHistory(sid), sid))) return;
    windowRef.chatMessagesUserScrolledUp = true;
    render();
  };
  windowRef.showLatestDesktopTimeline = (sessionId = windowRef.activeChatSessionId) => {
    const sid = String(sessionId || windowRef.activeChatSessionId || '').trim();
    controller.followTail(keyFor(sid));
    windowRef.chatMessagesUserScrolledUp = false;
    render();
  };

  return Object.freeze({ controller, entries, keyFor, renderHead, renderTail, navigatorEntries, wireScroller, rowSignature: chatTimelineRowSignature });
}
