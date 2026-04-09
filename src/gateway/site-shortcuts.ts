/**
 * site-shortcuts.ts
 *
 * Persistent keyboard shortcut registry for websites.
 *
 * Stores known keyboard shortcuts keyed by hostname. When the browser opens
 * a URL, the matching shortcuts are injected into the tool result so the AI
 * knows how to interact efficiently without scrolling or hunting for DOM refs.
 *
 * The AI can also learn new shortcuts via save_site_shortcut() and they are
 * persisted for all future sessions.
 */

import fs from 'fs';
import path from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SiteShortcut {
  /** The key or key combination (e.g. "n", "Control+p", "g i") */
  key: string;
  /** Human-readable description of what this shortcut does */
  action: string;
  /** Optional: which page context this applies to */
  context?: string;
  /** If true, this shortcut should be used when the task involves composing/creating */
  preferred_for_compose?: boolean;
}

export interface SiteShortcutEntry {
  description: string;
  shortcuts: SiteShortcut[];
  /** Optional notes for the AI about how to use shortcuts on this site */
  notes?: string;
}

export type SiteShortcutsStore = Record<string, SiteShortcutEntry>;

// ─── Storage ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(
  process.env.PROMETHEUS_CONFIG_DIR
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.prometheus'),
  'site-shortcuts.json',
);

let _cache: SiteShortcutsStore | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30_000; // re-read from disk every 30s

function loadStore(): SiteShortcutsStore {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  try {
    if (fs.existsSync(CONFIG_DIR)) {
      const raw = fs.readFileSync(CONFIG_DIR, 'utf-8');
      _cache = JSON.parse(raw) as SiteShortcutsStore;
      _cacheTs = now;
      return _cache;
    }
  } catch {
    /* malformed JSON — fall through to empty store */
  }

  _cache = {};
  _cacheTs = now;
  return _cache;
}

function saveStore(store: SiteShortcutsStore): void {
  try {
    const dir = path.dirname(CONFIG_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_DIR, JSON.stringify(store, null, 2), 'utf-8');
    _cache = store;
    _cacheTs = Date.now();
  } catch (err: any) {
    console.error('[SiteShortcuts] Failed to save:', err.message);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Return the shortcut entry for a given hostname, or null if none known.
 * Strips www. prefix automatically.
 */
export function getShortcutsForHost(hostname: string): SiteShortcutEntry | null {
  const store = loadStore();
  const clean = hostname.replace(/^www\./, '').toLowerCase().trim();
  return store[clean] || null;
}

/**
 * Return the shortcut entry for a full URL.
 */
export function getShortcutsForUrl(url: string): SiteShortcutEntry | null {
  try {
    const { hostname } = new URL(url.startsWith('http') ? url : `https://${url}`);
    return getShortcutsForHost(hostname);
  } catch {
    return null;
  }
}

/**
 * Add or update a single shortcut for a hostname.
 * Creates the entry if it doesn't exist.
 * Safe to call from tool handlers.
 */
export function saveSiteShortcut(
  hostname: string,
  shortcut: SiteShortcut,
  siteDescription?: string,
  notes?: string,
): void {
  const store = loadStore();
  const clean = hostname.replace(/^www\./, '').toLowerCase().trim();

  if (!store[clean]) {
    store[clean] = {
      description: siteDescription || clean,
      shortcuts: [],
    };
  }

  if (notes) store[clean].notes = notes;
  if (siteDescription) store[clean].description = siteDescription;

  // Replace existing shortcut with same key, or append
  const idx = store[clean].shortcuts.findIndex(s => s.key === shortcut.key);
  if (idx >= 0) {
    store[clean].shortcuts[idx] = shortcut;
  } else {
    store[clean].shortcuts.push(shortcut);
  }

  saveStore(store);
}

/**
 * Format the shortcut entry for a URL as a compact block to inject into
 * browser tool results. Returns empty string if no shortcuts known.
 *
 * Example output:
 *   ⌨️ SITE SHORTCUTS FOR x.com:
 *     n → Open new tweet composer modal  ← USE THIS to compose tweets
 *     f → Focus search bar
 *     j/k → Navigate tweets
 *   NOTE: To compose a tweet, press 'n' from any page...
 */
export function formatShortcutsForUrl(url: string): string {
  const entry = getShortcutsForUrl(url);
  if (!entry || entry.shortcuts.length === 0) return '';

  try {
    const { hostname } = new URL(url.startsWith('http') ? url : `https://${url}`);
    const clean = hostname.replace(/^www\./, '');

    const lines: string[] = [`⌨️ SITE SHORTCUTS FOR ${clean}:`];

    for (const s of entry.shortcuts) {
      const composeFlag = s.preferred_for_compose ? '  ← USE THIS to compose/create' : '';
      const ctx = s.context ? ` (${s.context})` : '';
      lines.push(`  ${s.key} → ${s.action}${ctx}${composeFlag}`);
    }

    if (entry.notes) {
      lines.push(`NOTE: ${entry.notes}`);
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * List all known hostnames with shortcuts.
 */
export function listKnownHosts(): string[] {
  return Object.keys(loadStore());
}

/**
 * Return the full shortcuts store (all hosts).
 */
export function getAllShortcuts(): SiteShortcutsStore {
  return loadStore();
}

/**
 * Delete a single shortcut by hostname + key.
 */
export function deleteSiteShortcut(hostname: string, key: string): boolean {
  const store = loadStore();
  const clean = hostname.replace(/^www\./, '').toLowerCase().trim();
  if (!store[clean]) return false;
  const before = store[clean].shortcuts.length;
  store[clean].shortcuts = store[clean].shortcuts.filter(s => s.key !== key);
  if (store[clean].shortcuts.length === before) return false;
  // Remove entry entirely if no shortcuts left
  if (store[clean].shortcuts.length === 0) delete store[clean];
  saveStore(store);
  return true;
}

/**
 * Seed built-in default shortcuts for well-known sites.
 * Only writes shortcuts that don't already exist — safe to call on every startup.
 */
export function seedDefaultShortcuts(): void {
  const defaults: SiteShortcutsStore = {
    'x.com': {
      description: 'X (formerly Twitter)',
      notes: 'Shortcuts only work when NOT focused on a text input. j/k move focus one post at a time — press once per step, then call browser_get_focused_item to confirm position before acting.',
      shortcuts: [
        // ── Navigation — posts ─────────────────────────────────────────────────
        { key: '?', action: 'Show keyboard shortcut help modal', context: 'global' },
        { key: 'j', action: 'Next post (move keyboard focus down one post). First press = post #1.', context: 'feed/timeline' },
        { key: 'k', action: 'Previous post (move keyboard focus up one post)', context: 'feed/timeline' },
        { key: 'Space', action: 'Page down (scroll feed)', context: 'feed/timeline' },
        { key: '.', action: 'Load new posts at top of feed without full reload', context: 'feed/timeline' },

        // ── Navigation — pages ─────────────────────────────────────────────────
        { key: 'g h', action: 'Go to Home feed', context: 'global' },
        { key: 'g e', action: 'Go to Explore / search', context: 'global' },
        { key: 'g n', action: 'Go to Notifications', context: 'global' },
        { key: 'g r', action: 'Go to Mentions', context: 'global' },
        { key: 'g p', action: 'Go to your Profile page', context: 'global' },
        { key: 'g f', action: 'Go to Drafts', context: 'global' },
        { key: 'g t', action: 'Go to Scheduled posts', context: 'global' },
        { key: 'g l', action: 'Go to Likes page', context: 'global' },
        { key: 'g i', action: 'Go to Lists', context: 'global' },
        { key: 'g m', action: 'Go to Direct Messages', context: 'global' },
        { key: 'g g', action: 'Go to Grok', context: 'global' },
        { key: 'g s', action: 'Go to Settings', context: 'global' },
        { key: 'g b', action: 'Go to Bookmarks', context: 'global' },
        { key: 'g u', action: 'Go to a specific user profile (opens prompt)', context: 'global' },
        { key: 'g d', action: 'Open Display settings', context: 'global' },

        // ── Actions ────────────────────────────────────────────────────────────
        { key: 'n', action: 'New post — open composer modal', preferred_for_compose: true },
        { key: 'Control+Enter', action: 'Send / post the current post (submit composer)', context: 'composer' },
        { key: 'm', action: 'New Direct Message', context: 'global' },
        { key: '/', action: 'Focus the search box', context: 'global' },
        { key: 'l', action: 'Like the currently focused post' },
        { key: 'r', action: 'Reply to the currently focused post — opens reply composer' },
        { key: 't', action: 'Repost (retweet) the currently focused post' },
        { key: 's', action: 'Share the currently focused post' },
        { key: 'b', action: 'Bookmark the currently focused post' },
        { key: 'u', action: 'Mute the account of the currently focused post' },
        { key: 'x', action: 'Block the account of the currently focused post' },
        { key: 'Enter', action: 'Open post details for the currently focused post' },
        { key: 'o', action: 'Expand photo on the currently focused post' },
        { key: 'i', action: 'Open / close Messages dock' },

        // ── Media ──────────────────────────────────────────────────────────────
        { key: 'k', action: 'Pause / Play the selected video', context: 'media' },
        { key: 'Space', action: 'Pause / Play the selected video', context: 'media' },
        { key: 'm', action: 'Mute the selected video', context: 'media' },
        { key: 'a d', action: 'Go to Audio Dock', context: 'media' },
        { key: 'a Space', action: 'Play / Pause Audio Dock', context: 'media' },
        { key: 'a m', action: 'Mute / Unmute Audio Dock', context: 'media' },
      ],
    },

    'github.com': {
      description: 'GitHub',
      notes: 'Press ? on any page to see the full shortcut list for that view.',
      shortcuts: [
        { key: 'g c', action: 'Go to Code tab of current repo', context: 'repo' },
        { key: 'g i', action: 'Go to Issues tab of current repo', context: 'repo' },
        { key: 'g p', action: 'Go to Pull Requests tab of current repo', context: 'repo' },
        { key: 'g a', action: 'Go to Actions tab of current repo', context: 'repo' },
        { key: 'g w', action: 'Go to Wiki tab of current repo', context: 'repo' },
        { key: 't', action: 'Activate file finder / search files in repo', context: 'repo', preferred_for_compose: false },
        { key: 'l', action: 'Jump to a line number in file viewer', context: 'file view' },
        { key: 'w', action: 'Switch branch / tag in repo', context: 'repo' },
        { key: 'y', action: 'Expand URL to canonical permalink for file', context: 'file view' },
        { key: 's', action: 'Focus the search bar (site-wide)', context: 'global' },
        { key: '/', action: 'Focus the search bar (global)', context: 'global' },
        { key: '?', action: 'Show keyboard shortcuts modal for current page' },
      ],
    },

    'reddit.com': {
      description: 'Reddit',
      notes: 'Navigation shortcuts (j/k) move between posts one at a time on listing pages.',
      shortcuts: [
        { key: 'j', action: 'Next post (move focus down)', context: 'listing' },
        { key: 'k', action: 'Previous post (move focus up)', context: 'listing' },
        { key: 'Enter', action: 'Open focused post', context: 'listing' },
        { key: 'c', action: 'Expand comment thread on focused post', context: 'listing' },
        { key: 'a', action: 'Upvote focused post', context: 'listing' },
        { key: 'z', action: 'Downvote focused post', context: 'listing' },
        { key: 'h', action: 'Return to previous page / hide expanded post', context: 'listing' },
        { key: '?', action: 'Show keyboard shortcut help' },
      ],
    },

    'youtube.com': {
      description: 'YouTube',
      notes: 'Most shortcuts only work when the video player is focused (click on it first).',
      shortcuts: [
        { key: 'k', action: 'Play / Pause video', context: 'player' },
        { key: 'Space', action: 'Play / Pause video (when player focused)', context: 'player' },
        { key: 'j', action: 'Seek back 10 seconds', context: 'player' },
        { key: 'l', action: 'Seek forward 10 seconds', context: 'player' },
        { key: 'ArrowLeft', action: 'Seek back 5 seconds', context: 'player' },
        { key: 'ArrowRight', action: 'Seek forward 5 seconds', context: 'player' },
        { key: 'ArrowUp', action: 'Volume up', context: 'player' },
        { key: 'ArrowDown', action: 'Volume down', context: 'player' },
        { key: 'm', action: 'Toggle mute', context: 'player' },
        { key: 'f', action: 'Toggle fullscreen', context: 'player' },
        { key: 'c', action: 'Toggle closed captions', context: 'player' },
        { key: 't', action: 'Toggle theater mode', context: 'player' },
        { key: 'i', action: 'Toggle mini player', context: 'player' },
        { key: '/', action: 'Focus search box', context: 'global' },
      ],
    },
  };

  const store = loadStore();
  let changed = false;

  for (const [host, entry] of Object.entries(defaults)) {
    if (!store[host]) {
      store[host] = entry;
      changed = true;
      continue;
    }
    // Only add shortcuts that don't already exist (don't overwrite user edits)
    for (const shortcut of entry.shortcuts) {
      const exists = store[host].shortcuts.some(s => s.key === shortcut.key);
      if (!exists) {
        store[host].shortcuts.push(shortcut);
        changed = true;
      }
    }
    // Seed notes if not set
    if (!store[host].notes && entry.notes) {
      store[host].notes = entry.notes;
      changed = true;
    }
  }

  if (changed) saveStore(store);
}

/**
 * Invalidate the in-memory cache (call after external writes to the file).
 */
export function invalidateShortcutsCache(): void {
  _cache = null;
  _cacheTs = 0;
}
