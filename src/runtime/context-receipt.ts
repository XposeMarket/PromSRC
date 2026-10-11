import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { RuntimePromptManifest, RuntimePromptManifestInput } from './prompt-manifest';

// Local, best-effort observability only; never an acknowledgement by a provider.
export const CONTEXT_RECEIPT_VERSION = 1;
const hash = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const MAX_TEXT = 48_000;
const MAX_FILE = 192_000;
const MAX_FILES = 256;
const lastMaintenance = new Map<string, number>();
const ID = /^rpm_[0-9]{1,17}_[a-f0-9]{16}_[a-f0-9]{6}$/;
const MARKER = /^(?:\[([A-Z][A-Z0-9_]*)(?:[^\]\r\n]*)\]|#{1,3}\s+(USER|SOUL|MEMORY)(?:\.md)?\s*)[^\r\n]*$/gm;
const TRACKED = /^(?:USER|SOUL|PROMETHEUS_SOUL|MEMORY|AUTO_RECALL|BRAIN_ACTIVE_CONTEXT|TODAY_NOTES|SKILLS|MATCHING_SKILLS|MEMORY_SEARCH_ROUTING|MEMORY_RETRIEVED|MEMORY_REFERENCE|ATOMIC_MEMORY(?:_[A-Z0-9_]+)?|RECALL_DIAGNOSTICS)$/;

export function scrubContextText(value: string): string {
  // Mirrors audit/materializer's credential patterns, strengthened for JSON,
  // multiline keys, private reasoning, media, and unlabelled common key formats.
  return value
    .replace(/<(?:think|thinking|analysis)>[\s\S]*?<\/(?:think|thinking|analysis)>/gi, '[PRIVATE_REASONING_OMITTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:password|passwd|secret|token|api[_-]?key|(?:access|refresh|auth|bot|webhook|gateway|desktop)[_-]?token|authorization|cookie|credentials?)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:password|secret|api[_-]?key|token|cookie)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED_KEY]')
    .replace(/data:[^\s,]*;base64,[A-Za-z0-9+/=]+/gi, '[MEDIA_OMITTED]')
    .replace(/\b[A-Za-z0-9+/]{256,}={0,2}\b/g, '[OPAQUE_PAYLOAD_OMITTED]');
}

function textOnly(value: any): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(p => p?.type === 'text' || p?.type === 'input_text').map(p => String(p.text || '')).join('\n');
}
function workspaceRoot(): string {
  const { getConfig } = require('../config/config') as typeof import('../config/config');
  return getConfig().getWorkspacePath();
}
function receiptDir(root: string): string { return path.join(path.resolve(root), 'audit', 'context-receipts'); }
function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
export function contextReceiptSettings(root = workspaceRoot()): { enabled: boolean; retentionDays: number } {
  try {
    const file = path.join(receiptDir(root), 'settings.json');
    if (fs.statSync(file).size > 1024) throw new Error('oversized settings');
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { enabled: v.enabled !== false, retentionDays: boundedNumber(v.retentionDays, 7, 1, 30) };
  } catch { return { enabled: true, retentionDays: 7 }; }
}
export function configureContextReceipts(update: { enabled?: boolean; retentionDays?: number; reset?: boolean }, root = workspaceRoot()): ReturnType<typeof contextReceiptSettings> {
  const dir = receiptDir(root); fs.mkdirSync(dir, { recursive: true });
  const settings = { ...contextReceiptSettings(root), ...(typeof update.enabled === 'boolean' ? { enabled: update.enabled } : {}), ...(update.retentionDays !== undefined ? { retentionDays: boundedNumber(update.retentionDays, 7, 1, 30) } : {}) };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings), { mode: 0o600 });
  if (update.reset) for (const name of fs.readdirSync(dir)) if (ID.test(name.replace(/\.json$/, ''))) fs.unlinkSync(path.join(dir, name));
  return settings;
}

export function buildContextReceipt(input: RuntimePromptManifestInput, manifest: RuntimePromptManifest) {
  const messages = Array.isArray(input.messages) ? input.messages : [...(input.system ? [{ role: 'system', content: input.system }] : []), ...(input.prompt ? [{ role: 'user', content: input.prompt }] : [])];
  // Latest user *text* is the provider-bound input, not necessarily an untouched
  // gateway turn. Tool-only user messages are skipped; no tools/media retained.
  const users = messages.map((m, index) => ({ m, index, text: m?.role === 'user' ? textOnly(m.content) : '' })).filter(v => v.text);
  const latest = users[users.length - 1];
  let remaining = MAX_TEXT;
  function evidence(raw: string) {
    const redacted = scrubContextText(raw);
    const text = redacted.slice(0, Math.max(0, remaining)); remaining -= text.length;
    return { text, rawOriginalHash: hash(raw), redactedFullHash: hash(redacted), storedTextHash: hash(text), rawChars: raw.length, redactedChars: redacted.length, storedChars: text.length, estimatedTokens: Math.ceil(raw.length / 4), tokenEstimateMethod: 'chars/4', redacted: raw !== redacted, truncated: text.length !== redacted.length };
  }
  const userInput = typeof input.context?.originalUserRequest === 'string' ? { source: 'caller_supplied_original_user_input', ...evidence(input.context.originalUserRequest) } : latest ? { source: 'latest_provider_bound_user_text', messageIndex: latest.index, ...evidence(latest.text) } : { source: 'unavailable', reason: 'No textual user message at this boundary' };
  const providerBoundUserInput = latest ? { source: 'latest_provider_bound_user_text', messageIndex: latest.index, ...evidence(latest.text) } : { source: 'unavailable' };
  const sections: any[] = [];
  const seen = new Map<string, string>();
  messages.forEach((message, messageIndex) => {
    if (message?.role !== 'system' && message?.role !== 'developer') return;
    const raw = textOnly(message.content);
    const markers = [...raw.matchAll(MARKER)];
    markers.forEach((match, i) => {
      const name = match[1] || match[2]; if (!TRACKED.test(name)) return;
      const start = match.index!; const end = markers[i + 1]?.index ?? raw.length;
      const ev = evidence(raw.slice(start, end)); const canonical = seen.get(ev.rawOriginalHash);
      const ref = `section:${messageIndex}:${start}:${ev.rawOriginalHash}`;
      sections.push({ name, delimiter: scrubContextText(match[0]).slice(0, 200), messageIndex, startChar: start, endChar: end, canonicalRef: canonical || ref, duplicate: !!canonical, ...ev });
      seen.set(ev.rawOriginalHash, canonical || ref);
    });
  });
  return { version: CONTEXT_RECEIPT_VERSION, manifestId: manifest.id, manifestHash: manifest.hash, timestamp: manifest.timestamp, sessionId: scrubContextText(String(input.sessionId || '')).slice(0, 256), provider: manifest.provider, model: manifest.model,
    attemptId: manifest.id, phase: 'assembled_provider_boundary', providerAccepted: 'unavailable', responseOutcome: 'unavailable', gatewayTurnId: input.context?.gatewayTurnId ? scrubContextText(input.context.gatewayTurnId).slice(0, 256) : 'unavailable', userInput, providerBoundUserInput, sections,
    truncation: { textBudgetChars: MAX_TEXT, exhausted: remaining <= 0, sectionsMayBePartial: sections.some(s => s.truncated) },
    routing: { retrievalRanking: 'unavailable_at_manifest_boundary', suppression: 'unavailable_at_manifest_boundary', efficacy: 'unavailable_without_response_join', skillReportAvailable: !!manifest.skillRouting, skillReportHash: manifest.skillRouting ? hash(JSON.stringify(manifest.skillRouting)) : null, instructionReportHash: hash(JSON.stringify(manifest.instructionResolution)) },
    limitations: ['Redacted text is evidence of assembled input, not provider acceptance.', 'Only named system/developer sections retained; unlabeled context and user-message injections are not classified.', 'No assistant reasoning, tool payloads, schemas, or media stored.', 'Gateway turn/original request identity is available only when supplied by caller; retrieval decision provenance unavailable.'] };
}

export function captureContextReceipt(input: RuntimePromptManifestInput, manifest: RuntimePromptManifest, root?: string): { id: string; persisted: boolean; reason?: string } {
  try {
    root = root || workspaceRoot(); const settings = contextReceiptSettings(root);
    if (!settings.enabled) return { id: manifest.id, persisted: false, reason: 'disabled' };
    if (!ID.test(manifest.id)) throw new Error('invalid manifest id');
    const dir = receiptDir(root); fs.mkdirSync(dir, { recursive: true });
    const names = fs.readdirSync(dir).filter(name => ID.test(name.replace(/\.json$/, '')));
    if (names.length >= MAX_FILES || Date.now() - (lastMaintenance.get(dir) || 0) > 60_000) {
      const files = names.map(name => ({ name, stat: fs.lstatSync(path.join(dir, name)) })).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      let total = 0;
      files.forEach((f, i) => { total += f.stat.size; if (f.stat.isSymbolicLink() || i >= MAX_FILES - 1 || total > MAX_FILES * MAX_FILE - MAX_FILE || f.stat.mtimeMs < Date.now() - settings.retentionDays * 86400000) fs.unlinkSync(path.join(dir, f.name)); });
      lastMaintenance.set(dir, Date.now());
      if (lastMaintenance.size > 32) lastMaintenance.delete(lastMaintenance.keys().next().value!);
    }
    const data = JSON.stringify(buildContextReceipt(input, manifest));
    if (Buffer.byteLength(data) > MAX_FILE) throw new Error('receipt metadata exceeds byte budget');
    const target = path.join(dir, `${manifest.id}.json`); const temporary = `${target}.tmp`;
    try { fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { id: manifest.id, persisted: true };
  } catch { return { id: manifest.id, persisted: false, reason: 'capture_failed' }; }
}

export function readContextReceipts(query: { id?: string; sessionId?: string; days?: number; limit?: number; detail?: boolean } = {}, root = workspaceRoot()) {
  if (query.id && !ID.test(query.id)) throw new Error('Invalid receipt id');
  const dir = receiptDir(root); const settings = contextReceiptSettings(root);
  const days = boundedNumber(query.days, 7, 1, 30); const limit = boundedNumber(query.limit, 20, 1, 100);
  let skipped = 0; const records: any[] = [];
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => ID.test(n.replace(/\.json$/, ''))).sort().reverse().slice(0, MAX_FILES) : [];
  for (const name of names) {
    if (query.id && name !== `${query.id}.json`) continue;
    try {
      const file = path.join(dir, name); const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error('invalid file');
      const r = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (r.version !== 1 || !ID.test(r.manifestId) || `${r.manifestId}.json` !== name || !Array.isArray(r.sections) || !Number.isFinite(Date.parse(r.timestamp))) throw new Error('invalid record');
      if (Date.parse(r.timestamp) < Date.now() - Math.min(days, settings.retentionDays) * 86400000 || (query.sessionId && r.sessionId !== query.sessionId)) continue;
      // Scrub again on read so corrupted/legacy externally altered records cannot bypass redaction.
      const sanitize = (v: any): any => typeof v === 'string' ? scrubContextText(v) : Array.isArray(v) ? v.map(sanitize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, /^(password|secret|token|authorization|cookie|apiKey)$/i.test(k) ? '[REDACTED]' : sanitize(value)])) : v;
      const safe = sanitize(r);
      records.push(query.detail || query.id ? safe : { manifestId: safe.manifestId, timestamp: safe.timestamp, sessionId: safe.sessionId, phase: safe.phase, userInputHash: safe.userInput?.rawOriginalHash, sections: safe.sections.map((s: any) => ({ name: s.name, rawOriginalHash: s.rawOriginalHash, rawChars: s.rawChars, duplicate: s.duplicate, truncated: s.truncated })) });
      if (records.length >= limit) break;
    } catch { skipped++; }
  }
  return { settings, records, skipped, limits: { days, limit, maxFiles: MAX_FILES, maxFileBytes: MAX_FILE }, captureCoverage: 'Only actual captureRuntimePromptManifest callers; no response-success claim' };
}

// Stable convenience exports for agent audit operations; root remains internal.
export function listContextReceipts(query: { sessionId?: string; days?: number; limit?: number; detail?: boolean } = {}, root?: string) { return readContextReceipts(query, root); }
export function readContextReceipt(id: string, root?: string) { return readContextReceipts({ id, detail: true, limit: 1 }, root).records[0] || null; }
