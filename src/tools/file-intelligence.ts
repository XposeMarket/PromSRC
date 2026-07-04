import fs from 'fs';
import path from 'path';

export const DEFAULT_FILE_TOOL_EXCLUDES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.prometheus',
  'coverage',
  'generated',
  'temp',
  'logs',
];

export type SearchMatcher = {
  pattern: string;
  regex: RegExp;
  mode: 'literal' | 'regex';
  caseInsensitive: boolean;
};

export type SuggestedReadWindow = {
  path: string;
  around_line: number;
  start_line: number;
  num_lines: number;
};

export type GrepMatchRecord = {
  path: string;
  file?: string;
  line_number: number;
  line: number;
  column: number;
  text: string;
  match: string;
  match_index_on_line?: number;
  physical_line_length?: number;
  char_window?: {
    start_column: number;
    end_column: number;
    before: string;
    match: string;
    after: string;
    text: string;
    truncated_left: boolean;
    truncated_right: boolean;
  };
  context_before?: string[];
  context_after?: string[];
  suggested_read: SuggestedReadWindow;
  suggested_exact_read?: {
    path: string;
    line: number;
    column: number;
    char_window: number;
  };
};

export type FileIntelligence = {
  file: string;
  language: string;
  line_count: number;
  bytes: number;
  last_modified: string;
  is_large: boolean;
  imports?: string[];
  exports?: Array<{ name: string; line: number; kind: string }>;
  symbols?: Array<{ name: string; line: number; kind: string }>;
  headings?: Array<{ text: string; line: number; level: number }>;
  markdown_links?: Array<{ text: string; target: string; line: number }>;
  routes?: Array<{ method: string; path: string; line: number }>;
  query_matches?: Array<{ line: number; column: number; text: string; suggested_read: SuggestedReadWindow }>;
  recommended_reads: SuggestedReadWindow[];
  physical_lines?: {
    longest_line: number;
    longest_line_length: number;
    average_line_length: number;
    long_line_count: number;
    minified_like: boolean;
    examples: Array<{ line: number; length: number; preview: string }>;
  };
  read_hints?: string[];
};

export type FileSyntaxValidationIssue = {
  severity: 'error' | 'warning' | 'suggestion' | 'message';
  message: string;
  code?: number | string;
  scriptIndex?: number;
  scriptType?: string | null;
  scriptLine?: number;
  scriptColumn?: number;
  line: number;
  column: number;
  length?: number;
  frame?: string;
};

export type FileSyntaxValidationResult = {
  file: string;
  kind: 'html' | 'javascript' | 'typescript' | 'unsupported';
  supported: boolean;
  ok: boolean;
  script_count?: number;
  checked_script_count?: number;
  skipped_script_count?: number;
  issues: FileSyntaxValidationIssue[];
  note?: string;
};

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript-react',
  '.js': 'javascript',
  '.jsx': 'javascript-react',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.py': 'python',
  '.ps1': 'powershell',
  '.sh': 'shell',
};

export function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveResultCharBudget(args: any, defaultChars: number): number {
  const requestedTokens = Math.floor(Number(args?.max_result_tokens ?? args?.maxResultTokens) || 0);
  if (!requestedTokens) return defaultChars;
  const requestedChars = requestedTokens * 4;
  const hardChars = Math.max(4000, Math.floor(Number(args?.hard_max_result_tokens ?? args?.hardMaxResultTokens) || 4000) * 4);
  return Math.max(800, Math.min(hardChars, requestedChars));
}

export function createSearchMatcher(pattern: string, opts: { regex?: boolean; literal?: boolean; caseInsensitive?: boolean } = {}): SearchMatcher {
  const raw = String(pattern || '');
  const useRegex = opts.regex === true && opts.literal !== true;
  const source = useRegex ? raw : escapeRegExp(raw);
  const flags = `g${opts.caseInsensitive ? 'i' : ''}`;
  return {
    pattern: raw,
    regex: new RegExp(source, flags),
    mode: useRegex ? 'regex' : 'literal',
    caseInsensitive: opts.caseInsensitive === true,
  };
}

export function detectLanguage(filePath: string): string {
  const base = path.basename(String(filePath || '')).toLowerCase();
  if (base === 'package.json') return 'package-json';
  if (base === 'tsconfig.json') return 'typescript-config';
  return EXT_LANG[path.extname(base)] || 'text';
}

export function trimToolLine(line: string, max = 500): string {
  const value = String(line ?? '');
  return value.length <= max ? value : `${value.slice(0, max)}...[line truncated]`;
}

export function resolvePositiveLineArg(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatPhysicalLineWindow(
  displayPath: string,
  allLines: string[],
  opts: {
    line?: number;
    line_number?: number;
    column?: number;
    char_window?: number;
    full_line?: boolean;
    show_full_line?: boolean;
  } = {}
): string {
  const rawLineNumber = opts.line ?? opts.line_number;
  const lineNumber = Math.floor(Number(rawLineNumber));
  if (!Number.isFinite(lineNumber) || lineNumber < 1) {
    return `${displayPath} (${allLines.length} lines):\n[LINE_OUT_OF_RANGE] Requested physical line ${rawLineNumber ?? 'missing'}. Valid range: 1-${allLines.length}.`;
  }
  if (lineNumber > allLines.length) {
    return `${displayPath} (${allLines.length} lines):\n[LINE_OUT_OF_RANGE] Requested physical line ${lineNumber}. Valid range: 1-${allLines.length}.`;
  }
  const rawLine = String(allLines[lineNumber - 1] ?? '').replace(/\r$/, '');
  const lineLength = rawLine.length;
  const column = Math.max(1, Math.floor(Number(opts.column) || 1));
  const showFull = opts.full_line === true || opts.show_full_line === true;
  const requestedWindow = Math.floor(Number(opts.char_window) || 240);
  const charWindow = Math.max(80, Math.min(4000, requestedWindow));
  const needsWindow = !showFull && lineLength > charWindow;
  const zeroColumn = Math.max(0, Math.min(lineLength, column - 1));
  const half = Math.floor(charWindow / 2);
  const start = needsWindow ? Math.max(0, Math.min(Math.max(0, lineLength - charWindow), zeroColumn - half)) : 0;
  const end = needsWindow ? Math.min(lineLength, start + charWindow) : lineLength;
  const shown = rawLine.slice(start, end);
  const prefix = `${lineNumber}: `;
  const lines = [
    `${displayPath} (${allLines.length} lines) [physical line ${lineNumber}, ${lineLength} chars${needsWindow ? `, chars ${start + 1}-${end}` : ''}]:`,
    `${prefix}${shown}`,
  ];
  if (Number.isFinite(Number(opts.column)) && column >= 1) {
    if (column >= start + 1 && column <= end + 1) {
      lines.push(`${' '.repeat(prefix.length + Math.max(0, column - start - 1))}^ column ${column}`);
    } else {
      lines.push(`[COLUMN_OUTSIDE_WINDOW] Requested column ${column}; shown chars ${start + 1}-${end}. Pass full_line:true or a larger char_window to include it.`);
    }
  }
  if (needsWindow) {
    lines.push(`[LINE_WINDOW] Returned ${shown.length} of ${lineLength} chars. Pass full_line:true for the full physical line or char_window:<n> to widen this view.`);
  }
  return lines.join('\n');
}

function lineStartsFor(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function offsetToLineColumn(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  const target = Math.max(0, offset);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= target) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: target - lineStarts[lineIndex] + 1 };
}

function buildCodeFrame(lines: string[], line: number, column: number, context = 1): string {
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const out: string[] = [];
  for (let current = start; current <= end; current += 1) {
    const text = (lines[current - 1] || '').replace(/\r$/, '');
    out.push(`${current}: ${trimToolLine(text, 260)}`);
    if (current === line) out.push(`${' '.repeat(String(current).length + 2 + Math.max(0, column - 1))}^`);
  }
  return out.join('\n');
}

function scriptKindForPath(ts: any, displayPath: string): any {
  const ext = path.extname(displayPath).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.ts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function severityForDiagnostic(ts: any, category: any): FileSyntaxValidationIssue['severity'] {
  if (category === ts.DiagnosticCategory.Error) return 'error';
  if (category === ts.DiagnosticCategory.Warning) return 'warning';
  if (category === ts.DiagnosticCategory.Suggestion) return 'suggestion';
  return 'message';
}

function shouldSkipHtmlScript(attrs: string): { skip: boolean; type: string | null } {
  const typeMatch = String(attrs || '').match(/\btype\s*=\s*["']?([^"'\s>]+)["']?/i);
  const type = typeMatch ? typeMatch[1].toLowerCase() : null;
  if (!type) return { skip: false, type: null };
  const jsTypes = new Set([
    'text/javascript',
    'application/javascript',
    'application/ecmascript',
    'text/ecmascript',
    'module',
  ]);
  if (jsTypes.has(type) || type.endsWith('/javascript') || type.endsWith('/ecmascript')) return { skip: false, type };
  return { skip: true, type };
}

function validateScriptText(displayPath: string, content: string, opts: {
  kind: 'javascript' | 'typescript';
  scriptIndex?: number;
  scriptType?: string | null;
  htmlOffset?: number;
  htmlLineStarts?: number[];
  htmlLines?: string[];
}): FileSyntaxValidationIssue[] {
  let ts: any;
  try {
    // Lazy load keeps normal file stats/search cheap and avoids parser startup unless validation is requested.
    ts = require('typescript');
  } catch (err: any) {
    return [{
      severity: 'error',
      message: `TypeScript parser unavailable: ${String(err?.message || err)}`,
      line: 1,
      column: 1,
    }];
  }
  const source = ts.createSourceFile(
    displayPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(ts, displayPath),
  );
  const scriptStarts = lineStartsFor(content);
  const htmlStarts = opts.htmlLineStarts || scriptStarts;
  const htmlLines = opts.htmlLines || content.split('\n');
  return (source.parseDiagnostics || []).map((diagnostic: any) => {
    const start = Math.max(0, Number(diagnostic.start) || 0);
    const scriptPos = offsetToLineColumn(scriptStarts, start);
    const htmlPos = opts.htmlOffset != null
      ? offsetToLineColumn(htmlStarts, opts.htmlOffset + start)
      : scriptPos;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    return {
      severity: severityForDiagnostic(ts, diagnostic.category),
      message,
      code: diagnostic.code,
      scriptIndex: opts.scriptIndex,
      scriptType: opts.scriptType,
      scriptLine: opts.scriptIndex != null ? scriptPos.line : undefined,
      scriptColumn: opts.scriptIndex != null ? scriptPos.column : undefined,
      line: htmlPos.line,
      column: htmlPos.column,
      length: diagnostic.length,
      frame: buildCodeFrame(htmlLines, htmlPos.line, htmlPos.column),
    };
  });
}

function parseParamNames(rawParams: string): string[] {
  return String(rawParams || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\/\*.*?\*\//g, '').trim())
    .map((part) => part.split('=')[0].replace(/^[.{\s]+|[}\s]+$/g, '').trim())
    .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
}

function paramHasDefault(rawParams: string, name: string): boolean {
  return String(rawParams || '')
    .split(',')
    .some((part) => {
      const trimmed = part.trim();
      return new RegExp(`^\\s*${escapeRegExp(name)}\\s*=`).test(trimmed);
    });
}

function positionIssue(
  message: string,
  content: string,
  offset: number,
  opts: {
    htmlOffset?: number;
    htmlLineStarts?: number[];
    htmlLines?: string[];
    scriptIndex?: number;
    scriptType?: string | null;
    code?: string;
  } = {},
): FileSyntaxValidationIssue {
  const scriptStarts = lineStartsFor(content);
  const htmlStarts = opts.htmlLineStarts || scriptStarts;
  const htmlLines = opts.htmlLines || content.split('\n');
  const scriptPos = offsetToLineColumn(scriptStarts, offset);
  const htmlPos = opts.htmlOffset != null
    ? offsetToLineColumn(htmlStarts, opts.htmlOffset + offset)
    : scriptPos;
  return {
    severity: 'warning',
    message,
    code: opts.code,
    scriptIndex: opts.scriptIndex,
    scriptType: opts.scriptType,
    scriptLine: opts.scriptIndex != null ? scriptPos.line : undefined,
    scriptColumn: opts.scriptIndex != null ? scriptPos.column : undefined,
    line: htmlPos.line,
    column: htmlPos.column,
    frame: buildCodeFrame(htmlLines, htmlPos.line, htmlPos.column),
  };
}

function collectJavaScriptRiskWarnings(content: string, opts: {
  htmlOffset?: number;
  htmlLineStarts?: number[];
  htmlLines?: string[];
  scriptIndex?: number;
  scriptType?: string | null;
} = {}): FileSyntaxValidationIssue[] {
  const warnings: FileSyntaxValidationIssue[] = [];
  const add = (message: string, offset: number, code: string) => {
    if (warnings.length >= 40) return;
    warnings.push(positionIssue(message, content, Math.max(0, offset), { ...opts, code }));
  };

  const fnRegex = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{)|(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*\{?)/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRegex.exec(content)) !== null) {
    const fnName = fnMatch[1] || fnMatch[3] || '';
    if (!fnName) continue;
    const rawParams = fnMatch[2] || fnMatch[4] || fnMatch[5] || '';
    const params = parseParamNames(rawParams);
    if (!params.length) continue;
    const bodyStart = fnRegex.lastIndex;
    const bodyWindow = content.slice(bodyStart, Math.min(content.length, bodyStart + 8000));
    const setterRegex = /\.([A-Za-z_$][\w$]*)\.set\s*\(([^)]*)\)/g;
    let setterMatch: RegExpExecArray | null;
    while ((setterMatch = setterRegex.exec(bodyWindow)) !== null) {
      const setterArgs = setterMatch[2].split(',').map((part) => part.trim()).filter(Boolean);
      const riskyArgIndexes = setterArgs
        .map((arg, argIndex) => ({ arg, argIndex, paramIndex: params.indexOf(arg) }))
        .filter((entry) => entry.paramIndex >= 0 && !paramHasDefault(rawParams, entry.arg));
      if (!riskyArgIndexes.length) continue;
      const highestParamIndex = Math.max(...riskyArgIndexes.map((entry) => entry.paramIndex));
      const callRegex = new RegExp(`\\b${escapeRegExp(fnName)}\\s*\\(([^)]*)\\)`, 'g');
      let omittedCallCount = 0;
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(content)) !== null) {
        if (callMatch.index === fnMatch.index) continue;
        const callArgs = callMatch[1].trim() ? callMatch[1].split(',').length : 0;
        if (callArgs <= highestParamIndex) omittedCallCount += 1;
        if (omittedCallCount >= 3) break;
      }
      if (omittedCallCount > 0) {
        add(
          `Possible undefined numeric setter args: ${fnName} passes parameter(s) ${riskyArgIndexes.map((entry) => entry.arg).join(', ')} into .${setterMatch[1]}.set(...) without defaults, and ${omittedCallCount} call site(s) appear to omit them.`,
          bodyStart + setterMatch.index,
          'risk_optional_param_setter',
        );
      }
    }
  }

  const srcAssignRegex = /\b(?:[A-Za-z_$][\w$]*\.)?src\s*=/g;
  let srcMatch: RegExpExecArray | null;
  while ((srcMatch = srcAssignRegex.exec(content)) !== null) {
    const before = content.slice(Math.max(0, srcMatch.index - 900), srcMatch.index);
    if (/(requestAnimationFrame|setAnimationLoop|function\s+(?:render|animate)\b|const\s+(?:render|animate)\s*=|for\s*\(|while\s*\()/i.test(before)) {
      add('Possible repeated media src assignment inside a render/animation/loop context. Memoize or move src assignment out of the hot path.', srcMatch.index, 'risk_repeated_src_assignment');
    }
  }

  const flipRegex = /\.flipY\s*=/g;
  let flipMatch: RegExpExecArray | null;
  while ((flipMatch = flipRegex.exec(content)) !== null) {
    add('Texture flipY is being changed. Verify this is intentional across mobile/WebGL loaders and canvas textures.', flipMatch.index, 'risk_texture_flipY');
  }

  const yawRegex = /\b(?:camera\.)?rotation\.y\s*=|\byaw\s*[+\-*/]?=/g;
  let yawMatch: RegExpExecArray | null;
  while ((yawMatch = yawRegex.exec(content)) !== null) {
    add('Camera/yaw state is assigned directly. Verify initial orientation and mobile pointer/touch controls still agree with this value.', yawMatch.index, 'risk_camera_yaw');
  }

  return warnings;
}

export function validateFileSyntax(displayPath: string, content: string): FileSyntaxValidationResult {
  const language = detectLanguage(displayPath);
  const lower = String(displayPath || '').toLowerCase();
  if (language === 'html' || lower.endsWith('.htm')) {
    const htmlLineStarts = lineStartsFor(content);
    const htmlLines = String(content || '').split('\n');
    const issues: FileSyntaxValidationIssue[] = [];
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let scriptIndex = 0;
    let checked = 0;
    let skipped = 0;
    while ((match = scriptRegex.exec(content)) !== null) {
      scriptIndex += 1;
      const attrs = match[1] || '';
      const body = match[2] || '';
      const typeInfo = shouldSkipHtmlScript(attrs);
      if (typeInfo.skip) {
        skipped += 1;
        continue;
      }
      checked += 1;
      const bodyOffset = match.index + match[0].indexOf(body);
      issues.push(...validateScriptText(`${displayPath}#script-${scriptIndex}.js`, body, {
        kind: 'javascript',
        scriptIndex,
        scriptType: typeInfo.type,
        htmlOffset: bodyOffset,
        htmlLineStarts,
        htmlLines,
      }));
      issues.push(...collectJavaScriptRiskWarnings(body, {
        scriptIndex,
        scriptType: typeInfo.type,
        htmlOffset: bodyOffset,
        htmlLineStarts,
        htmlLines,
      }));
    }
    return {
      file: displayPath,
      kind: 'html',
      supported: true,
      ok: issues.filter((issue) => issue.severity === 'error').length === 0,
      script_count: scriptIndex,
      checked_script_count: checked,
      skipped_script_count: skipped,
      issues,
      note: scriptIndex ? undefined : 'No <script> blocks found.',
    };
  }
  if (['javascript', 'javascript-react', 'typescript', 'typescript-react'].includes(language)) {
    const issues = validateScriptText(displayPath, content, {
      kind: language.startsWith('typescript') ? 'typescript' : 'javascript',
    });
    issues.push(...collectJavaScriptRiskWarnings(content));
    return {
      file: displayPath,
      kind: language.startsWith('typescript') ? 'typescript' : 'javascript',
      supported: true,
      ok: issues.filter((issue) => issue.severity === 'error').length === 0,
      issues,
    };
  }
  return {
    file: displayPath,
    kind: 'unsupported',
    supported: false,
    ok: true,
    issues: [],
    note: `No syntax validator is registered for ${language}. Supported: .html/.htm, .js/.jsx, .ts/.tsx.`,
  };
}

export function formatSyntaxValidationResult(result: FileSyntaxValidationResult): string {
  const lines = [
    `${result.file}: ${result.supported ? (result.ok ? 'SYNTAX OK' : 'SYNTAX ERRORS') : 'syntax validation unsupported'} (${result.kind})`,
  ];
  if (result.script_count != null) {
    lines.push(`scripts: ${result.checked_script_count || 0} checked, ${result.skipped_script_count || 0} skipped, ${result.script_count} total`);
  }
  if (result.note) lines.push(`note: ${result.note}`);
  if (result.issues.length) {
    lines.push(`issues: ${result.issues.length}`);
    for (const issue of result.issues.slice(0, 12)) {
      const script = issue.scriptIndex != null ? ` script#${issue.scriptIndex}${issue.scriptLine != null ? `:${issue.scriptLine}:${issue.scriptColumn}` : ''}` : '';
      lines.push(`- ${issue.severity.toUpperCase()} ${result.file}:${issue.line}:${issue.column}${script} TS${issue.code || ''} ${issue.message}`);
      if (issue.frame) lines.push(issue.frame);
    }
    if (result.issues.length > 12) lines.push(`...[${result.issues.length - 12} more issue(s) omitted]`);
  }
  return lines.join('\n');
}

export function buildSuggestedRead(pathName: string, line: number, lineCount: number, before = 40, after = 80): SuggestedReadWindow {
  const around = Math.max(1, Math.floor(Number(line) || 1));
  const startLine = Math.max(1, around - Math.max(0, Math.floor(before)));
  const endLine = Math.max(startLine, Math.min(Math.max(1, lineCount), around + Math.max(0, Math.floor(after))));
  return {
    path: pathName,
    around_line: around,
    start_line: startLine,
    num_lines: endLine - startLine + 1,
  };
}

function analyzePhysicalLines(lines: string[]): NonNullable<FileIntelligence['physical_lines']> {
  let longestLine = 1;
  let longestLength = 0;
  let totalLength = 0;
  const longLines: Array<{ line: number; length: number; preview: string }> = [];
  lines.forEach((raw, index) => {
    const text = String(raw || '').replace(/\r$/, '');
    const length = text.length;
    totalLength += length;
    if (length > longestLength) {
      longestLength = length;
      longestLine = index + 1;
    }
    if (length > 1000) {
      longLines.push({
        line: index + 1,
        length,
        preview: trimToolLine(text, 180),
      });
    }
  });
  const average = lines.length ? totalLength / lines.length : 0;
  return {
    longest_line: longestLine,
    longest_line_length: longestLength,
    average_line_length: Math.round(average),
    long_line_count: longLines.length,
    minified_like: longestLength > 2000 || (lines.length <= 20 && totalLength > 12000) || average > 600,
    examples: longLines
      .sort((a, b) => b.length - a.length)
      .slice(0, 5),
  };
}

function parseImportModules(lines: string[]): string[] {
  const modules: string[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(0, 240)) {
    const match = line.match(/^\s*import\s+(?:type\s+)?(?:.+?\s+from\s+)?['"]([^'"]+)['"]/)
      || line.match(/^\s*(?:const|let|var)\s+.+?=\s+require\(['"]([^'"]+)['"]\)/);
    if (!match) continue;
    const mod = match[1];
    if (seen.has(mod)) continue;
    seen.add(mod);
    modules.push(mod);
    if (modules.length >= 12) break;
  }
  return modules;
}

function countBraceDelta(line: string): number {
  const stripped = String(line || '')
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\/.*$/, '');
  let delta = 0;
  for (const ch of stripped) {
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
}

export function buildFileIntelligence(displayPath: string, content: string, stat: { size: number; mtime: Date }, opts: { query?: string; readCap?: number } = {}): FileIntelligence {
  const lines = String(content || '').split('\n');
  const language = detectLanguage(displayPath);
  const readCap = Math.max(1, Math.floor(Number(opts.readCap) || 180));
  const physicalLines = analyzePhysicalLines(lines);
  const readHints: string[] = [];
  if (physicalLines.minified_like) {
    readHints.push(`This file looks minified or single-line-heavy. Prefer grep_file/search_files, then read_file with line + column + char_window instead of ordinary line windows.`);
  }
  if (physicalLines.long_line_count > 0) {
    readHints.push(`Longest physical line is ${physicalLines.longest_line_length} chars at line ${physicalLines.longest_line}; normal read_file windows trim long lines.`);
  }
  const exports: FileIntelligence['exports'] = [];
  const symbols: FileIntelligence['symbols'] = [];
  const headings: FileIntelligence['headings'] = [];
  const markdownLinks: NonNullable<FileIntelligence['markdown_links']> = [];
  const routes: FileIntelligence['routes'] = [];
  const seenExportNames = new Set<string>();
  const seenSymbols = new Set<string>();
  const seenMarkdownLinks = new Set<string>();

  const addExport = (name: string, line: number, kind: string) => {
    const clean = String(name || '').trim();
    if (!clean || seenExportNames.has(`${kind}:${clean}:${line}`)) return;
    seenExportNames.add(`${kind}:${clean}:${line}`);
    if (exports.length < 28) exports.push({ name: clean, line, kind });
  };
  const addSymbol = (name: string, line: number, kind: string) => {
    const clean = String(name || '').trim();
    if (!clean || seenSymbols.has(`${kind}:${clean}:${line}`)) return;
    seenSymbols.add(`${kind}:${clean}:${line}`);
    if (symbols.length < 36) symbols.push({ name: clean, line, kind });
  };
  const addMarkdownLink = (text: string, target: string, line: number) => {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    const cleanTarget = String(target || '').trim();
    if (!cleanText || !cleanTarget) return;
    const key = `${cleanText}:${cleanTarget}:${line}`;
    if (seenMarkdownLinks.has(key)) return;
    seenMarkdownLinks.add(key);
    if (markdownLinks.length < 40) markdownLinks.push({ text: cleanText.slice(0, 160), target: cleanTarget.slice(0, 220), line });
  };

  let braceDepth = 0;
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const cleanLine = line.replace(/\r$/, '');
    const trimmed = cleanLine.trim();
    if (language === 'markdown') {
      const heading = cleanLine.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
      if (heading && headings.length < 60) headings.push({ text: heading[2].trim().slice(0, 180), line: lineNo, level: heading[1].length });
      const next = (lines[index + 1] || '').replace(/\r$/, '');
      if (!heading && trimmed && /^(=+|-+)\s*$/.test(next.trim()) && headings.length < 60) {
        headings.push({ text: trimmed.slice(0, 180), line: lineNo, level: next.trim().startsWith('=') ? 1 : 2 });
      }
      const bulletLink = cleanLine.match(/^\s{0,6}[-*]\s+\[([^\]]+)\]\(([^)]+)\)/);
      if (bulletLink) addMarkdownLink(bulletLink[1], bulletLink[2], lineNo);
      const tableLink = cleanLine.match(/\|\s*(?:[^|]*\|\s*)?([^|]*?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|/);
      if (tableLink) addMarkdownLink(tableLink[1] || tableLink[2], tableLink[3], lineNo);
      return;
    }

    const depthBefore = braceDepth;
    const isTopLevel = depthBefore <= 0 && !/^\s+/.test(line);
    const exportDecl = line.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (exportDecl) {
      addExport(exportDecl[2], lineNo, exportDecl[1]);
      addSymbol(exportDecl[2], lineNo, exportDecl[1]);
    }
    const exportList = line.match(/^\s*export\s*\{([^}]+)\}/);
    if (exportList) {
      exportList[1].split(',').map((part) => part.trim().split(/\s+as\s+/i)[0]?.trim()).filter(Boolean).slice(0, 12).forEach((name) => addExport(name, lineNo, 'export'));
    }
    const topLevel = isTopLevel
      ? (line.match(/^(?:export\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/)
        || line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|class\b|\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?:=>|\{|\()/)
        || line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/))
      : null;
    if (topLevel) {
      if (topLevel.length === 3) addSymbol(topLevel[2], lineNo, topLevel[1]);
      else addSymbol(topLevel[1], lineNo, 'const');
    }
    const route = line.match(/\b(?:router|app)\.(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/i);
    if (route && routes.length < 36) routes.push({ method: route[1].toUpperCase(), path: route[2], line: lineNo });
    braceDepth = Math.max(0, braceDepth + countBraceDelta(line));
  });

  const recommendedReads: SuggestedReadWindow[] = [];
  for (const item of [...(headings || []), ...(exports || []), ...(routes || []), ...(symbols || [])].slice(0, 4)) {
    recommendedReads.push(buildSuggestedRead(displayPath, item.line, lines.length, 20, 60));
  }
  if (!recommendedReads.length) recommendedReads.push(buildSuggestedRead(displayPath, 1, lines.length, 0, Math.min(80, readCap)));

  let queryMatches: FileIntelligence['query_matches'] | undefined;
  if (opts.query) {
    try {
      const matcher = createSearchMatcher(String(opts.query), { literal: true, caseInsensitive: true });
      const found = collectGrepMatchesInText(displayPath, content, matcher, { maxResults: 6, contextLines: 0, before: 30, after: 60 });
      queryMatches = found.matches.map((match) => ({
        line: match.line,
        column: match.column,
        text: match.text,
        suggested_read: match.suggested_read,
      }));
      if (queryMatches.length) {
        recommendedReads.unshift(...queryMatches.slice(0, 3).map((match) => match.suggested_read));
      }
    } catch {
      queryMatches = undefined;
    }
  }

  return {
    file: displayPath,
    language,
    line_count: lines.length,
    bytes: stat.size,
    last_modified: stat.mtime.toISOString(),
    is_large: lines.length > readCap,
    imports: parseImportModules(lines),
    exports,
    symbols,
    headings,
    markdown_links: markdownLinks,
    routes,
    query_matches: queryMatches,
    recommended_reads: dedupeReadWindows(recommendedReads).slice(0, 8),
    physical_lines: physicalLines,
    read_hints: readHints,
  };
}

function dedupeReadWindows(windows: SuggestedReadWindow[]): SuggestedReadWindow[] {
  const seen = new Set<string>();
  const result: SuggestedReadWindow[] = [];
  for (const win of windows) {
    const key = `${win.path}:${win.start_line}:${win.num_lines}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(win);
  }
  return result;
}

export function summarizeFileForTool(displayPath: string, absPath: string, opts: { readCap?: number; query?: string } = {}): string {
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) return `${displayPath}/ [directory; batch_read only reads files]`;
  const content = fs.readFileSync(absPath, 'utf-8');
  const info = buildFileIntelligence(displayPath, content, stat, opts);
  return formatFileIntelligence(info);
}

export function formatFileIntelligence(info: FileIntelligence): string {
  const lines: string[] = [
    `${info.file}: ${info.line_count} lines, ${info.bytes} bytes, ${info.language}, modified ${info.last_modified}${info.is_large ? ' [large]' : ''}`,
  ];
  if (info.imports?.length) lines.push(`imports: ${info.imports.slice(0, 8).join(', ')}${info.imports.length > 8 ? ', ...' : ''}`);
  if (info.exports?.length) lines.push(`exports: ${info.exports.slice(0, 10).map((item) => `${item.name}@${item.line}`).join(', ')}${info.exports.length > 10 ? ', ...' : ''}`);
  if (info.symbols?.length) lines.push(`symbols: ${info.symbols.slice(0, 12).map((item) => `${item.kind} ${item.name}@${item.line}`).join(', ')}${info.symbols.length > 12 ? ', ...' : ''}`);
  if (info.routes?.length) lines.push(`routes: ${info.routes.slice(0, 10).map((item) => `${item.method} ${item.path}@${item.line}`).join(', ')}${info.routes.length > 10 ? ', ...' : ''}`);
  if (info.headings?.length) lines.push(`headings: ${info.headings.slice(0, 12).map((item) => `${'#'.repeat(item.level)} ${item.text}@${item.line}`).join(', ')}${info.headings.length > 12 ? ', ...' : ''}`);
  if (info.markdown_links?.length) lines.push(`markdown_links: ${info.markdown_links.slice(0, 10).map((item) => `${item.text} -> ${item.target}@${item.line}`).join(', ')}${info.markdown_links.length > 10 ? ', ...' : ''}`);
  if (info.physical_lines) {
    const p = info.physical_lines;
    lines.push(`physical_lines: longest=${p.longest_line_length} chars @${p.longest_line}, avg=${p.average_line_length}, long_lines=${p.long_line_count}${p.minified_like ? ', minified_like=true' : ''}`);
    if (p.examples.length) lines.push(`long_line_examples: ${p.examples.map((item) => `${item.line}:${item.length}`).join(', ')}`);
  }
  if (info.read_hints?.length) lines.push(`read_hints: ${info.read_hints.join(' | ')}`);
  if (info.query_matches?.length) lines.push(`query_matches: ${info.query_matches.map((item) => `${item.line}:${item.column}`).join(', ')}`);
  lines.push(`recommended_reads: ${JSON.stringify(info.recommended_reads.slice(0, 4))}`);
  return lines.join('\n');
}

export function collectGrepMatchesInText(
  displayPath: string,
  content: string,
  matcher: SearchMatcher,
  opts: { maxResults: number; contextLines?: number; before?: number; after?: number; charBefore?: number; charAfter?: number; charWindow?: number },
): { matches: GrepMatchRecord[]; totalMatches: number; truncatedCount: number; limitReached: boolean } {
  const lines = String(content || '').split('\n');
  const maxResults = Math.max(1, Math.floor(Number(opts.maxResults) || 50));
  const contextLines = Math.max(0, Math.min(3, Math.floor(Number(opts.contextLines) || 0)));
  const explicitCharWindow = Math.floor(Number(opts.charWindow) || 0);
  const charBefore = explicitCharWindow > 0 ? Math.floor(explicitCharWindow / 2) : Math.max(20, Math.min(800, Math.floor(Number(opts.charBefore) || 120)));
  const charAfter = explicitCharWindow > 0 ? Math.ceil(explicitCharWindow / 2) : Math.max(20, Math.min(1200, Math.floor(Number(opts.charAfter) || 220)));
  const matches: GrepMatchRecord[] = [];
  let totalMatches = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    matcher.regex.lastIndex = 0;
    let found: RegExpExecArray | null;
    let matchIndexOnLine = 0;
    while ((found = matcher.regex.exec(line)) !== null) {
      const rawMatch = found[0] || matcher.pattern;
      matchIndexOnLine += 1;
      totalMatches += 1;
      if (matches.length < maxResults) {
        const lineNumber = index + 1;
        const matchStart = found.index || 0;
        const matchEnd = matchStart + Math.max(1, rawMatch.length);
        const windowStart = Math.max(0, matchStart - charBefore);
        const windowEnd = Math.min(line.length, matchEnd + charAfter);
        const beforeText = line.slice(windowStart, matchStart);
        const matchText = line.slice(matchStart, matchEnd);
        const afterText = line.slice(matchEnd, windowEnd);
        const windowText = `${windowStart > 0 ? '...' : ''}${beforeText}${matchText}${afterText}${windowEnd < line.length ? '...' : ''}`;
        const item: GrepMatchRecord = {
          path: displayPath,
          file: displayPath,
          line_number: lineNumber,
          line: lineNumber,
          column: matchStart + 1,
          text: line.length > 700 ? trimToolLine(windowText, 700) : trimToolLine(line),
          match: trimToolLine(matchText || matcher.pattern, 160),
          match_index_on_line: matchIndexOnLine,
          physical_line_length: line.length,
          char_window: {
            start_column: windowStart + 1,
            end_column: windowEnd,
            before: beforeText,
            match: matchText,
            after: afterText,
            text: windowText,
            truncated_left: windowStart > 0,
            truncated_right: windowEnd < line.length,
          },
          suggested_read: buildSuggestedRead(displayPath, lineNumber, lines.length, opts.before ?? 40, opts.after ?? 80),
          suggested_exact_read: {
            path: displayPath,
            line: lineNumber,
            column: matchStart + 1,
            char_window: Math.max(160, Math.min(4000, charBefore + rawMatch.length + charAfter)),
          },
        };
        if (contextLines > 0) {
          item.context_before = lines.slice(Math.max(0, index - contextLines), index).map((ctx) => trimToolLine(ctx, 260));
          item.context_after = lines.slice(index + 1, Math.min(lines.length, index + 1 + contextLines)).map((ctx) => trimToolLine(ctx, 260));
        }
        matches.push(item);
      }
      if (rawMatch.length === 0) matcher.regex.lastIndex += 1;
    }
  }
  return {
    matches,
    totalMatches,
    truncatedCount: Math.max(0, totalMatches - matches.length),
    limitReached: totalMatches > matches.length,
  };
}

export function parseGlobList(raw: any): string[] {
  return String(raw || '').trim().toLowerCase().split(',').map((item) => item.trim()).filter(Boolean);
}

export function matchesGlobList(filenameOrRel: string, globs: string[]): boolean {
  if (!globs.length) return true;
  const lower = String(filenameOrRel || '').replace(/\\/g, '/').toLowerCase();
  const base = path.basename(lower);
  return globs.some((glob) => {
    const g = glob.toLowerCase();
    if (g.startsWith('*.')) return base.endsWith(g.slice(1));
    if (g.includes('*')) {
      const re = new RegExp(`^${escapeRegExp(g).replace(/\\\*/g, '.*')}$`);
      return re.test(lower) || re.test(base);
    }
    return lower.includes(g) || base.includes(g);
  });
}

export function buildNoMatchHints(input: { pattern: string; searched: string; mode: 'literal' | 'regex'; excluded?: string[]; pathHint?: string }): string[] {
  const hints = [
    input.mode === 'regex' ? 'regex mode is enabled; escape regex metacharacters or retry with literal:true' : 'literal mode is enabled; use regex:true only for regex syntax',
    'try case_insensitive:true if casing may differ',
    input.pathHint ? `verify the searched path: ${input.pathHint}` : `searched only ${input.searched}`,
  ];
  if (input.excluded?.length) hints.push(`default excludes may hide matches: ${input.excluded.slice(0, 8).join(', ')}`);
  if (/[-_\s]/.test(input.pattern)) hints.push('try alternate separators such as spaces, hyphens, underscores, or camelCase');
  return hints;
}

export function compareGrepMatches(query: string): (a: GrepMatchRecord, b: GrepMatchRecord) => number {
  const q = String(query || '').toLowerCase();
  const score = (item: GrepMatchRecord): number => {
    const p = String(item.path || item.file || '').toLowerCase();
    const base = path.basename(p);
    const text = String(item.text || '').toLowerCase();
    let value = 0;
    if (text.includes(q)) value += 120;
    if (base.includes(q)) value += 90;
    if (p.includes(q)) value += 60;
    if (p.includes('/src/')) value += 25;
    if (p.startsWith('src/')) value += 25;
    if (p.includes('/test') || p.includes('.test.') || p.includes('.spec.')) value -= q.includes('test') || q.includes('spec') ? -20 : 20;
    if (p.includes('generated/') || p.startsWith('generated/')) value -= 80;
    value -= Math.min(30, p.length / 20);
    return value;
  };
  return (a, b) => score(b) - score(a) || a.path.localeCompare(b.path) || a.line - b.line;
}

export function readSimpleGitignore(rootAbs: string): string[] {
  try {
    const file = path.join(rootAbs, '.gitignore');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .slice(0, 120);
  } catch {
    return [];
  }
}

export function isIgnoredBySimpleGitignore(relPath: string, rules: string[]): boolean {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const base = path.basename(rel);
  const parts = rel.split('/').filter(Boolean);
  for (const rule of rules) {
    const clean = rule.replace(/\\/g, '/').replace(/^\//, '');
    if (!clean) continue;
    if (clean.endsWith('/')) {
      const dir = clean.replace(/\/+$/, '');
      if (parts.includes(dir) || rel.startsWith(`${dir}/`)) return true;
      continue;
    }
    if (!clean.includes('/')) {
      if (parts.includes(clean) || base === clean) return true;
    }
    if (clean.includes('*')) {
      const re = new RegExp(`(^|/)${escapeRegExp(clean).replace(/\\\*/g, '.*')}($|/)`);
      if (re.test(rel)) return true;
    } else if (rel === clean || rel.startsWith(`${clean}/`) || rel.endsWith(`/${clean}`)) {
      return true;
    }
  }
  return false;
}

export function shouldSkipSearchPath(relPath: string, entryName: string, opts: { excludes?: Iterable<string>; gitignoreRules?: string[] } = {}): boolean {
  const excludes = new Set(Array.from(opts.excludes || DEFAULT_FILE_TOOL_EXCLUDES).map((item) => String(item).toLowerCase()));
  const name = String(entryName || '').toLowerCase();
  if (excludes.has(name)) return true;
  if (isIgnoredBySimpleGitignore(relPath, opts.gitignoreRules || [])) return true;
  return false;
}

export function buildRepoMapHeader(rootAbs: string, displayPath: string, opts: { maxDirs?: number; excludes?: string[] } = {}): string {
  const excludes = new Set([...(opts.excludes || DEFAULT_FILE_TOOL_EXCLUDES)].map((item) => item.toLowerCase()));
  const maxDirs = Math.max(3, Math.min(20, Number(opts.maxDirs) || 10));
  const topDirs: Array<{ name: string; files: number }> = [];
  const entrypoints: string[] = [];
  const knownEntrypoints = ['package.json', 'src/index.ts', 'src/cli/index.ts', 'src/gateway/server-v2.ts', 'web-ui/src/pages/ChatPage.js', 'web-ui/src/mobile/mobile-pages.js', 'README.md', 'tsconfig.json'];

  const countFiles = (dir: string, depth = 0): number => {
    if (depth > 4) return 0;
    let total = 0;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const entry of entries) {
      if (excludes.has(entry.name.toLowerCase())) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isFile()) total += 1;
      else if (entry.isDirectory()) total += countFiles(abs, depth + 1);
      if (total > 5000) return total;
    }
    return total;
  };

  try {
    for (const rel of knownEntrypoints) {
      if (fs.existsSync(path.join(rootAbs, rel))) entrypoints.push(rel);
    }
    const entries = fs.readdirSync(rootAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || excludes.has(entry.name.toLowerCase())) continue;
      topDirs.push({ name: `${entry.name}/`, files: countFiles(path.join(rootAbs, entry.name)) });
    }
  } catch {
    return '';
  }
  topDirs.sort((a, b) => {
    const preferred = ['src/', 'web-ui/', 'scripts/', 'electron/', 'workspace/', 'tests/'];
    const ai = preferred.indexOf(a.name);
    const bi = preferred.indexOf(b.name);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return b.files - a.files || a.name.localeCompare(b.name);
  });
  const lines = [`[REPO_MAP] ${displayPath || '.'}`];
  if (topDirs.length) lines.push(`top_dirs: ${topDirs.slice(0, maxDirs).map((item) => `${item.name} ${item.files} files`).join('; ')}`);
  if (entrypoints.length) lines.push(`entrypoints: ${entrypoints.join(', ')}`);
  lines.push('default_excludes: ' + Array.from(excludes).slice(0, 12).join(', '));
  return lines.join('\n');
}
