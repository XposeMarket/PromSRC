export type MemoryFactWriteResult = {
  content: string;
  supersededCount: number;
  flaggedAsUntrusted: boolean;
};

const STATUS_RE = /\s*\[(?:superseded(?:\s+[^\]]*)?|stale|memory-status:[^\]]*)\]/gi;
const DATE_RE = /\s*\[\d{4}-\d{2}-\d{2}\]\s*$/;
const FACT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'our', 'that', 'the', 'this', 'to', 'was', 'we', 'with', 'you', 'your',
]);

function cleanFact(value: string): string {
  return String(value || '')
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

function categoryRange(fileContent: string, category: string): { bodyStart: number; end: number } | null {
  const heading = `## ${String(category || '').trim()}`;
  const headingAt = fileContent.indexOf(`\n${heading}`);
  const start = headingAt === -1 && fileContent.startsWith(heading) ? 0 : headingAt;
  if (start === -1) return null;
  const bodyStart = start + (start === 0 ? heading.length : heading.length + 1);
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

export function writeMemoryFact(fileContent: string, category: string, fact: string, date: string): MemoryFactWriteResult {
  const safeFact = String(fact || '').trim();
  const poisoned = isPoisonMemoryFact(safeFact);
  const entry = `- ${safeFact} [${date}]${poisoned ? ' [memory-status:untrusted]' : ''}`;
  const section = categoryRange(fileContent, category);
  if (!section) {
    const closing = fileContent.lastIndexOf('\n---');
    const insertAt = closing === -1 ? fileContent.length : closing;
    return {
      content: fileContent.slice(0, insertAt) + `\n\n## ${category}\n${entry}\n` + fileContent.slice(insertAt),
      supersededCount: 0,
      flaggedAsUntrusted: poisoned,
    };
  }

  const sectionText = fileContent.slice(section.bodyStart, section.end);
  let supersededCount = 0;
  const updatedSection = sectionText.split(/(\r?\n)/).map((part) => {
    if (poisoned || !part.startsWith('- ') || /\[(?:superseded|memory-status:untrusted)/i.test(part)) return part;
    if (!memoryFactsConflict(part, safeFact)) return part;
    supersededCount += 1;
    const priorDate = entryDate(part);
    const nextDate = Date.parse(`${date}T00:00:00.000Z`);
    const stale = priorDate && Number.isFinite(nextDate) && nextDate - priorDate >= 90 * 86400000 ? ' [stale]' : '';
    return `${part.replace(/\s*$/, '')} [superseded ${date} by ${safeFact}]${stale}`;
  }).join('');
  const newline = updatedSection && !updatedSection.endsWith('\n') ? '\n' : '';
  return {
    content: fileContent.slice(0, section.bodyStart) + updatedSection + newline + entry + '\n' + fileContent.slice(section.end),
    supersededCount,
    flaggedAsUntrusted: poisoned,
  };
}

export function deleteMemoryFact(fileContent: string, category: string, exactContent: string): { content: string; deleted: boolean } {
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
  lines.splice(matchIndexes[0], 1);
  const newline = sectionText.includes('\r\n') ? '\r\n' : '\n';
  return { content: fileContent.slice(0, section.bodyStart) + lines.join(newline) + fileContent.slice(section.end), deleted: true };
}

/** Keep retained history on disk but never promote stale/superseded or poisoned bullets into retrieval. */
export function sanitizeMemoryRecallText(raw: string): string {
  return String(raw || '').split(/\r?\n/).filter((line) => {
    if (!line.trim().startsWith('- ')) return true;
    return !/\[(?:superseded\b|stale|memory-status:untrusted)/i.test(line) && !isPoisonMemoryFact(line);
  }).join('\n');
}
