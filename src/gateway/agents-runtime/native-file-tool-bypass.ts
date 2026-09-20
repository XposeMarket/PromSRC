/** Keep bulk shell edits on the native file-tool path without blocking log appends. */
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
    /\b(writefile|writefilesync|appendfile|appendfilesync|set-content|out-file|new-item|remove-item|move-item|copy-item)\b/.test(lower);
  const hasShellRedirect =
    /(^|\s)(echo|printf|type|copy|set-content|out-file)\b[\s\S]*(>|>>|\|\s*(set-content|out-file)\b)/.test(lower);

  return (isInlineInterpreter && hasWriteApi) || hasShellRedirect;
}
