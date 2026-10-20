
/**
 * browser-tools.ts - Browser Automation for Prometheus
 *
 * Strategy: use the Electron in-house browser by default in the desktop app.
 * The Prometheus-owned Chrome/CDP lane and the user's Chrome extension remain
 * available as explicit secondary targets.
 * Background agents, tasks, and team agents get isolated persistent profiles
 * and CDP ports derived from their stable owner identity.
 *
 * Snapshot: DOM-based element scraping (reliable across all Playwright versions).
 * No dependency on deprecated page.accessibility or page.ariaSnapshot APIs.
 */

import { OBSERVE_MODE_ENUM } from './observation.js';

// --- Tool Definitions (for Ollama) ---------------------------------------------

export function getBrowserToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser_session',
        description: 'Unified browser session/navigation wrapper. Use for health checks, profile target selection, opening URLs, tab management, and closing the browser lane.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['doctor', 'set_profile_target', 'open', 'list_tabs', 'select_tab', 'new_tab', 'close_tab', 'close', 'chrome_accounts'] },
            url: { type: 'string', description: 'URL for open/new_tab.' },
            target: { type: 'string', enum: ['inhouse', 'prometheus', 'user_chrome'], default: 'inhouse', description: 'Browser target for open/set_profile_target. On Electron desktop, omit this to use the embedded in-house browser. prometheus is the secondary Prometheus-owned Chrome/CDP lane; user_chrome is the paired real Chrome extension lane.' },
            profile: { type: 'string', enum: ['inhouse', 'prometheus', 'user_chrome'], description: 'Alias for target. Defaults to inhouse on Electron desktop.' },
            inhouse_profile: { type: 'string', description: 'Optional persistent in-app profile id. Main chat defaults to "main"; imported Chrome profiles use the id returned by the desktop profile settings.' },
            profile_directory: { type: 'string' },
            close_existing: { type: 'boolean' },
            index: { type: 'number', description: 'Tab index for select_tab/close_tab.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_observe',
        description: 'Unified browser observation wrapper. Use for snapshots, deltas, viewport screenshots, text/focus inspection, waits, and DOM element watches.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['snapshot', 'snapshot_delta', 'screenshot', 'page_text', 'focused_item', 'wait', 'element_watch'] },
            element: { type: 'string', description: 'Saved named element for page_text.' },
            element_name: { type: 'string' },
            query: { type: 'string', description: 'For page_text, return lines matching this text plus nearby context.' },
            max_chars: { type: 'number', description: 'For page_text, maximum returned characters. Default 6000.' },
            max_lines: { type: 'number', description: 'For page_text, maximum returned lines. Default 200.' },
            selector: { type: 'string', description: 'CSS selector for element_watch.' },
            wait_for: { type: 'string', enum: ['appear', 'disappear', 'text_contains'] },
            text: { type: 'string', description: 'Text for text_contains watches.' },
            timeout_ms: { type: 'number' },
            ms: { type: 'number', description: 'Milliseconds for wait.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_act',
        description: 'Unified browser interaction wrapper. Use for DOM, keyboard, upload, scroll, drag, download, and vision-coordinate actions. Final-action approval ids pass through unchanged.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['click', 'fill', 'type', 'key', 'press_key', 'upload_file', 'scroll', 'drag', 'click_and_download', 'vision_click', 'vision_type'] },
            ref: { type: 'number' },
            element: { type: 'string' },
            element_name: { type: 'string' },
            selector: { type: 'string' },
            text: { type: 'string' },
            key: { type: 'string' },
            hold_ms: { type: 'integer', minimum: 0, maximum: 5000, description: 'Native in-house key hold duration.' },
            keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' }, description: 'Native in-house key chord.' },
            sequence: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { key: { type: 'string' }, keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }, hold_ms: { type: 'integer', minimum: 0, maximum: 5000 }, wait_ms: { type: 'integer', minimum: 0, maximum: 5000 } } }, description: 'Native in-house sequence; max total requested duration 10 seconds.' },
            tab_id: { type: 'string', description: 'Optional active in-house tab id; rejects a stale or non-active tab.' },
            file_path: { type: 'string' },
            file_paths: { type: 'array', items: { type: 'string' } },
            direction: { type: 'string', enum: ['down', 'up'] },
            multiplier: { type: 'number' },
            from_ref: { type: 'number' },
            to_ref: { type: 'number' },
            from_x: { type: 'number' },
            from_y: { type: 'number' },
            to_x: { type: 'number' },
            to_y: { type: 'number' },
            x: { type: 'number' },
            y: { type: 'number' },
            button: { type: 'string', enum: ['left', 'right'] },
            steps: { type: 'number' },
            timeout_ms: { type: 'number' },
            filename_hint: { type: 'string' },
            output_dir: { type: 'string' },
            final_action_approval_id: { type: 'string' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM },
            capture_after: { type: 'boolean' },
            fast: { type: 'boolean', description: 'Alias for observe="none" on deterministic actions.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_extract',
        description: 'Unified browser extraction/diagnostics wrapper. scroll_collect performs schema-free text/feed collection. scroll_collect_structured (alias: scroll_collect_v2) repeatedly collects structured items and requires an inline schema, saved schema, or saved item root. Also supports JS fallback, network/console/a11y diagnostics, smoke tests, and Teach verification.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['scroll_collect', 'scroll_collect_structured', 'scroll_collect_v2', 'extract_structured', 'run_js', 'network', 'console', 'accessibility', 'smoke_test', 'teach_verify'],
              description: 'scroll_collect is schema-free text/feed collection. scroll_collect_structured and its scroll_collect_v2 alias require structured extraction fields plus a container selector/saved item root, or a saved schema.',
            },
            code: { type: 'string', description: 'JavaScript for run_js.' },
            schema: { type: 'object', description: 'Structured extraction schema.' },
            network_action: { type: 'string', enum: ['start', 'stop', 'read', 'clear'], description: 'Sub-action for action="network".' },
            console_action: { type: 'string', enum: ['read', 'clear'], description: 'Sub-action for action="console".' },
            url: { type: 'string', description: 'URL for smoke_test.' },
            wait_ms: { type: 'number' },
            max_console_entries: { type: 'number' },
            max_message_chars: { type: 'number', description: 'For console reads, maximum characters per message. Default 500.' },
            since_ts: { type: 'number', description: 'Only console entries at or after this epoch millisecond timestamp.' },
            page_only: { type: 'boolean', description: 'Scope console reads to the current page. Default true.' },
            max_a11y_results: { type: 'number' },
            steps: { type: 'array', items: { type: 'object' }, description: 'Optional click/fill/key/assertText/assertVisible smoke workflow.' },
            max_entries: { type: 'number' },
            include_bodies: { type: 'boolean', description: 'Opt in to text/JSON response bodies. Default false.' },
            body_max_chars: { type: 'number', description: 'Per-response body cap when enabled. Default 1000.' },
            status_min: { type: 'number' },
            status_max: { type: 'number' },
            max_results: { type: 'number' },
            url_filter: { type: 'string' },
            scrolls: { type: 'number' },
            direction: { type: 'string', enum: ['down', 'up'] },
            multiplier: { type: 'number' },
            delay_ms: { type: 'number' },
            stop_text: { type: 'string' },
            max_chars: { type: 'number' },
            include_initial: { type: 'boolean' },
            max_seconds: { type: 'number' },
            stop_after_no_new: { type: 'number' },
            include_snapshots: { type: 'boolean' },
            include_structured: { type: 'boolean' },
            schema_name: { type: 'string' },
            use_schema: { type: 'string' },
            item_root: { type: 'string' },
            root_name: { type: 'string' },
            container_name: { type: 'string' },
            container_selector: { type: 'string' },
            fields: { type: 'object' },
            dedupe_key: { type: 'string' },
            limit: { type: 'number' },
            max_scrolls: { type: 'number' },
            save_as: { type: 'string' },
            mode: { type: 'string', enum: ['full', 'safe', 'step'] },
            stop_before_step: { type: 'number' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_doctor',
        description:
          'Diagnose Prometheus browser automation health: Playwright availability, active session/profile state, CDP reachability, screenshot transport budget, and stale snapshot cache. Read-only except for a tiny screenshot probe.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_set_profile_target',
        description:
          'Main chat only: choose which browser lane future browser tools use. In the Electron desktop app the embedded in-house browser is the default. target="prometheus" selects the regular Prometheus-owned Chrome/CDP flow. target="inhouse" selects the embedded Electron browser. target="user_chrome" selects the paired Prometheus Personal Chrome extension and already-running real Chrome profile; it never uses port 9223 or requires Chrome to close. Subagents cannot use this and remain isolated.',
        parameters: {
          type: 'object',
          required: ['target'],
          properties: {
            target: { type: 'string', enum: ['inhouse', 'prometheus', 'user_chrome'], default: 'inhouse', description: 'inhouse = embedded Electron browser (desktop default); prometheus = regular Chrome/CDP profile; user_chrome = paired Personal Chrome extension.' },
            inhouse_profile: { type: 'string', description: 'Optional persistent in-app profile id. Use "main" for the Prometheus profile or an imported profile id from desktop Settings.' },
            profile_directory: { type: 'string', description: 'Optional Chrome profile directory inside User Data, such as "Default" or "Profile 1", used when launching user_chrome fresh.' },
            close_existing: { type: 'boolean', description: 'Close/recreate the current main browser session if it is using a different target. Default true.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description: 'Open a URL in a Prometheus browser lane. In the Electron desktop app this defaults to target="inhouse", the embedded persistent browser. Use target="prometheus" for the secondary Prometheus-owned Chrome/CDP profile. Use target="user_chrome" for the paired Personal Chrome extension controlling the already-running real Chrome profile; no debug port or Chrome restart is involved. Browser tools automatically operate on whichever lane was last opened. Always use browser_open first to establish a session. Default observe="screenshot"; request observe="snapshot" for DOM refs, or observe="compact"/"none" when speed matters.',
        parameters: {
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', description: 'Full URL to navigate to. For searches, build the search URL directly.' },
            target: { type: 'string', enum: ['inhouse', 'prometheus', 'user_chrome'], default: 'inhouse', description: 'Browser target. inhouse = embedded Electron in-app browser (default in the desktop app, persistent per-profile logins); prometheus = secondary Prometheus-owned Chrome/CDP; user_chrome = user Chrome. Main chat may use any; subagents may use prometheus (default isolated) or inhouse.' },
            profile: { type: 'string', enum: ['inhouse', 'prometheus', 'user_chrome'], description: 'Alias for target. Defaults to inhouse on Electron desktop.' },
            inhouse_profile: { type: 'string', description: 'Optional in-house browser profile id (an isolated, persistent login partition). Defaults to "main" for main chat and an isolated per-agent profile for subagents. Use "main" for the Prometheus profile, or choose an imported Chrome profile id from desktop Settings.' },
            profile_directory: { type: 'string', description: 'Optional Chrome profile directory inside User Data, such as "Default" or "Profile 1", used with target="user_chrome".' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for navigation.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description: 'Re-scan the current page and return an updated list of interactive elements with @ref numbers. ONLY call this when you do NOT already have a recent snapshot in context � do NOT call it twice in a row or immediately after another explicit observation unless you know the page changed. If you just received a snapshot, ACT on it immediately (browser_click or browser_fill) instead of re-snapping. Repeated snapshot calls without acting = stall loop.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: snapshot for explicit snapshot request.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_list_tabs',
        description: 'List tabs/pages in the current Prometheus-controlled browser context and identify the active tab.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_select_tab',
        description: 'Switch the active automation target to an existing browser tab by index from browser_list_tabs.',
        parameters: {
          type: 'object',
          required: ['index'],
          properties: { index: { type: 'number', description: 'Tab index from browser_list_tabs.' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_new_tab',
        description: 'Open a new tab in the current browser context and optionally navigate it to a URL.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'Optional URL to open in the new tab.' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close_tab',
        description: 'Close a browser tab by index, or the active tab if index is omitted.',
        parameters: {
          type: 'object',
          properties: { index: { type: 'number', description: 'Optional tab index from browser_list_tabs. Defaults to the active tab.' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Click a page element by its @ref number or by a saved named element for the current site. Use element when Teach mode has already saved names like "tweet composer" or "post button". Use observe="compact" for a small orientation summary, or observe="snapshot" when you need fresh refs. Do not reflexively call browser_snapshot again unless you specifically need a new @ref map after the UI changes.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: '@ref number from the most recent snapshot' },
            element: { type: 'string', description: 'Saved named element for the current site, such as "tweet composer" or "post button".' },
            selector: { type: 'string', description: 'CSS selector for a taught target when you have not promoted it to a saved named element yet.' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id from request_final_action_approval when this click triggers a final post/send/publish/purchase/delete/submit action. Forces a post-action observation that must be inspected before reporting completion.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for medium-risk clicks.' },
            capture_after: { type: 'boolean', description: 'Shortcut for observe="snapshot" after the click when you need fresh refs immediately.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill',
        description: 'Type text into an [INPUT] element by its @ref number or a saved named element for the current site. Use element when Teach mode has already saved names like "tweet composer" or "search box". Use observe="compact" for a small orientation summary, or observe="snapshot" when you need fresh refs. After filling, use browser_press_key with "Enter" to submit, or browser_click on the submit button unless the site-specific composer automation already handled it.',
        parameters: {
          type: 'object', required: ['text'],
          properties: {
            ref: { type: 'number', description: '@ref number of an [INPUT] element from the snapshot' },
            element: { type: 'string', description: 'Saved named element for the current site, such as "tweet composer" or "search box".' },
            selector: { type: 'string', description: 'CSS selector for a taught input target when you have not promoted it to a saved named element yet.' },
            text: { type: 'string', description: 'Text to type into the field' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for text input.' },
            capture_after: { type: 'boolean', description: 'Shortcut for observe="snapshot" after filling when you need fresh refs immediately.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_upload_file',
        description:
          'Upload one or more local workspace files into an <input type="file"> on the current page. ' +
          'Prefer selector when the site uses a hidden file input; use ref when the input is visible in the snapshot. ' +
          'file_path/file_paths may be absolute paths or workspace-relative paths like "downloads/image.png". ' +
          'After upload, confirm the preview with browser_vision_screenshot or request observe="snapshot" if you need fresh DOM refs in the tool result.',
        parameters: {
          type: 'object',
          properties: {
            ref: { type: 'number', description: '@ref number for a visible upload control or file input from the latest snapshot.' },
            selector: { type: 'string', description: 'CSS selector for the target file input, useful for hidden inputs.' },
            file_path: { type: 'string', description: 'Single workspace-relative or absolute file path to upload.' },
            file_paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple workspace-relative or absolute file paths to upload.',
            },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for upload preview confirmation.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press_key',
        description: 'Press a keyboard key. Use "Enter" to submit a form or search after filling an input. Use "Escape" to close a popup. Use "Tab" to move focus to the next field. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space' },
            hold_ms: { type: 'integer', minimum: 0, maximum: 5000, description: 'Optional native key hold duration in ms (in-house browser only).' },
            tab_id: { type: 'string', description: 'Optional active in-house tab id; reject stale/non-active tab.' },
            keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' }, description: 'Optional native chord (in-house browser only; up to four keys).' },
            sequence: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { key: { type: 'string' }, keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }, hold_ms: { type: 'integer', minimum: 0, maximum: 5000 }, wait_ms: { type: 'integer', minimum: 0, maximum: 5000 } } }, description: 'Bounded native input sequence (in-house browser only; max 10 seconds total).' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id from request_final_action_approval when this keypress triggers a final post/send/publish/purchase/delete/submit action. Forces a post-action observation that must be inspected before reporting completion.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for deterministic keypresses.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_key',
        description: 'Alias for browser_press_key. Press a keyboard key on the focused element.',
        parameters: {
          type: 'object', required: ['key'],
          properties: {
            key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, ArrowUp, Space, etc.' },
            tab_id: { type: 'string', description: 'Optional active in-house tab id; reject stale/non-active tab.' },
            hold_ms: { type: 'integer', minimum: 0, maximum: 5000, description: 'Optional native key hold duration in ms (in-house browser only).' },
            keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' }, description: 'Optional native chord (in-house browser only).' },
            sequence: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: { key: { type: 'string' }, keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } }, hold_ms: { type: 'integer', minimum: 0, maximum: 5000 }, wait_ms: { type: 'integer', minimum: 0, maximum: 5000 } } }, description: 'Bounded native input sequence (in-house browser only; max 10 seconds total).' },
            final_action_approval_id: { type: 'string', description: 'One-shot approval id from request_final_action_approval when this keypress triggers a final post/send/publish/purchase/delete/submit action. Forces a post-action observation that must be inspected before reporting completion.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for deterministic keypresses.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description:
          'Type text into the currently focused element by sending raw keystrokes. ' +
          'Use this for contenteditable elements (e.g. X/Twitter compose box, rich text editors) where browser_fill does not work. ' +
          'First click the target element to focus it, then call browser_type with the text.',
        parameters: {
          type: 'object', required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to type into the focused element.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Default: snapshot for raw typing so the changed focused element is visible.' },
            capture_after: { type: 'boolean', description: 'Shortcut for observe="snapshot" after typing when you need fresh refs immediately.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait',
        description: 'Wait for the page to settle. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary or observe="snapshot" for fresh DOM refs after the wait. Use this when: (1) a page just loaded but has few elements, (2) after a click that should open something but the snapshot looks unchanged, (3) waiting for search results or dynamic content to appear.',
        parameters: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait before snapping (500-8000, default 2000)' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for timing-only waits.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click_and_download',
        description:
          'Click an element by @ref and wait for the resulting browser download, then save it into the workspace. ' +
          'Use this for visible download buttons, image save links, and export controls when the download starts directly from a click. Returns a compact ack unless observe="snapshot".',
        parameters: {
          type: 'object',
          required: ['ref'],
          properties: {
            ref: { type: 'number', description: '@ref number for the download trigger from the latest snapshot.' },
            timeout_ms: { type: 'number', description: 'Max wait time in milliseconds (default 15000, max 120000).' },
            filename_hint: { type: 'string', description: 'Optional filename to prefer when the browser suggestion is missing or generic.' },
            output_dir: { type: 'string', description: 'Workspace-relative output directory for the saved file. Default: downloads/browser.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta after the click+download.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: 'Scroll the page by a multiple of the viewport height. Prefer this over browser_press_key(PageDown) on sites with infinite scroll or content virtualization. Use direction="down" with multiplier=1.75 on X/Twitter to reliably load new tweets past virtualization. Default multiplier=1.0. With observe="none" this returns only a tiny ack; use observe="compact" for a small orientation summary.',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction' },
            multiplier: { type: 'number', description: 'Viewport height multiplier. Use 1.75 for X/Twitter, 1.0 for most sites. Range: 0.5�4.0.' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for scrolling.' },
            capture_after: { type: 'boolean', description: 'Shortcut for observe="snapshot" after scrolling when you need newly visible refs immediately.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_collect',
        description:
          'Scroll multiple times and collect ALL visible text at each position � a single-call web scraping engine. ' +
          'Use this instead of repeated browser_scroll calls when you need to collect data from infinite scroll pages, ' +
          'search results, feeds, or any page with content that loads on scroll. ' +
          'Returns deduplicated text from all scroll positions in one response. ' +
          'When you have saved item roots or saved extraction schemas, prefer browser_scroll_collect_v2 for structured JSON items. ' +
          'Does NOT return a DOM snapshot � call browser_snapshot() afterward if you need to interact with elements. ' +
          'Example: browser_scroll_collect({scrolls: 10, multiplier: 1.75}) on X/Twitter to collect ~30-50 tweets at once.',
        parameters: {
          type: 'object',
          properties: {
            scrolls:    { type: 'number', description: 'Number of scroll iterations (1�30, default 5)' },
            direction:  { type: 'string', enum: ['down', 'up'], description: 'Scroll direction (default: down)' },
            multiplier: { type: 'number', description: 'Viewport height multiplier per scroll (0.5�4.0, default 1.5). Use 1.75 for X/Twitter.' },
            delay_ms:   { type: 'number', description: 'Wait between scrolls in ms for content to load (500�5000, default 1500)' },
            stop_text:  { type: 'string', description: 'Stop scrolling early when this text appears on page (e.g. "No more results")' },
            max_chars:  { type: 'number', description: 'Max total chars to collect (5000�100000, default 50000)' },
            include_initial: { type: 'boolean', description: 'Collect the current viewport before the first scroll (default true).' },
            max_seconds: { type: 'number', description: 'Overall time cap in seconds (5-180, default 45).' },
            stop_after_no_new: { type: 'number', description: 'Stop after this many consecutive scrolled passes add no new text (1-10, default 3).' },
            include_structured: { type: 'boolean', description: 'Run the generic browser extractor on each pass for X feeds, search results, articles, chat interfaces, and paragraph-heavy pages (default true).' },
            include_snapshots: { type: 'boolean', description: 'Capture compact DOM snapshot deltas between passes to show newly visible/removed elements (default true).' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for content collection.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_drag',
        description:
          'Drag within the browser viewport. Use from_ref/to_ref when draggable handles appear in the snapshot, or from_x/from_y/to_x/to_y when working from browser_vision_screenshot coordinates. Useful for sliders, drag-and-drop lists, map/canvas panning, and split-pane resizers. Returns a compact ack unless observe="snapshot".',
        parameters: {
          type: 'object',
          properties: {
            from_ref: { type: 'number', description: 'Optional start element @ref from the latest snapshot.' },
            to_ref: { type: 'number', description: 'Optional end element @ref from the latest snapshot.' },
            from_x: { type: 'number', description: 'Viewport start X when dragging by coordinates.' },
            from_y: { type: 'number', description: 'Viewport start Y when dragging by coordinates.' },
            to_x: { type: 'number', description: 'Viewport end X when dragging by coordinates.' },
            to_y: { type: 'number', description: 'Viewport end Y when dragging by coordinates.' },
            steps: { type: 'number', description: 'Interpolation steps for smoother dragging (default 20).' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for drag interactions.' },
            capture_after: { type: 'boolean', description: 'Shortcut for observe="snapshot" after dragging when you need fresh refs immediately.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll_collect_v2',
        description:
          'Structured infinite-scroll collector built on saved item roots and extraction schemas. ' +
          'Use item_root plus fields, or schema_name to reuse a saved extraction schema for the current site. ' +
          'Returns deduplicated JSON items with quality metadata, stop reason, and a scroll log. ' +
          'Use save_as to persist the active schema for future extraction and collection.',
        parameters: {
          type: 'object',
          properties: {
            schema_name: { type: 'string', description: 'Saved extraction schema for the current site, such as "tweet card schema".' },
            item_root: { type: 'string', description: 'Saved named item root for the current site, such as "tweet card" or "result row".' },
            container_selector: { type: 'string', description: 'Optional direct CSS selector for repeated items. Usually omit this and use item_root or schema_name.' },
            fields: { type: 'object', description: 'Field map for structured extraction. Example: { "text": { "selector": "[data-testid=\'tweetText\']" }, "link": { "selector": "a", "type": "href" } }' },
            dedupe_key: { type: 'string', description: 'Optional field name used to deduplicate items, such as "link" or "id".' },
            limit: { type: 'number', description: 'Max total items to return (default 50, max 500).' },
            max_scrolls: { type: 'number', description: 'Max scroll actions after the initial viewport pass (default 8, max 40).' },
            multiplier: { type: 'number', description: 'Viewport height multiplier per scroll (default 1.5).' },
            delay_ms: { type: 'number', description: 'Delay between scrolls in milliseconds (default 1200).' },
            max_seconds: { type: 'number', description: 'Overall time cap in seconds (default 30, max 180).' },
            stop_text: { type: 'string', description: 'Optional stop sentinel text that ends collection when found in page text.' },
            save_as: { type: 'string', description: 'Optional name to persist the active extraction schema for this site.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Close the browser tab when done.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_focused_item',
        description: 'Check which item currently has keyboard focus on the page. CRITICAL for keyboard navigation: after pressing j/k on X.com to navigate tweets, call this to find out which tweet number is currently focused, its author, and its text. Use this after EVERY j/k press so you can determine if you need more presses to reach the right tweet. Returns position (e.g. "Tweet #2 of 8 visible") and tweet content so you can confirm you are on the correct item before pressing like/reply/etc.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for read-only focus check.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_page_text',
        description: 'Extract ALL visible text from the current page, including content inside iframes. Use this when browser_snapshot shows very few elements (< 12) and the page likely has menus, product listings, or other content hidden in iframes (common with dispensary menus using Jane Technologies, Dutchie, or Leafly widgets) or script-rendered blocks. Returns raw page text + a list of any iframe URLs found so you can navigate to them directly with browser_open. If element is provided, resolves a saved named browser element for the current site and returns that element\'s text/details instead of the full page.',
        parameters: {
          type: 'object',
          properties: {
            element: { type: 'string', description: 'Optional saved named element for the current site, such as "tweet composer" or "post button".' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none for read-only text extraction.' },
          },
        },
      },
    },
    // - Vision fallback tools - injected only when VISION MODE is active ------------------
    {
      type: 'function',
      function: {
        name: 'browser_vision_screenshot',
        description:
          'Capture the current browser tab viewport as PNG (not full desktop). Use when DOM snapshot is sparse. ' +
          'The image is attached for vision-capable models � you choose browser_vision_click / browser_vision_type coordinates.',
        parameters: {
          type: 'object',
          properties: {
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none (tool IS the observation).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_click',
        description:
          'Click at viewport pixel coordinates (from browser_vision_screenshot / attached image). ' +
          'Use when DOM is sparse. After clicking, if snapshot element count recovers to > 10, prefer browser_click(@ref).',
        parameters: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate within the browser viewport' },
            y: { type: 'number', description: 'Pixel Y coordinate within the browser viewport' },
            button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button (default left)' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: screenshot for vision-based clicks.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_vision_type',
        description:
          'Click at pixel coordinates and type text. ' +
          'Use when VISION MODE is active and you need to type into a canvas/overlay input with no DOM ref. ' +
          'After typing, check the returned snapshot element count � if > 10, switch back to DOM mode.',
        parameters: {
          type: 'object',
          required: ['x', 'y', 'text'],
          properties: {
            x: { type: 'number', description: 'Pixel X coordinate to click before typing' },
            y: { type: 'number', description: 'Pixel Y coordinate to click before typing' },
            text: { type: 'string', description: 'Text to type after clicking' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: delta for vision typing.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_send_to_telegram',
        description:
          'Capture the current browser tab as a screenshot and send it to the user via Telegram. ' +
          'Use this to share what the browser is currently showing � search results, tweets, articles, dashboards, etc. ' +
          'Takes a fresh screenshot of the visible viewport (not full page) and sends it as a photo with caption.',
        parameters: {
          type: 'object',
          properties: {
            caption: { type: 'string', description: 'Caption for the screenshot (default: "Browser screenshot")' },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Use "compact" for a small orientation summary. Default: none (side-effect only).' },
          },
        },
      },
    },
    // - NEW POWER TOOLS ----------------------------------------------------------
    {
      type: 'function',
      function: {
        name: 'browser_run_js',
        description:
          'Execute arbitrary JavaScript in the current page context and return the result. ' +
          'Expression-only probes and top-level await are supported, so `document.title`, `({title: document.title})`, and explicit `return ...` all work. Use this to: read React/Vue component state, trigger programmatic events, ' +
          'inspect hidden variables, extract data not visible in the DOM, run browser APIs. ' +
          'Return value is JSON-serialized. Example: `return document.cookie` or `return window.__STORE__.getState()`. ' +
          'WARNING: treat this as a fallback tool. Prefer browser_snapshot/browser_vision_screenshot + browser_click/browser_fill first, and only use browser_run_js when visual/DOM refs are insufficient. ' +
          'Only use for inspection/read-only operations unless you intentionally want to modify page state.',
        parameters: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript to execute in the page. Top-level await works. Return a value with `return expr`. Example: `return document.title`',
            },
            observe: { type: 'string', enum: OBSERVE_MODE_ENUM, description: 'Observation mode after this action. Overrides system default. Default: screenshot because JS can mutate page state.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_intercept_network',
        description:
          'Hook into the Playwright network layer to capture XHR/fetch responses. ' +
          'Call with action="start" before navigating/clicking, then action="read" to inspect what APIs returned. ' +
          'JSON and text response bodies are captured. Binary/image responses are skipped. ' +
          'Use to: inspect what an API returned, find hidden data endpoints, debug what data is loading. ' +
          'action="start" begins capturing; action="stop" removes the listener; action="read" dumps the log; action="clear" wipes it.',
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'stop', 'read', 'clear'],
              description: '"start" = begin capturing, "stop" = remove listener, "read" = show captured entries, "clear" = wipe log',
            },
            url_filter: {
              type: 'string',
              description: 'Optional substring to filter URLs (e.g. "/api/" to capture only API calls). Applied in both start and read.',
            },
            max_entries: {
              type: 'number',
              description: 'Max responses to buffer (default 200, max 500).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'inspect_console',
        description:
          'Inspect browser console health for the current page. Returns controller-side Playwright console/pageerror events, including page parse errors caught before in-page scripts initialize, plus lightweight in-page error/rejection diagnostics.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['read', 'clear'], description: 'read returns captured entries; clear empties the collector. Default read.' },
            max_entries: { type: 'number', description: 'Maximum console entries to return. Default 100.' },
            since_ts: { type: 'number' },
            page_only: { type: 'boolean', description: 'Default true.' },
            url_filter: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_accessibility_check',
        description:
          'Run a lightweight browser accessibility sanity check on the current page: title, lang, images without alt, unlabeled controls, duplicate ids, invalid links, heading order, and low semantic landmarks.',
        parameters: {
          type: 'object',
          properties: {
            max_results: { type: 'number', description: 'Maximum findings to return. Default 100.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_smoke_test',
        description:
          'Open a URL, wait for it to settle, capture a snapshot, inspect console errors, and run the accessibility sanity check in one typed workflow.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL to test, including localhost URLs.' },
            wait_ms: { type: 'number', description: 'Milliseconds to wait after navigation. Default 1500.' },
            max_console_entries: { type: 'number', description: 'Maximum console entries to include. Default 50.' },
            max_a11y_results: { type: 'number', description: 'Maximum accessibility findings. Default 50.' },
            steps: { type: 'array', items: { type: 'object' }, description: 'Optional click/fill/key/assertText/assertVisible smoke workflow.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_element_watch',
        description:
          'Wait until a DOM element appears, disappears, or contains specific text � without burning tokens on repeated snapshots. ' +
          'Uses Playwright\'s native waitForSelector for appear/disappear (efficient, no polling overhead). ' +
          'Use instead of browser_wait + browser_snapshot loops when you know exactly what you\'re waiting for. ' +
          'Returns a fresh snapshot when the condition is met.',
        parameters: {
          type: 'object',
          required: ['selector', 'wait_for'],
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to watch (e.g. ".result-list", "#submit-btn", "[data-testid=\'chat-bubble\']")',
            },
            wait_for: {
              type: 'string',
              enum: ['appear', 'disappear', 'text_contains'],
              description: '"appear" = wait until visible, "disappear" = wait until hidden/removed, "text_contains" = wait until element text includes the "text" param',
            },
            text: {
              type: 'string',
              description: 'Required when wait_for="text_contains". The substring to look for inside the element.',
            },
            timeout_ms: {
              type: 'number',
              description: 'Max wait in ms (default 15000, max 120000).',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot_delta',
        description:
          'Re-scan the page and return ONLY what changed since the last snapshot. ' +
          'Shows added elements, removed elements, and page title/URL changes. ' +
          'Use this instead of browser_snapshot on SPAs and heavy pages to reduce token usage by 60�80%. ' +
          'If no previous snapshot exists, returns a full snapshot. ' +
          'PREFER over browser_snapshot when you already have a snapshot in context and just want to see what changed after an action.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_extract_structured',
        description:
          'Extract structured JSON data from the page using a CSS-schema. ' +
          'Define a container_selector, use item_root to reference a saved named item root, or use schema_name to reuse a saved extraction schema for the current site. Then define fields (each with a CSS selector and extraction type). ' +
          'Returns a JSON array of objects � one per container match. ' +
          'Use this to scrape product listings, search results, tables, social posts, etc. in one call instead of parsing page text. ' +
          'Field type options: "text" (default, innerText), "href" (link href), "src" (img src), "attr" (any attribute), "html" (innerHTML). Use save_as to persist the active schema.',
        parameters: {
          type: 'object',
          required: ['schema'],
          properties: {
            schema: {
              type: 'object',
              description:
                'Extraction schema. Example: { "container_selector": ".product", "limit": 20, "fields": { "name": { "selector": "h2" }, "price": { "selector": ".price" }, "link": { "selector": "a", "type": "href" } } } or { "item_root": "tweet card", "fields": { "text": { "selector": "[data-testid=\'tweetText\']" } }, "save_as": "tweet card schema" } or { "schema_name": "tweet card schema" }',
              properties: {
                schema_name: { type: 'string', description: 'Saved extraction schema for the current site.' },
                container_selector: { type: 'string', description: 'CSS selector for the repeated container element' },
                item_root: { type: 'string', description: 'Saved named item root for the current site, such as "tweet card" or "result row".' },
                limit: { type: 'number', description: 'Max items to return (default 50, max 500)' },
                dedupe_key: { type: 'string', description: 'Optional field name to use for deduping when this schema is later reused for scroll collection.' },
                save_as: { type: 'string', description: 'Optional name to persist this extraction schema for the current site.' },
                fields: {
                  type: 'object',
                  description: 'Map of field name ? { selector: string, type?: "text"|"href"|"src"|"attr"|"html", attribute?: string }',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      selector: { type: 'string' },
                      type: { type: 'string', enum: ['text', 'href', 'src', 'attr', 'html'] },
                      attribute: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_teach_verify',
        description:
          'Replay the current Teach-mode workflow in a detached verifier browser tab that shares the current login/session state but does not disturb the visible browser canvas. ' +
          'Use this only after the user explicitly approves verification. ' +
          'mode="full" runs the full recorded workflow. mode="safe" stops before the final risky step if one exists. stop_before_step lets you stop before a specific 1-based recorded step number. ' +
          'Returns a step-by-step verification summary, the stopping boundary, any failure, and the final page.',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['full', 'safe', 'step'],
              description: 'Verification boundary mode. Use "safe" to stop before the final risky step, or "step" with stop_before_step to choose the boundary explicitly.',
            },
            stop_before_step: {
              type: 'number',
              description: 'Optional 1-based recorded step index to stop before. Example: 6 means replay steps 1-5 only.',
            },
          },
        },
      },
    },
  ];
}
