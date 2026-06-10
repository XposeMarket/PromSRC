// ─── Platform dispatch for desktop automation ─────────────────────────────────
//
// Single entry point that replaces the scattered `ensureWindows()` guards. The
// public desktop_* functions in desktop-tools.ts call getPlatformDesktopBackend()
// and use the returned DesktopBackend instead of inline PowerShell.
//
// During Phase 0 the backend is assembled incrementally — see Win32Backend's
// STATUS block — so most public functions still call the inline implementations
// until each primitive is extracted. This dispatcher is wired in last, once a
// platform's backend covers every primitive it routes.

import type { DesktopBackend, DesktopPlatformId } from './desktop-backend.js';
import { DesktopUnsupportedError } from './desktop-backend.js';
import { Win32Backend } from './desktop-platform-win32.js';
import { DarwinBackend } from './desktop-platform-darwin.js';

const PLATFORM = process.platform as DesktopPlatformId;

let cached: DesktopBackend | null = null;

/** Returns the desktop backend for the current OS, or throws
 *  DesktopUnsupportedError on a platform with no backend yet. */
export function getPlatformDesktopBackend(): DesktopBackend {
  if (cached) return cached;
  switch (PLATFORM) {
    case 'win32':
      cached = new Win32Backend();
      return cached;
    case 'darwin':
      cached = new DarwinBackend();
      return cached;
    default:
      throw new DesktopUnsupportedError(
        PLATFORM,
        'desktop automation',
        'No desktop backend implemented for this platform.',
      );
  }
}

/** True if the current platform has a desktop backend at all. */
export function hasDesktopBackend(): boolean {
  return PLATFORM === 'win32' || PLATFORM === 'darwin';
}
