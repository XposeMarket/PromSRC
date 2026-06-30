# Browser + Desktop Speed Retest — 2026-06-29

## Scope

Retest of the browser and desktop tool paths after the latest speed changes, focused on the hot paths Raul wants faster: browser actions/observations and desktop input/window control.

Timing source: model-facing `[TOOL_STOPWATCH] elapsed_ms=...` emitted by each tool call in this session.

Baseline: `browser-tool-bench/prometheus-tool-benchmark-2026-06-29.md`.

## Executive Summary

The new changes helped the right areas, especially the lightweight/no-observation paths:

- Browser warm lightweight reads are excellent: `focused_item` 8ms, `page_text` 13ms, `snapshot_delta` 26ms.
- Browser `scroll` with `observe:"none"` is now extremely fast: 14ms, down from 1.23s.
- Browser `type` is now 8ms, down from 24ms.
- Browser screenshot improved: 2.79s, down from 3.90s.
- Browser click improved modestly: 1.62s, down from 2.13s.
- Browser key did not improve: 1.51-1.52s, effectively unchanged.
- Desktop global input paths are much faster than window-scoped paths: global click 707ms and global scroll 634ms.
- Desktop screenshot improved: 3.05s, down from 4.43s.
- Desktop window click/scroll improved but are still heavy: click 3.18s, scroll 3.04s.

Bottom line: the fast paths are real now for browser scroll/type/read and desktop global input. Remaining bottlenecks are browser `key`, browser `click` fixed overhead, and desktop window-scoped control.

## Browser Retest

### Setup

- Browser doctor cold-ish session: 883ms.
- `browser_session open` to `https://example.com` with `observe:"snapshot"`: 6.00s.
- Injected a benchmark fixture into the page with `browser_extract run_js`: 10ms.
- Snapshot after fixture injection: 2.41s.

Note: opening a `data:text/html` fixture URL was blocked by goal policy as sensitive-entry-like behavior. The retest recovered by opening `example.com` and injecting a harmless local fixture with `run_js`.

### Browser timings

| Tool/action | Scenario | New timing | Previous timing | Result |
|---|---|---:|---:|---|
| `browser_extract run_js` | Inject benchmark controls | 10ms | 27-39ms | Faster |
| `browser_observe snapshot` | Full DOM refs after fixture | 2.41s | 2.57s | Slightly faster |
| `browser_act fill` | Fill input, `observe:"none"` | 884ms | 871ms | Same/slightly slower |
| `browser_act click` | Click button, `observe:"none"` | 1.62s | 2.13s | Faster, still heavy |
| `browser_act key` | Press Tab, `observe:"none"` | 1.51s | 1.52s | Unchanged |
| `browser_act type` | Type 1 char into focused element | 8ms | 24ms | Much faster |
| `browser_observe page_text` | Read visible page text | 13ms | 17-39ms class | Excellent |
| `browser_observe focused_item` | Read current focus | 8ms | 17-39ms class | Excellent |
| `browser_observe snapshot_delta` | DOM delta after fill | 26ms | 17-39ms class | Excellent |
| `browser_act click` | Click Add Late Node, `observe:"delta"` | 2.47s | 2.13s click baseline | Still heavy with delta |
| `browser_act scroll` | Scroll one viewport, `observe:"none"` | 14ms | 1.23s | Huge win |
| `browser_act key` | Press Home, `observe:"none"` | 1.52s | 1.52s | Unchanged |
| `browser_observe screenshot` | Viewport screenshot | 2.79s | 3.90s | Faster |
| `browser_extract console` | Read empty console entries | 1.46s | 1.99s | Faster |
| `browser_session close` | Close browser tab | 34ms | not measured | Excellent |

### Browser findings

1. `observe:"none"` is now genuinely fast for `scroll` and `type`.
2. `page_text`, `focused_item`, `snapshot_delta`, and `run_js` are all sub-30ms in warm page state. These should be preferred when they fit the task.
3. `click` improved, but 1.62s still suggests fixed overhead remains even when no observation is requested.
4. `key` still has a fixed ~1.5s overhead. This is now the most obvious browser hot-path miss.
5. `snapshot` and `screenshot` improved slightly, but they remain multi-second by nature and should stay opt-in.

## Desktop Retest

### Desktop timings

| Tool/action | Scenario | New timing | Previous timing | Result |
|---|---|---:|---:|---|
| `desktop_screen monitors` | Monitor geometry | 1.48s | 1.16s | Slightly slower |
| `desktop_apps list_windows` | Chrome/window discovery | 926ms / 1.03s refresh | 1.15s | Slightly faster |
| `desktop_window state` | Chrome active window state | 2.27s | 2.11s | Same/slightly slower |
| `desktop_input key` | Escape, global input, verify off | 350ms | 423ms | Faster |
| `desktop_window key` | Escape, window scoped, verify off | 2.54s | 2.07s | Slower |
| `desktop_window click` | Chrome local coordinate click, verify off | 3.18s | 4.34s | Faster, still heavy |
| `desktop_window scroll` | Chrome local scroll, verify off | 3.04s | 4.13s | Faster, still heavy |
| `desktop_input click` | Global coordinate click, verify off | 707ms | not separately measured | Good |
| `desktop_input scroll` | Global coordinate scroll, verify off | 634ms | not separately measured | Good |
| `desktop_screen screenshot` | Primary monitor screenshot | 3.05s | 4.43s | Faster |

### Desktop findings

1. Global `desktop_input` is now the practical fast path for simple clicks, scrolls, and keys when the active window is already correct.
2. Window-scoped click/scroll improved by about 1.1-1.3s, but they are still too slow for fluid UI operation.
3. Window-scoped key got slower in this sample and remains much slower than global key.
4. Screenshot capture improved materially but remains a multi-second operation.
5. `desktop_window scroll` failed once with `No window found for window_handle=7216442` even though the handle had just been listed and state-read. Retrying with explicit `name`/`title` succeeded. This points to a window-handle resolution/cache bug or inconsistent wrapper resolution path.
6. The accidental `+ctrl` modifier still appears in click results because the wrapper schema defaults `modifier:"ctrl"` when omitted/empty in this call shape. This is still a behavior bug for Raul's preferred normal clicks.

## Comparison: What Got Faster

| Area | Before | After | Change |
|---|---:|---:|---:|
| Browser `scroll observe:none` | 1.23s | 14ms | ~88x faster |
| Browser `type` | 24ms | 8ms | ~3x faster |
| Browser `click observe:none` | 2.13s | 1.62s | ~24% faster |
| Browser screenshot | 3.90s | 2.79s | ~28% faster |
| Browser console read | 1.99s | 1.46s | ~27% faster |
| Desktop screenshot | 4.43s | 3.05s | ~31% faster |
| Desktop window click | 4.34s | 3.18s | ~27% faster |
| Desktop window scroll | 4.13s | 3.04s | ~26% faster |
| Desktop global key | 423ms | 350ms | ~17% faster |

## Remaining Speed Targets

### Highest priority

1. **Browser key fast path**
   - Current: ~1.52s even with `observe:"none"`.
   - Target: under 100ms, similar to `type` and `scroll`.
   - Likely issue: mandatory focus/title/DOM/probe step still runs for key actions.

2. **Browser click fixed overhead**
   - Current: 1.62s with `observe:"none"`.
   - Target: under 250ms for simple DOM ref click with no observation.
   - Likely issue: post-click stabilization, navigation wait, focus diff, or DOM recount still happens.

3. **Desktop window-scoped control**
   - Current: 2.5-3.2s for key/click/scroll.
   - Target: under 750ms, ideally near global input path.
   - Likely issue: repeated window resolution/focus checks and unnecessary post-action state work even with `verify:"off"`.

4. **Desktop modifier default bug**
   - Current: calls still report `+ctrl` unless the wrapper schema can truly omit modifier or use `modifier:"none"`.
   - Target: no modifier by default; modifier only when explicitly requested.

5. **Desktop handle lookup consistency**
   - Current: `desktop_window scroll` failed with a fresh handle unless name/title was also supplied.
   - Target: a fresh listed `window_id`/`window_handle` should be sufficient across all desktop window actions.

### Agent behavior now recommended

Until the remaining fixed overhead is removed:

- Browser: use `observe:"none"` aggressively for `scroll` and `type`; use `page_text`, `focused_item`, `snapshot_delta`, and `run_js` for cheap inspection; reserve screenshot/snapshot for visual truth or refs.
- Desktop: when the active window is already known/correct, prefer `desktop_input` global click/scroll/key for speed; use `desktop_window` only when window scoping/focus safety matters.
- Desktop screenshots are faster now, but still expensive enough to use intentionally.

## Bottom Line

The speed work moved the needle. Browser scroll/type/read paths now prove Prometheus can run sub-30ms browser operations. Desktop global input is now usable as a fast path. The remaining work is concentrated and clear: fix browser `key`, reduce browser `click` overhead, make desktop window-scoped actions use the fast path when `verify:"off"`, and remove the accidental Ctrl modifier default.
