/**
 * canvas-state.ts — Shared canvas session file tracking state
 *
 * Extracted from server-v2.ts (B2 refactor).
 * This singleton is imported by both canvas.router.ts and handleChat
 * so that both can read/write the same in-memory map.
 *
 * Maps sessionId -> ordered list of absolute file paths currently open in the canvas.
 * Updated automatically when AI creates/writes a file (canvas_present event)
 * and via POST /api/canvas/open when the user opens a file manually.
 */

export const sessionCanvasFiles: Map<string, string[]> = new Map();

export function addCanvasFile(sessionId: string, absPath: string): void {
  const sid = String(sessionId || 'default');
  const existing = sessionCanvasFiles.get(sid) || [];
  if (!existing.includes(absPath)) {
    existing.push(absPath);
    sessionCanvasFiles.set(sid, existing);
  }
}

export function removeCanvasFile(sessionId: string, absPath: string): void {
  const sid = String(sessionId || 'default');
  const existing = sessionCanvasFiles.get(sid) || [];
  sessionCanvasFiles.set(sid, existing.filter(p => p !== absPath));
}

export function getCanvasContextBlock(sessionId: string): string {
  const files = sessionCanvasFiles.get(String(sessionId || 'default')) || [];
  if (files.length === 0) return '';
  const list = files.map(f => `  • ${f}`).join('\n');
  return `[CANVAS — files currently open in the editor]\n${list}\nWhen reading or editing these files use the exact paths above.`;
}
