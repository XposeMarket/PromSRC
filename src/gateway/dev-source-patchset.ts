export interface TolerantReplaceResult {
  updated: string;
  count: number;
  variant: string;
  firstIndex: number;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function firstNonBlank(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizePatchOperation(value: unknown): string {
  const operation = String(value || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    replace: 'find_replace',
    exact_replace: 'find_replace',
    replace_text: 'find_replace',
    delete: 'delete_exact',
    remove: 'delete_exact',
    line_replace: 'replace_lines',
    insert: 'insert_after',
    write: 'write_file',
    create: 'create_file',
  };
  return aliases[operation] || operation;
}

/**
 * Accept the common patch vocabularies emitted by different providers and
 * convert them to the guarded dev-source patchset contract.
 */
export function normalizeDevSourcePatchsetArgs(rawArgs: any): any {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const fallbackFile = String(firstNonBlank(args.file, args.path) || '').trim();
  if (!Array.isArray(args.edits)) return args;

  args.edits = args.edits.map((rawEdit: any) => {
    const edit = rawEdit && typeof rawEdit === 'object' ? { ...rawEdit } : {};
    const file = firstNonBlank(edit.file, edit.path, edit.filename, fallbackFile);
    const find = firstDefined(edit.find, edit.old, edit.before, edit.expected_text);
    const replacement = firstDefined(edit.replace, edit.new, edit.after, edit.replacement);
    let op = normalizePatchOperation(firstNonBlank(edit.op, edit.operation, edit.action, edit.type));

    if (!op) {
      if (find !== undefined && replacement !== undefined) op = 'find_replace';
      else if (find !== undefined && edit.delete === true) op = 'delete_exact';
      else if (edit.start_line != null || edit.end_line != null) {
        op = firstDefined(edit.new_content, replacement, edit.content) !== undefined ? 'replace_lines' : 'delete_lines';
      } else if (edit.anchor != null) op = 'insert_after_anchor';
      else if (edit.after_line != null) op = 'insert_after';
    }

    if (file !== undefined) edit.file = String(file);
    if (op) edit.op = op;
    if (find !== undefined) edit.find = String(find);
    if (replacement !== undefined) edit.replace = String(replacement);
    if (edit.new_content === undefined && ['replace_lines', 'line_replace'].includes(op)) {
      edit.new_content = String(firstDefined(replacement, edit.content) ?? '');
    }
    return edit;
  });
  return args;
}

/**
 * Exact find/replace that treats CRLF and LF as equivalent, including files
 * whose line endings are mixed. Replacement newlines follow the file's
 * dominant style.
 */
export function applyLineEndingTolerantFindReplace(
  content: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): TolerantReplaceResult | null {
  if (!find) return null;
  let normalizedContent = '';
  const originalBoundaryForNormalizedOffset: number[] = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\r' && content[index + 1] === '\n') {
      normalizedContent += '\n';
      index += 1;
    } else {
      normalizedContent += content[index];
    }
    originalBoundaryForNormalizedOffset.push(index + 1);
  }
  const normalizedFind = find.replace(/\r\n/g, '\n');
  const matches: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom <= normalizedContent.length - normalizedFind.length) {
    const normalizedStart = normalizedContent.indexOf(normalizedFind, searchFrom);
    if (normalizedStart < 0) break;
    matches.push({
      start: originalBoundaryForNormalizedOffset[normalizedStart],
      end: originalBoundaryForNormalizedOffset[normalizedStart + normalizedFind.length],
    });
    if (!replaceAll) break;
    searchFrom = normalizedStart + normalizedFind.length;
  }
  if (!matches.length) return null;

  const globalCrlfCount = (content.match(/\r\n/g) || []).length;
  const globalLfCount = (content.match(/(?<!\r)\n/g) || []).length;
  let updated = content;
  for (const match of [...matches].reverse()) {
    const matchedText = content.slice(match.start, match.end);
    const localCrlfCount = (matchedText.match(/\r\n/g) || []).length;
    const localLfCount = (matchedText.match(/(?<!\r)\n/g) || []).length;
    const newline = localCrlfCount || localLfCount
      ? (localCrlfCount >= localLfCount ? '\r\n' : '\n')
      : (globalCrlfCount > globalLfCount ? '\r\n' : '\n');
    const alignedReplace = replace.replace(/\r\n/g, '\n').replace(/\n/g, newline);
    updated = updated.slice(0, match.start) + alignedReplace + updated.slice(match.end);
  }

  return {
    updated,
    count: matches.length,
    variant: normalizedFind,
    firstIndex: matches[0].start,
  };
}
