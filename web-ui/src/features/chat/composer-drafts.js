// Text drafts are local to this device and scoped to the exact chat target.
// Keeping the storage format shared lets desktop and mobile use the same
// lifecycle without allowing one surface (or gateway) to overwrite another.
const STORAGE_KEY = 'pm_chat_composer_drafts_v1';
const MAX_DRAFTS = 100;
const MAX_TEXT_LENGTH = 100_000;

function readDrafts() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function writeDrafts(drafts) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(drafts)); } catch {}
}

export function composerDraftKey(surface, sessionId, gatewayId = '') {
  return [String(surface || '').trim(), String(gatewayId || '').trim(), String(sessionId || '').trim()].join(':');
}

export function readComposerDraft(key) {
  return String(readDrafts()[key]?.text || '');
}

export function saveComposerDraft(key, text) {
  if (!key) return;
  const drafts = readDrafts();
  const value = String(text || '').slice(0, MAX_TEXT_LENGTH);
  if (value) drafts[key] = { text: value, at: Date.now() };
  else delete drafts[key];
  const retained = Object.entries(drafts)
    .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
    .slice(0, MAX_DRAFTS);
  writeDrafts(Object.fromEntries(retained));
}

export function moveComposerDraft(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const text = readComposerDraft(fromKey);
  if (text) saveComposerDraft(toKey, text);
  saveComposerDraft(fromKey, '');
}
