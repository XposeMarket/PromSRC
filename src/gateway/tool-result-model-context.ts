const MODEL_TOOL_RESULT_MAX_CHARS = 12000;
const MODEL_TOOL_RESULT_HEAD_CHARS = 7000;
const MODEL_TOOL_RESULT_TAIL_CHARS = 2500;

function summarizeLargeJsonToolResultForModel(value: string, toolName: string, maxChars: number): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const matches = Array.isArray(parsed.matches) ? parsed.matches : null;
  if (!matches) return null;
  const fileCounts = new Map<string, number>();
  for (const match of matches) {
    const file = String(match?.file || match?.path || parsed.file || parsed.path || '(unknown)');
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
  }
  const topFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));
  const compactMatches = matches.slice(0, 24).map((match: any) => ({
    file: match?.file || match?.path || parsed.file || parsed.path,
    line_number: match?.line_number,
    line: String(match?.line || '').slice(0, 260),
  }));
  const summary = {
    summarized_tool_result: true,
    tool: toolName || 'tool',
    searched: parsed.searched || parsed.directory || parsed.file || parsed.path,
    pattern: parsed.pattern,
    match_count: parsed.match_count ?? matches.length,
    returned_count: parsed.returned_count ?? matches.length,
    result_limit: parsed.result_limit,
    top_files: topFiles,
    first_matches: compactMatches,
    omitted_matches: Math.max(0, matches.length - compactMatches.length),
    note: 'Large search result was summarized before reinjection into model context. Narrow with path/glob/pattern or read a targeted file window for exact code.',
  };
  const text = JSON.stringify(summary, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...large ${toolName || 'tool'} summary truncated]`;
}

function modelToolResultRecoveryHint(rawRef?: string): string {
  if (rawRef) {
    return [
      'The omitted content is recoverable in this chat session.',
      `Use tool_result_read with raw_ref=${rawRef}, offset_bytes:0, and a targeted max_chars value only if the missing range is required.`,
    ].join(' ');
  }
  return 'No raw retrieval reference is available. Rerun the source tool with narrower filters or a targeted file window if the omitted range is required.';
}

export function boundToolTextForModelContext(
  text: string,
  toolName: string,
  maxChars = MODEL_TOOL_RESULT_MAX_CHARS,
  rawRef?: string,
): string {
  const value = String(text || '');
  if (!value || value.length <= maxChars) return value;
  const summarized = summarizeLargeJsonToolResultForModel(value, toolName, maxChars);
  if (summarized) {
    return `${summarized}\n${modelToolResultRecoveryHint(rawRef)}`;
  }
  const headChars = Math.max(1000, Math.min(MODEL_TOOL_RESULT_HEAD_CHARS, Math.floor(maxChars * 0.75)));
  const tailChars = Math.max(1000, Math.min(MODEL_TOOL_RESULT_TAIL_CHARS, maxChars - headChars));
  const omitted = value.length - headChars - tailChars;
  return [
    value.slice(0, headChars).trimEnd(),
    '',
    `[TOOL_RESULT_BOUNDED] ${omitted.toLocaleString('en-US')} chars omitted from ${toolName || 'tool'} result before reinjecting into model context.`,
    modelToolResultRecoveryHint(rawRef),
    '',
    value.slice(-tailChars).trimStart(),
  ].join('\n');
}

export function boundToolMessageContentForModelContext(content: any, toolName: string, rawRef?: string): any {
  // A skill is not considered read if its entrypoint was clipped before the
  // next reasoning round. skill_read already returns one chosen skill plus a
  // resource index, so preserve that result in full. Bundle resources remain
  // progressive and are fetched individually with skill_resource_read.
  if (toolName === 'skill_read') return content;
  if (typeof content === 'string') return boundToolTextForModelContext(content, toolName, MODEL_TOOL_RESULT_MAX_CHARS, rawRef);
  if (!Array.isArray(content)) return content;
  return content.map((part: any) => {
    if (!part || typeof part !== 'object' || part.type !== 'text') return part;
    return {
      ...part,
      text: boundToolTextForModelContext(String(part.text || ''), toolName, MODEL_TOOL_RESULT_MAX_CHARS, rawRef),
    };
  });
}


export function buildToolOutputArtifactPreview(input: {
  toolName: string;
  text: string;
  inlineLimit: number;
  artifactPath: string;
  summary?: string;
}): string {
  const text = String(input.text || '');
  const inlineLimit = Math.max(1000, Math.floor(Number(input.inlineLimit) || 1000));
  const previewBudget = Math.max(1000, Math.min(inlineLimit - 800, 8000));
  const headChars = Math.max(600, Math.floor(previewBudget * 0.7));
  const tailChars = Math.max(300, previewBudget - headChars);
  const omitted = Math.max(0, text.length - headChars - tailChars);
  return [
    input.summary || `${input.toolName} output was ${text.length} chars, which exceeds the ${inlineLimit} char inline budget.`,
    `[TOOL_RESULT_ARTIFACT] Full output saved to ${input.artifactPath}. Read targeted ranges from that artifact only if the omitted range is needed.`,
    '',
    text.slice(0, headChars).trimEnd(),
    '',
    `[...${omitted.toLocaleString('en-US')} chars omitted from inline preview...]`,
    '',
    text.slice(-tailChars).trimStart(),
  ].join('\n');
}
