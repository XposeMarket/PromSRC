# Browser + Desktop Tool Latency Benchmark — 2026-06-28

## Scope

Raul asked to exercise browser tools, use the internal stopwatch/timer telemetry, identify slowest/heaviest tools, and find ways to make browser/desktop operation faster.

Timing source: model-facing `[TOOL_STOPWATCH] elapsed_ms=...` lines from each tool result.

## Summary Stats

### Browser tools

- Sample count: 53 calls
- Average: 2.95s
- Median: 1.83s
- P90: 7.74s
- Min: 34ms (`browser_close`)
- Max: 17.25s (`browser_open` YouTube)

### Desktop tools

- Sample count: 12 calls
- Average: 2.33s
- Median: 1.98s
- P90: 5.16s
- Min: 497ms (`desktop_get_window_text`)
- Max: 5.18s (`desktop_window_scroll` with verification/no-op)

## Slowest Browser Calls Observed

| Tool / scenario | Elapsed |
|---|---:|
| `browser_open` YouTube compact | 17.25s |
| `browser_open` Walmart compact | 10.27s |
| `browser_open` Vercel compact | 9.93s |
| `browser_open` X compact | 8.21s |
| `browser_open` Reddit compact | 8.00s |
| `browser_smoke_test` example.com | 7.35s |
| `browser_open` Amazon compact | 7.07s |
| `browser_open` malformed file URL failure | 6.12s |
| `browser_new_tab` GitHub | 4.99s |
| `browser_snapshot` GitHub error | 4.62s |
| `browser_scroll_collect` X, 3 scrolls, 25 items | 3.65s |

## Fastest Browser Calls Observed

| Tool / scenario | Elapsed |
|---|---:|
| `browser_close` | 34–42ms |
| `browser_get_page_text` local fixture | 885ms |
| `browser_snapshot_delta` local fixture | 891ms |
| `browser_extract_structured` local fixture | 898ms |
| `browser_scroll_collect_v2` saved schema local fixture | 907ms |
| `browser_scroll_collect` local fixture | 912ms |
| `browser_list_tabs` | 919ms |
| `browser_element_watch` delayed element | 932ms |
| `browser_intercept_network read` | 948ms |
| `browser_get_focused_item` local fixture | 963ms |

## Tool Coverage

Safe browser tools exercised:

- Session/navigation: `browser_doctor`, `browser_open`, `browser_close`, `browser_list_tabs`, `browser_new_tab`, `browser_select_tab`, `browser_close_tab`
- DOM/vision observation: `browser_snapshot`, `browser_snapshot_delta`, `browser_vision_screenshot`
- Interaction: `browser_click`, `browser_fill`, `browser_type`, `browser_press_key`, `browser_key`, `browser_vision_click`, `browser_vision_type`, `browser_drag`, `browser_scroll`, `browser_upload_file`, `browser_click_and_download`
- Extraction/collection: `browser_get_page_text`, `browser_extract_structured`, `browser_scroll_collect`, `browser_scroll_collect_v2`, `browser_get_focused_item`
- Diagnostics/QA: `browser_run_js`, `browser_intercept_network`, `inspect_console`, `run_accessibility_check`, `browser_smoke_test`, `browser_element_watch`, `browser_wait`

Not intentionally exercised:

- `browser_set_profile_target`: mutates the active target/profile and could disrupt the session; use only when explicitly changing target.
- `browser_teach_verify`: requires an active Teach-mode workflow; not applicable here.
- `save_site_shortcut`: only should be used after discovering a real shortcut worth saving.
- High-impact final-action approval path: no posting, buying, deleting, sending, or submitting was performed.

## Desktop Coverage

Desktop tools sampled for comparison:

- `desktop_doctor`: 3.04s
- `desktop_screenshot`: 2.84s
- `desktop_get_window_text`: 497ms
- `desktop_window_screenshot`: 2.06s
- `desktop_get_monitors`: 638ms
- `desktop_list_windows`: 620ms
- `desktop_get_accessibility_tree`: 1.04s
- `desktop_window_press_key`: 1.82s
- `desktop_window_type`: 3.16s
- `desktop_window_click` with verification: 5.12s
- `desktop_window_scroll` with verification/no-op: 5.18s

## Findings

1. Page navigation is by far the heaviest browser category.
   - Real JS-heavy sites cost 7–17s just to open, even with compact observation.
   - YouTube was worst in this pass at 17.25s.

2. Full composed workflows hide multiple internal calls.
   - `browser_smoke_test` took 7.35s because it bundles open + wait + snapshot + console + accessibility.
   - Good for QA, bad for quick interaction.

3. DOM action tools are surprisingly expensive.
   - `browser_click`, `browser_fill`, `browser_press_key`, and `browser_type` commonly landed around 2.3–3.0s.
   - Even `observe:"none"` did not make clicks/keys truly sub-second, which points to fixed overhead in the browser tool wrapper/CDP/session plumbing rather than only observation size.

4. Lightweight read/extract tools are already decent.
   - `browser_get_page_text`, `browser_extract_structured`, `browser_snapshot_delta`, and network read/start were mostly under 1s on simple pages.

5. X-specific collection is efficient relative to output size.
   - `browser_scroll_collect` on X gathered 25 structured tweet items across 3 scrolls in 3.65s. That is much faster than manual scroll/snapshot loops.

6. Desktop actions have the same pattern: verification is expensive.
   - Raw information calls like `desktop_get_window_text`, `desktop_list_windows`, and `desktop_get_monitors` were sub-second.
   - Verified click/scroll cost about 5.1s because verification performs screen-change checks.

7. Browser tool local HTTP fixture failed because the Python server returned `ERR_EMPTY_RESPONSE`; the workflow recovered by injecting the fixture into `example.com` via `browser_run_js`.
   - This was useful because `browser_run_js` itself measured at 921ms and enabled safe tests for upload/download/drag/extraction.

## Recommendations to Speed This Up

### Agent behavior changes we can use immediately

1. Prefer `observe:"none"` or `observe:"compact"` for deterministic clicks/keys, and only request full snapshots when refs are needed.
2. Prefer `browser_snapshot_delta()` over `browser_snapshot()` after an existing snapshot.
3. Prefer `browser_scroll_collect()` or `browser_scroll_collect_v2()` over repeated `browser_scroll` + `browser_snapshot` loops.
4. Prefer `browser_get_page_text()` / `browser_extract_structured()` for page reading instead of visual screenshots when text/DOM is enough.
5. Avoid `browser_smoke_test()` during normal operation. Use it only for actual QA because it intentionally runs several heavy checks.
6. Keep the browser session warm and avoid unnecessary `browser_open()` calls. Navigating to new heavy sites dominates latency.
7. For desktop, turn verification off for safe/obvious clicks if speed matters, but leave verification on for ambiguous or high-impact UI actions.
8. Use desktop text/UIA calls before screenshots when reading text-only app state; they are much cheaper.

### Product/source improvements worth considering

1. Add a low-latency action mode for `browser_click`, `browser_fill`, `browser_press_key`, and `browser_type` that skips post-action page metadata probes unless `observe` requires them.
2. Cache DOM snapshots/interactive element maps more aggressively and allow actions by stable selector/ref without rescanning when the page has not changed.
3. Split navigation timing into sub-metrics: browser attach, page.goto, settle wait, snapshot scan, screenshot capture, serialization/token payload.
4. Add a `browser_batch_actions` tool for sequences like click + type + key + compact result in one CDP round trip.
5. Add a persistent local benchmark fixture route served by Prometheus itself so upload/download/drag/regression tests do not depend on ad-hoc Python servers or external websites.
6. Add a “fast desktop click/scroll” default path for non-risky tasks that skips strict visual verification and returns only a compact ack.
7. Add result-size caps/summaries for heavy collection tools by default, with full raw output saved to a file instead of injected into model context.
8. Investigate why `observe:"none"` clicks still cost ~3s. That looks like fixed orchestration overhead and is the biggest win after navigation.

## Bottom Line

Browser navigation is the real heavyweight: 7–17s on major modern sites. Once a page is loaded, fast read/extract tools can run around 0.9–1.3s, but individual action tools still cost ~2–3s even with minimal observation. The biggest practical speedups are fewer navigations, fewer full snapshots, using collection/extraction tools instead of manual loops, and source-level fast paths/batched actions for common browser and desktop interactions.
