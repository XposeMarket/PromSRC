export type MemoryFactWriteResult = {
  content: string;
  id: string;
  supersededCount: number;
  superseded: Array<{ id?: string; text: string }>;
  flaggedAsUntrusted: boolean;
  nearDuplicates: Array<{ id?: string; category: string; text: string; score: number }>;
};


const STATUS_RE = /\s*\[(?:superseded(?:\s+[^\]]*)?|stale|memory-status:[^\]]*)\]/gi;
const DATE_RE = /\s*\[\d{4}-\d{2}-\d{2}\]\s*$/;
const FACT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'our', 'that', 'the', 'this', 'to', 'was', 'we', 'with', 'you', 'your',
]);

function cleanFact(value: string): string {
  return String(value || '')
    .replace(BULLET_ID_RE, '')
    .replace(STATUS_RE, '')
    .replace(DATE_RE, '')
    .replace(/^\s*-\s*/, '')
    .trim();
}

function factTokens(value: string): string[] {
  return cleanFact(value).toLowerCase().match(/[a-z][a-z0-9_-]*/g)?.filter((token) => !FACT_STOP_WORDS.has(token) && !/^(?:no|not|never|none|without)$/.test(token)) || [];
}

function explicitSubjectKey(value: string): string | undefined {
  const match = cleanFact(value).match(/^\s*([^:\n]{2,80}):/);
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, ' ') : undefined;
}

function tokenJaccard(left: string[], right: string[]): number {
  const a = new Set(left); const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function factNumbers(value: string): string[] {
  return cleanFact(value).match(/\b\d+(?:\.\d+)?\b/g) || [];
}

function factDates(value: string): string[] {
  return cleanFact(value).match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
}

function hasNegation(value: string): boolean {
  return /\b(?:no|not|never|none|without|isn't|aren't|don't|doesn't|won't|can't)\b/i.test(cleanFact(value));
}

/** Deliberately conservative: only marker-like instruction text is quarantined. */
export function isPoisonMemoryFact(value: string): boolean {
  return /\b(?:ignore|disregard|override|forget)\b[\s\S]{0,80}\b(?:previous|prior|all)\b[\s\S]{0,80}\b(?:instructions?|rules?|system prompt)\b|\b(?:system prompt|developer message)\b[\s\S]{0,80}\b(?:ignore|reveal|override|follow)\b|\byou are (?:chatgpt|an ai|a language model)\b/i.test(String(value || ''));
}

/**
 * Returns true only when two same-category bullets plausibly describe the same
 * fact and disagree on a number, explicit date, or polarity.
 */
export function memoryFactsConflict(previous: string, next: string): boolean {
  const before = cleanFact(previous);
  const after = cleanFact(next);
  if (!before || !after || before.toLowerCase() === after.toLowerCase()) return false;
  const beforeTokens = factTokens(before);
  const afterTokens = factTokens(after);
  const beforeKey = explicitSubjectKey(before);
  const afterKey = explicitSubjectKey(after);
  const sameExplicitSubject = Boolean(beforeKey && afterKey && beforeKey === afterKey);
  if (!sameExplicitSubject && tokenJaccard(beforeTokens, afterTokens) < 0.6) return false;

  const beforeNumbers = factNumbers(before);
  const afterNumbers = factNumbers(after);
  const numberChanged = beforeNumbers.length > 0 && afterNumbers.length > 0
    && beforeNumbers.join('|') !== afterNumbers.join('|');
  const beforeDates = factDates(before);
  const afterDates = factDates(after);
  const dateChanged = beforeDates.length > 0 && afterDates.length > 0
    && beforeDates.join('|') !== afterDates.join('|');
  return numberChanged || dateChanged || hasNegation(before) !== hasNegation(after);
}

function normalizeCategoryHeading(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

// Match the existing writer contract: categories are matched case- and
// separator-insensitively against display headings ("personality" -> "## Personality"),
// so a write never creates a duplicate normalized section beside an existing one.
function categoryRange(fileContent: string, category: string): { bodyStart: number; end: number } | null {
  const wanted = normalizeCategoryHeading(category);
  if (!wanted) return null;
  const headingRe = /^##[ \t]+(.+?)[ \t]*\r?$/gm;
  let match: RegExpExecArray | null;
  let bodyStart = -1;
  while ((match = headingRe.exec(fileContent)) !== null) {
    if (normalizeCategoryHeading(match[1]) === wanted) {
      bodyStart = match.index + match[0].replace(/\r$/, '').length;
      break;
    }
  }
  if (bodyStart === -1) return null;
  const nextHeading = fileContent.indexOf('\n## ', bodyStart);
  const closing = fileContent.indexOf('\n---', bodyStart);
  const end = [nextHeading, closing, fileContent.length].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  return { bodyStart, end };
}

function entryDate(value: string): number | undefined {
  const match = String(value || '').match(/\[(\d{4}-\d{2}-\d{2})\]/);
  const parsed = match?.[1] ? Date.parse(`${match[1]}T00:00:00.000Z`) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ── Stable bullet ids ────────────────────────────────────────────────────────
// Each durable bullet carries `<!-- m:xxxxx -->` at line end. The comment is
// invisible in markdown viewers; prompts render it as `[m:xxxxx]` up front.
export const BULLET_ID_RE = /\s*<!--\s*m:([a-z0-9]{4,8})\s*-->\s*$/;
const BULLET_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const BULLET_ID_LENGTH = 5;
const BULLET_LINE_RE = /^\s*-\s+/;
const HEADING_LINE_RE = /^##[ \t]+/;
const FENCE_LINE_RE = /^\s*```/;

function randomBulletId(): string {
  let out = '';
  for (let i = 0; i < BULLET_ID_LENGTH; i += 1) out += BULLET_ID_CHARS[Math.floor(Math.random() * BULLET_ID_CHARS.length)];
  return out;
}

function collectBulletIds(content: string): Set<string> {
  const taken = new Set<string>();
  const re = /<!--\s*m:([a-z0-9]{4,8})\s*-->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) taken.add(match[1]);
  return taken;
}

function newBulletId(taken: Set<string>): string {
  let id = randomBulletId();
  while (taken.has(id)) id = randomBulletId();
  taken.add(id);
  return id;
}

function takenBulletIds(content: string): Set<string> {
  return collectBulletIds(content);
}

/** Bullet text without the leading "- " and without the trailing id comment. */
function bulletBody(line: string): string {
  return String(line || '').replace(/\r$/, '').replace(/^\s*-\s*/, '').replace(BULLET_ID_RE, '').trim();
}

/** Strip a trailing `<!-- m:id -->` from a line (used for identity/hashing). */
export function stripMemoryIds(content: string): string {
  return String(content || '').split('\n').map((line) => {
    if (!BULLET_LINE_RE.test(line)) return line;
    const cr = line.endsWith('\r') ? '\r' : '';
    const body = cr ? line.slice(0, -1) : line;
    return body.replace(BULLET_ID_RE, '') + cr;
  }).join('\n');
}

/** Turns `- text [date] <!-- m:abc12 -->` into `- [m:abc12] text [date]`. Unchanged when no ids. */
export function renderMemoryIdsForPrompt(content: string): string {
  return String(content || '').split('\n').map((line) => {
    if (!BULLET_LINE_RE.test(line)) return line;
    return line.replace(/^(\s*-\s+)(.*?)\s*<!--\s*m:([a-z0-9]{4,8})\s*-->\s*(\r?)$/, '$1[m:$3] $2$4');
  }).join('\n');
}

/**
 * Walks lines the way the file is read: only `- ` bullets inside a `## ` section,
 * never inside ``` fences. Yields line index and the current category heading.
 */
function forEachSectionBullet(lines: string[], visit: (index: number, category: string) => void): void {
  let category = '';
  let inFence = false;
  lines.forEach((line, index) => {
    if (FENCE_LINE_RE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const bare = line.replace(/\r$/, '');
    const heading = bare.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (heading) { category = heading[1].trim(); return; }
    if (HEADING_LINE_RE.test(bare) || !category) return;
    if (BULLET_LINE_RE.test(bare)) visit(index, category);
  });
}

/** Idempotent: gives every section bullet a unique id. Never changes bullet text. Preserves CRLF. */
export function ensureMemoryBulletIds(content: string): { content: string; assigned: number } {
  const source = String(content || '');
  const lines = source.split('\n');
  const taken = collectBulletIds(source);
  const seen = new Set<string>();
  const updates = new Map<number, string>();
  forEachSectionBullet(lines, (index) => {
    const line = lines[index];
    const cr = line.endsWith('\r') ? '\r' : '';
    const body = cr ? line.slice(0, -1) : line;
    const existing = body.match(BULLET_ID_RE)?.[1];
    if (existing && !seen.has(existing)) { seen.add(existing); return; }
    const stripped = existing ? body.replace(BULLET_ID_RE, '') : body.replace(/\s+$/, '');
    const id = newBulletId(taken);
    seen.add(id);
    updates.set(index, `${stripped} <!-- m:${id} -->${cr}`);
  });
  if (!updates.size) return { content: source, assigned: 0 };
  const next = lines.map((line, index) => (updates.has(index) ? updates.get(index) as string : line));
  return { content: next.join('\n'), assigned: updates.size };
}

export function findMemoryBulletById(content: string, id: string): { category: string; line: string; text: string } | null {
  const wanted = normalizeBulletIdArg(id);
  if (!wanted) return null;
  const lines = String(content || '').split('\n');
  let found: { category: string; line: string; text: string } | null = null;
  forEachSectionBullet(lines, (index, category) => {
    if (found) return;
    const line = lines[index];
    if (line.match(BULLET_ID_RE)?.[1] === wanted) found = { category, line, text: bulletBody(line) };
  });
  return found;
}

export function normalizeBulletIdArg(value: string): string {
  const match = String(value || '').trim().replace(/^\[/, '').replace(/\]$/, '').match(/^(?:m:)?([a-z0-9]{4,8})$/i);
  return match ? match[1].toLowerCase() : '';
}

/** Replaces the bullet with this id, keeping the SAME id. Returns previous text, or undefined when no match. */
export function replaceMemoryBulletById(content: string, id: string, newFact: string, date: string): { content: string; previous?: string } {
  const wanted = normalizeBulletIdArg(id);
  const lines = String(content || '').split('\n');
  let target = -1;
  forEachSectionBullet(lines, (index) => {
    if (target === -1 && lines[index].match(BULLET_ID_RE)?.[1] === wanted) target = index;
  });
  if (target === -1) return { content };
  const line = lines[target];
  const cr = line.endsWith('\r') ? '\r' : '';
  const previous = bulletBody(line);
  lines[target] = `- ${String(newFact).trim()} [${date}] <!-- m:${wanted} -->${cr}`;
  return { content: lines.join('\n'), previous };
}

export function removeMemoryBulletById(content: string, id: string): { content: string; removed?: string; category?: string } {
  const wanted = normalizeBulletIdArg(id);
  const lines = String(content || '').split('\n');
  let target = -1;
  let category = '';
  forEachSectionBullet(lines, (index, cat) => {
    if (target === -1 && lines[index].match(BULLET_ID_RE)?.[1] === wanted) { target = index; category = cat; }
  });
  if (target === -1) return { content };
  const removed = bulletBody(lines[target]);
  lines.splice(target, 1);
  return { content: lines.join('\n'), removed, category };
}

/** Token Jaccard against every section bullet in the file (not just the category). */
export function nearestMemoryBullets(content: string, fact: string, limit = 3, minScore = 0.25): Array<{ id?: string; category: string; text: string; score: number }> {
  const lines = String(content || '').split('\n');
  const wanted = factTokens(fact);
  const scored: Array<{ id?: string; category: string; text: string; score: number }> = [];
  forEachSectionBullet(lines, (index, category) => {
    const line = lines[index];
    const text = bulletBody(line);
    const score = tokenJaccard(wanted, factTokens(text));
    if (score >= minScore) scored.push({ id: line.match(BULLET_ID_RE)?.[1], category, text, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}


export function writeMemoryFact(fileContent: string, category: string, fact: string, date: string): MemoryFactWriteResult {
  const safeFact = String(fact || '').trim();
  const poisoned = isPoisonMemoryFact(safeFact);
  const id = newBulletId(takenBulletIds(fileContent));
  const flag = poisoned ? ' [memory-status:untrusted]' : '';
  const entry = `- ${safeFact} [${date}]${flag} <!-- m:${id} -->`;
  const section = categoryRange(fileContent, category);
  if (!section) {
    const closing = fileContent.lastIndexOf('\n---');
    const insertAt = closing === -1 ? fileContent.length : closing;
    const content = fileContent.slice(0, insertAt) + `\n\n## ${category}\n${entry}\n` + fileContent.slice(insertAt);
    return finishMemoryWrite(content, id, [], poisoned, safeFact);
  }

  const sectionText = fileContent.slice(section.bodyStart, section.end);
  const eol = sectionText.includes('\r\n') ? '\r\n' : '\n';
  const superseded: Array<{ id?: string; text: string }> = [];
  const kept: string[] = [];
  for (const line of sectionText.split(/\r?\n/)) {
    if (!poisoned && line.startsWith('- ') && !/\[memory-status:untrusted/i.test(line) && memoryFactsConflict(line, safeFact)) {
      superseded.push({ id: line.match(BULLET_ID_RE)?.[1], text: bulletBody(line) });
      continue;
    }
    kept.push(line);
  }
  // kept[0] is the (possibly empty) newline piece after the heading; always keep it so the
  // entry never lands on the heading line, even when every bullet was superseded.
  const body = kept.join(eol);
  const content = fileContent.slice(0, section.bodyStart) + body + eol + entry + eol + fileContent.slice(section.end);
  return finishMemoryWrite(content, id, superseded, poisoned, safeFact);
}

function finishMemoryWrite(
  content: string,
  id: string,
  superseded: Array<{ id?: string; text: string }>,
  poisoned: boolean,
  safeFact: string,
): MemoryFactWriteResult {
  const nearDuplicates = nearestMemoryBullets(content, safeFact).filter((bullet) => bullet.id !== id);
  return { content, id, supersededCount: superseded.length, superseded, flaggedAsUntrusted: poisoned, nearDuplicates };
}

export function deleteMemoryFact(fileContent: string, category: string, exactContent: string): { content: string; deleted: boolean; id?: string; removed?: string } {
  const section = categoryRange(fileContent, category);
  if (!section) return { content: fileContent, deleted: false };
  const target = cleanFact(exactContent);
  const sectionText = fileContent.slice(section.bodyStart, section.end);
  const lines = sectionText.split(/\r?\n/);
  const matchIndexes = lines.reduce<number[]>((matches, line, index) => {
    if (line.trim().startsWith('- ') && cleanFact(line) === target) matches.push(index);
    return matches;
  }, []);
  if (matchIndexes.length !== 1) return { content: fileContent, deleted: false };
  const removedLine = lines[matchIndexes[0]];
  lines.splice(matchIndexes[0], 1);
  const newline = sectionText.includes('\r\n') ? '\r\n' : '\n';
  return {
    content: fileContent.slice(0, section.bodyStart) + lines.join(newline) + fileContent.slice(section.end),
    deleted: true,
    id: removedLine.match(BULLET_ID_RE)?.[1],
    removed: bulletBody(removedLine),
  };
}

/** Keep retained history on disk but never promote stale/superseded or poisoned bullets into retrieval. */
export function sanitizeMemoryRecallText(raw: string): string {
  return String(raw || '').split(/\r?\n/).filter((line) => {
    if (!line.trim().startsWith('- ')) return true;
    return !/\[(?:superseded\b|stale|memory-status:untrusted)/i.test(line) && !isPoisonMemoryFact(line);
  }).map((line) => renderMemoryIdsForPrompt(line)).join('\n');
}

