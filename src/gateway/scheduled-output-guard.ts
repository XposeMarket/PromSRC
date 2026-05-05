export const OBSOLETE_PRODUCT_BRAND_RE = /\bSmallClaw\b/i;

export function containsObsoleteProductBrand(text: string): boolean {
  return OBSOLETE_PRODUCT_BRAND_RE.test(String(text || ''));
}

export function buildObsoleteBrandBlockMessage(context: string): string {
  return [
    `BLOCKED: ${context} contains obsolete SmallClaw branding.`,
    'Current product identity is Prometheus.',
    'Regenerate from real current source files/evidence before delivering user-facing output.',
  ].join(' ');
}

export function normalizeWorkspaceAliasPath(inputPath: string, workspaceRoot: string): string {
  const normalized = String(inputPath || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  const alias = String(workspaceRoot || '').trim().replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || '';
  return alias && normalized.toLowerCase().startsWith(`${alias}/`)
    ? normalized.slice(alias.length + 1)
    : normalized;
}

export function extractPromptRequiredWorkspaceReads(prompt: string): string[] {
  const text = String(prompt || '');
  const paths = new Set<string>();
  const re = /\b(?:first\s+read|read)\s+`?((?:workspace\/)[A-Za-z0-9._/-]+)`?/gi;
  for (const match of text.matchAll(re)) {
    const candidate = String(match[1] || '').replace(/[.,;:)\]]+$/g, '');
    const sentenceStart = Math.max(0, text.lastIndexOf('\n', match.index ?? 0) + 1);
    const sentenceEnd = (() => {
      const after = text.slice((match.index ?? 0) + String(match[0] || '').length);
      const stop = after.search(/[\n.]/);
      return stop >= 0 ? (match.index ?? 0) + String(match[0] || '').length + stop : text.length;
    })();
    const sentence = text.slice(sentenceStart, sentenceEnd).toLowerCase();
    const followup = text.slice(sentenceEnd, Math.min(text.length, sentenceEnd + 300)).toLowerCase();
    const localContext = `${sentence}\n${followup}`;
    if (/\b(if present|if it exists|if available|optional)\b/.test(localContext)) continue;
    if (/\b(if missing|if it does not exist|if it doesn't exist|if missing\/empty)\b[\s\S]{0,160}\bcreate\b/.test(localContext)) continue;
    if (candidate) paths.add(candidate);
  }
  return [...paths];
}

export function buildMissingSourceBlockMessage(paths: string[]): string {
  const list = paths.map((p) => `- ${p}`).join('\n');
  return [
    'BLOCKED: required scheduled-job source file is missing.',
    list,
    'Do not synthesize from chat memory, prior run results, lastResult, or legacy context.',
    'Run the upstream synthesis/collector job and generate the real source file from evidence first.',
  ].join('\n');
}
