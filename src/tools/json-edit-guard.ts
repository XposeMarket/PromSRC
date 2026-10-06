/**
 * json-edit-guard.ts
 *
 * Line-based edit tools (replace_lines / insert_after / delete_lines / patchset
 * find_replace) are blind to file structure. A team agent corrupted a shared
 * pending.json this way (Teams Gauntlet, 2026-10-06). When a `.json` file
 * parses before the edit, refuse any edit that would leave it unparseable.
 * Files that were already invalid are left to the caller (no new guard).
 */
export function jsonEditGuardError(filePath: string, before: string, after: string): string | null {
  if (!/\.json$/i.test(String(filePath || ''))) return null;
  const strip = (s: string) => String(s ?? '').replace(/^\uFEFF/, '');
  try {
    JSON.parse(strip(before));
  } catch {
    return null;
  }
  try {
    JSON.parse(strip(after));
    return null;
  } catch (err: any) {
    return `Refusing edit: it would make ${filePath} invalid JSON (${String(err?.message || err)}). `
      + 'The file is unchanged. Re-read it and send an edit that keeps the JSON valid, '
      + 'or rewrite the whole document with write_file.';
  }
}
