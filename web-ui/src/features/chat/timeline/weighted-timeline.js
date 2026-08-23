import { chatTurnKey } from '../runtime/chat-runtime.js';

const DEFAULT_BUDGETS = Object.freeze({
  desktop: Object.freeze({ materializedWeight: 180, paintWeight: 96, minimumMaterializedWeight: 56, minimumPaintWeight: 28 }),
  mobile: Object.freeze({ materializedWeight: 92, paintWeight: 52, minimumMaterializedWeight: 38, minimumPaintWeight: 22 }),
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function listLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function compactJson(value, maximum = 720) {
  if (value == null) return '';
  try { return JSON.stringify(value).slice(0, maximum); } catch { return String(value).slice(0, maximum); }
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function tailRecord(value) {
  return Array.isArray(value) && value.length ? value[value.length - 1] : null;
}

export function chatTurnRenderWeight(message = {}) {
  const contentLength = String(message?.content || message?.body?.text || '').length;
  let weight = 1 + Math.min(4, Math.floor(contentLength / 1_200));
  const activityCount = listLength(message.liveTraceEntries)
    + listLength(message.processEntries)
    + listLength(message.toolCalls)
    + listLength(message.steps)
    + listLength(message.commandRuns);
  weight += Math.min(8, activityCount * 0.7);
  const richCount = listLength(message.attachments)
    + listLength(message.attachmentPreviews)
    + listLength(message.generatedImages)
    + listLength(message.generatedVideos)
    + listLength(message.canvasFiles)
    + listLength(message.fileChanges)
    + listLength(message.artifacts)
    + listLength(message.visualArtifacts)
    + listLength(message.productCarousel);
  weight += Math.min(8, richCount * 1.4);
  if (message.approvalRequest) weight += 2.5;
  if (message.questionRequest) weight += 2.5;
  if (message.voiceWorkgroup) weight += 3;
  if (message.streaming === true) weight += 1;
  return Number(clamp(weight, 1, 20).toFixed(2));
}

// This signature intentionally ignores disclosure/open state. A row is patched
// only when render-bearing message state changes, so selections, terminals,
// decoded media, and open details survive unrelated transcript updates.
export function chatTimelineRowSignature(message = {}) {
  const parts = [
    message.role,
    message.status,
    message.streaming === true ? 1 : 0,
    message.content || message.body?.text || '',
    compactJson(message.body, 1_500),
    message.workflowPart,
    message.messageKind,
    message.workStartedAt,
    compactJson(message.approvalRequest),
    compactJson(message.questionRequest),
    compactJson(message.voiceWorkgroup),
    compactJson(message.errorPresentation),
  ];
  for (const field of [
    'liveTraceEntries', 'processEntries', 'toolCalls', 'steps', 'commandRuns',
    'attachments', 'attachmentPreviews', 'generatedImages', 'generatedVideos',
    'canvasFiles', 'fileChanges', 'artifacts', 'visualArtifacts', 'productCarousel',
  ]) {
    const value = message[field];
    parts.push(field, listLength(value), compactJson(tailRecord(value), 420));
  }
  return hashText(parts.join('\u0000'));
}

export function createTimelineEntries(messages = [], options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const suppliedKeys = Array.isArray(options.keys) ? options.keys : [];
  const occurrences = new Map();
  return list.map((msg, originalIndex) => {
    const base = chatTurnKey(msg, originalIndex, 0);
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    const supplied = String(
      typeof options.keyFor === 'function'
        ? options.keyFor(msg, originalIndex)
        : (suppliedKeys[originalIndex] || ''),
    ).trim();
    return Object.freeze({
      msg,
      originalIndex,
      key: supplied || chatTurnKey(msg, originalIndex, occurrence),
      weight: chatTurnRenderWeight(msg),
    });
  });
}

function materializeEntry(entry) {
  return Object.freeze({ ...entry, signature: chatTimelineRowSignature(entry.msg) });
}

export function resolveTimelineBudgets(options = {}) {
  const surface = options.surface === 'mobile' ? 'mobile' : 'desktop';
  const defaults = DEFAULT_BUDGETS[surface];
  const requestedShare = clamp(options.paneShare ?? 1, 0.2, 1);
  const share = options.allocated === true ? 1 : requestedShare;
  let materializedWeight = Math.max(
    defaults.minimumMaterializedWeight,
    Math.floor(Number(options.materializedWeight || defaults.materializedWeight) * share),
  );
  let paintWeight = Math.max(
    defaults.minimumPaintWeight,
    Math.floor(Number(options.paintWeight || defaults.paintWeight) * share),
  );
  if (options.hidden === true) {
    materializedWeight = Math.min(materializedWeight, surface === 'mobile' ? 38 : 48);
    paintWeight = Math.min(paintWeight, surface === 'mobile' ? 22 : 26);
  }
  materializedWeight = Math.max(materializedWeight, paintWeight);
  return Object.freeze({ surface, materializedWeight, paintWeight, paneShare: requestedShare, hidden: options.hidden === true });
}

export function allocateTimelinePaneBudgets(panes = [], options = {}) {
  const normalized = (Array.isArray(panes) ? panes : []).filter((pane) => pane?.key);
  if (!normalized.length) return Object.freeze({});
  const focusedKey = String(options.focusedKey || normalized[0].key);
  const globalBudget = resolveTimelineBudgets({ ...options, paneShare: 1 });
  if (normalized.length === 1) {
    return Object.freeze({ [normalized[0].key]: Object.freeze({ ...globalBudget, allocated: true }) });
  }
  const focusShare = clamp(options.focusShare ?? 0.62, 0.5, 0.75);
  const remainder = (1 - focusShare) / Math.max(1, normalized.length - 1);
  const output = {};
  for (const pane of normalized) {
    const paneShare = String(pane.key) === focusedKey ? focusShare : remainder;
    const paintWeight = Math.max(8, Math.floor(globalBudget.paintWeight * paneShare));
    output[pane.key] = Object.freeze({
      ...globalBudget,
      materializedWeight: Math.max(paintWeight, Math.floor(globalBudget.materializedWeight * paneShare)),
      paintWeight,
      paneShare,
      allocated: true,
    });
  }
  return Object.freeze(output);
}

function rangeByWeight(entries, anchorIndex, budget, tail) {
  if (!entries.length) return { start: 0, end: 0, weight: 0 };
  const maximum = Math.max(1, Number(budget) || 1);
  if (tail) {
    let start = entries.length;
    let weight = 0;
    while (start > 0) {
      const nextWeight = Number(entries[start - 1]?.weight || 1);
      if (start < entries.length && weight + nextWeight > maximum) break;
      start -= 1;
      weight += nextWeight;
    }
    return { start, end: entries.length, weight };
  }

  const anchor = clamp(anchorIndex, 0, entries.length - 1);
  let start = anchor;
  let end = anchor + 1;
  let weight = Number(entries[anchor]?.weight || 1);
  let beforeWeight = 0;
  let afterWeight = 0;
  while (start > 0 || end < entries.length) {
    const preferBefore = start > 0 && (end >= entries.length || beforeWeight <= afterWeight * 1.35);
    const candidateIndex = preferBefore ? start - 1 : end;
    const candidateWeight = Number(entries[candidateIndex]?.weight || 1);
    if (weight + candidateWeight > maximum) {
      const alternateIndex = preferBefore ? end : start - 1;
      const alternateAvailable = preferBefore ? end < entries.length : start > 0;
      if (alternateAvailable) {
        const alternateWeight = Number(entries[alternateIndex]?.weight || 1);
        if (weight + alternateWeight <= maximum) {
          if (preferBefore) { end += 1; afterWeight += alternateWeight; }
          else { start -= 1; beforeWeight += alternateWeight; }
          weight += alternateWeight;
          continue;
        }
      }
      break;
    }
    if (preferBefore) { start -= 1; beforeWeight += candidateWeight; }
    else { end += 1; afterWeight += candidateWeight; }
    weight += candidateWeight;
  }
  return { start, end, weight };
}

function includePinned(entries, selected, pinnedKeys) {
  const output = [...selected];
  const existing = new Set(output.map((entry) => entry.key));
  const pins = pinnedKeys instanceof Set ? pinnedKeys : new Set(pinnedKeys || []);
  for (const entry of entries) {
    if (!pins.has(entry.key) || existing.has(entry.key)) continue;
    output.push(entry);
    existing.add(entry.key);
  }
  output.sort((left, right) => left.originalIndex - right.originalIndex);
  return output;
}

export function createWeightedTimelineController(defaults = {}) {
  const states = new Map();

  function stateFor(key) {
    const id = String(key || 'chat');
    if (!states.has(id)) states.set(id, { mode: 'tail', anchorKey: '', anchorIndex: -1, last: null });
    return states.get(id);
  }

  function select(key, entries = [], options = {}) {
    const id = String(key || 'chat');
    const state = stateFor(id);
    const list = Array.isArray(entries) ? entries : [];
    if (options.followTail === true) state.mode = 'tail';
    if (options.anchorKey) {
      state.mode = 'anchor';
      state.anchorKey = String(options.anchorKey);
    }
    let anchorIndex = list.length - 1;
    if (state.mode === 'anchor') {
      const keyedIndex = state.anchorKey ? list.findIndex((entry) => entry.key === state.anchorKey) : -1;
      anchorIndex = keyedIndex >= 0 ? keyedIndex : clamp(state.anchorIndex, 0, Math.max(0, list.length - 1));
      state.anchorIndex = anchorIndex;
      state.anchorKey = list[anchorIndex]?.key || '';
    }
    const budgets = resolveTimelineBudgets({ ...defaults, ...options });
    const materializedRange = rangeByWeight(list, anchorIndex, budgets.materializedWeight, state.mode === 'tail');
    const materializedBase = list.slice(materializedRange.start, materializedRange.end);
    const localAnchor = Math.max(0, anchorIndex - materializedRange.start);
    const paintRange = rangeByWeight(materializedBase, localAnchor, budgets.paintWeight, state.mode === 'tail');
    const paintBase = materializedBase.slice(paintRange.start, paintRange.end);
    const materializedEntries = includePinned(list, materializedBase, options.pinnedKeys).map(materializeEntry);
    const materializedByKey = new Map(materializedEntries.map((entry) => [entry.key, entry]));
    const paintEntries = includePinned(list, paintBase, options.pinnedKeys)
      .map((entry) => materializedByKey.get(entry.key) || materializeEntry(entry));
    const firstPaintIndex = paintBase.length ? list.indexOf(paintBase[0]) : 0;
    const lastPaintIndex = paintBase.length ? list.indexOf(paintBase[paintBase.length - 1]) : -1;
    const result = Object.freeze({
      key: id,
      mode: state.mode,
      anchorKey: state.anchorKey,
      budgets,
      materializedEntries: Object.freeze(materializedEntries),
      paintEntries: Object.freeze(paintEntries),
      materializedWeight: Number(materializedEntries.reduce((sum, entry) => sum + entry.weight, 0).toFixed(2)),
      paintWeight: Number(paintEntries.reduce((sum, entry) => sum + entry.weight, 0).toFixed(2)),
      firstPaintIndex,
      lastPaintIndex,
      omittedBefore: Math.max(0, firstPaintIndex),
      omittedAfter: Math.max(0, list.length - lastPaintIndex - 1),
      totalEntries: list.length,
      estimatedDomRows: paintEntries.length,
    });
    state.last = result;
    return result;
  }

  function stepEarlier(key, entries = [], options = {}) {
    const state = stateFor(key);
    const list = Array.isArray(entries) ? entries : [];
    const first = Number(state.last?.firstPaintIndex ?? list.length);
    if (!list.length || first <= 0) return false;
    let next = first;
    let spent = 0;
    const stepWeight = Math.max(12, Number(options.stepWeight || defaults.stepWeight || 28));
    while (next > 0 && spent < stepWeight) {
      next -= 1;
      spent += Number(list[next]?.weight || 1);
    }
    state.mode = 'anchor';
    state.anchorIndex = next;
    state.anchorKey = list[next]?.key || '';
    return true;
  }

  function focusIndex(key, entries = [], index = 0) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return false;
    const resolved = clamp(index, 0, list.length - 1);
    const state = stateFor(key);
    state.mode = 'anchor';
    state.anchorIndex = resolved;
    state.anchorKey = list[resolved]?.key || '';
    return true;
  }

  function anchorKey(key, value) {
    const clean = String(value || '').trim();
    if (!clean) return false;
    const state = stateFor(key);
    state.mode = 'anchor';
    state.anchorKey = clean;
    return true;
  }

  function followTail(key) {
    const state = stateFor(key);
    state.mode = 'tail';
    state.anchorKey = '';
    state.anchorIndex = -1;
  }

  function peek(key) { return stateFor(key).last; }
  function forget(key) { states.delete(String(key || 'chat')); }

  return Object.freeze({ select, stepEarlier, focusIndex, anchorKey, followTail, peek, forget });
}

export const CHAT_TIMELINE_DEFAULT_BUDGETS = DEFAULT_BUDGETS;
