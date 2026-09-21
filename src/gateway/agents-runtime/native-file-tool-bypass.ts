/** Keep bulk shell edits on the native file-tool path without blocking log appends. */

/**
 * Stream-merge redirects such as `2>&1`, `1>&2`, or PowerShell `*>&1` contain a
 * `>` but never write a file. Strip them before looking for real output
 * redirects so read-only commands are not mistaken for file edits.
 */
function stripStreamMergeRedirects(value: string): string {
  return value.replace(/(?:\d+|\*)?>&(?:\d+|\*)/g, ' ');
}

/**
 * Split a command line into independently executed segments. A redirect only
 * counts as a file edit when it appears in the same segment as the writing
 * command, so `echo "marker"; git log ... 2>&1` stays read-only. Pipes are not
 * split on, because `echo x | Out-File y` is a genuine write.
 */
function splitCommandSegments(value: string): string[] {
  return value.split(/;|\r?\n|&&|\|\|/g);
}

export function looksLikeNativeFileToolBypass(command: string): boolean {
  const raw = String(command || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  // Add-Content is routinely used to append a single log entry. Treat it as
  // shell work even when the value is supplied through a PowerShell here-string.
  const isInlineInterpreter =
    /^(python|python3|py|node)\s+(-c|-e|<<|@')\b/.test(lower)
    || /^(powershell|pwsh)\b.*\b(command|encodedcommand|set-content|out-file|new-item|remove-item|move-item|copy-item)\b/.test(lower);
  const hasWriteApi =
    /\b(writefile|writefilesync|appendfile|appendfilesync|set-content|out-file|new-item|remove-item|move-item|copy-item)\b/.test(lower)
    // Python-style writes: open('x','w').write(...) / .writelines(...)
    || /\bopen\s*\([^)]*['"][wa]\+?b?['"]/.test(lower)
    || /\.writelines\s*\(/.test(lower);
  const hasShellRedirect = splitCommandSegments(lower)
    .map(stripStreamMergeRedirects)
    .some((segment) => /(^|\s)(echo|printf|type|copy|set-content|out-file)\b[\s\S]*(>|\|\s*(set-content|out-file)\b)/.test(segment));

  return (isInlineInterpreter && hasWriteApi) || hasShellRedirect;
}
