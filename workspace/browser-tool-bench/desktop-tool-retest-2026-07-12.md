# Desktop Tool Retest — 2026-07-12

## Goal
Retest the desktop-control path with emphasis on accurate interaction in the ChatGPT desktop app, including dense sidebar chat selection. This is a practical control test, not merely an API-latency test.

## Environment
- Target: ChatGPT desktop app (`ChatGPT`, native window token)
- Window bounds: 1720 × 1392 logical pixels
- Capture backend: `graphics_capture`
- App accessibility exposure: Chromium/Electron shell only; application content is custom-rendered and did not expose sidebar/chat controls through UIA.

## Measured observations

| Operation | Observed elapsed | Result |
|---|---:|---|
| `desktop_apps.list_windows` | 2.27s, then 1.60s | Exact ChatGPT window discovered correctly |
| `desktop_window.control(restore)` | 1.51s | Window restored correctly |
| `desktop_window.state(include_screenshot:true)` | 13.22s | Correct window, active, screenshot anchored; materially slower than June baseline |
| `desktop_window.region_screenshot` sidebar-sized crop | 2.66s | Fresh native crop produced |
| `desktop_window.accessibility_state` | 1.58s | Only 13 shell/chrome nodes; no chat rows or content controls |
| `desktop_window.text` | 1.99s | Conversation text extracted, but sidebar chat rows were not available as semantic targets |
| `desktop_window.key(Escape, verify:off)` | 1.67s | Focused document correctly reported |
| Broad-capture click attempt | 3ms rejection | Correctly blocked by `PRECISION_CAPTURE_REQUIRED`; no unsafe guessed click injected |

## Key finding
The system is presently safer than a blind coordinate click, but still not Codex-class computer use for Electron/custom-canvas apps:

1. A whole-window screenshot is rejected for precision clicking, correctly preventing the wrong-click failure.
2. Native region screenshots are available, but the current visible workflow cannot reliably identify an individual chat row when the app does not expose UIA semantics or readable OCR.
3. UIA is not a viable fallback for ChatGPT: it exposes the Electron/Chromium container, not the chat sidebar content.
4. State/capture latency is too high for iterative click navigation. The observed 13.22s state capture is a regression versus the June 2.11s baseline and makes coarse-to-fine control feel broken even where it is correct.

## Root causes to address
- **Target localization gap:** no robust grounded target finder for text inside graphical/custom-rendered desktop apps. The assistant must not infer rows from an unanchored full-window capture.
- **Capture cost:** full-window state screenshot is materially too slow. Dense-app action loops cannot spend seconds on every observe/verify phase.
- **Fallback gap:** UIA is treated as a primary semantic route, but many Electron apps expose only browser-shell chrome. Need a fast visual/OCR target path when semantic controls are absent.
- **No persistent visual anchors:** after a sidebar is observed, known rows and their crop-relative geometry should be retained briefly, invalidated on scroll/layout/window movement, and only clicked from a fresh crop.

## Required control contract
For a request such as “open the chat named X” in ChatGPT:

1. Resolve the exact window token once and retain it for the interaction sequence.
2. Capture only the sidebar at native resolution.
3. Run target localization/OCR against that crop, returning a bounding box and confidence for the requested title.
4. Click the center of that box in `coordinate_space:"capture"` using the same crop screenshot ID.
5. Verify the resulting main-pane header contains the requested chat title.
6. On low confidence, do not click a nearby row. Re-crop or report that target localization is unavailable.

This keeps the existing no-guess safety rule while making accurate desktop control actually possible.

## Engineering priorities
1. Add a low-latency native region capture + OCR/visual-text locator path, returning click-safe crop-relative bounds.
2. Make `desktop_window.state` avoid implicit full capture unless explicitly requested; retain a true non-observing active-window fast path.
3. Add short-TTL per-window capture/geometry cache and avoid re-focus when the exact target is already active.
4. Provide a high-level `desktop_window.find_and_act` contract that uses UIA first, then visual bounds/OCR, never guessed coordinates.
5. Add deterministic ChatGPT/Electron regression fixtures: visible chat-title selection, scrolling list selection, stale-crop rejection, and wrong-row prevention.

## Post-restart retest — after Codex changes

### Measured operations

| Operation | Observed elapsed | Result |
|---|---:|---|
| `desktop_apps.list_windows` | 2.28s | Exact ChatGPT window token resolved correctly |
| `desktop_window.state(include_screenshot:true)` | 3.49s | Focused the app and returned a fresh graphics-capture anchor; a substantial improvement over the earlier 13.22s state capture |
| Sidebar `region_screenshot` (510 × 1310) | 2.79–2.90s | Native, click-safe crop returned consistently |
| `desktop_window.accessibility_state` | 2.73s | Still only 11 Chromium/Electron shell nodes; no individual ChatGPT rows |
| `desktop_window.text` | 2.79s | Correctly extracted the currently open conversation, including its title and visible content |
| `locate_text` on a sidebar crop | 2.14–2.81s | Returned `VISUAL_TARGET_NOT_FOUND` rather than inventing a target |
| `click_text` on visible sidebar title | 23.59s | Located and issued a bounded click, then correctly returned `ACTION_NOT_CONFIRMED` after strict verification saw no local UI change |

### What improved

- **State capture latency materially improved:** 3.49s versus the prior 13.22s. It is still slower than the June 2.11s measurement, but no longer a catastrophic regression.
- **The precise-crop safety path works:** Sidebar-native crops return cleanly and can be used as capture-space anchors.
- **No wrong chat was opened:** The new visual click path did not fall back to a guessed neighboring coordinate. When it could not prove a state change, it failed closed.
- **Extraction is better than UIA:** `desktop_window.text` can read the active ChatGPT conversation even though accessibility exposes only the Chromium shell.

### Remaining blocker

The key Codex-level interaction requirement is **not yet passing**: a ChatGPT sidebar conversation title visible to the user cannot be reliably recognized as a separate click target from the native sidebar crop.

The observed behavior indicates one of two remaining issues in the new visual target path:

1. **Sidebar OCR / title localization is not seeing custom-rendered chat rows**, even at a native crop and a relaxed 0.50 confidence threshold; or
2. `click_text` can choose an imperfect visual match but strict verification lacks a ChatGPT-specific destination signal, so a successful row click is classified as a likely no-op.

Either way, the tool did the safe thing: it did not claim success and did not click an adjacent chat. The latency of the strict click path, however, is still unusable at ~23.6s.

### Updated verdict

The Codex changes appear to have fixed the worst full-state capture regression and preserved the important no-guess safety contract. The desktop stack is demonstrably more stable, but it is **not yet Codex-class for ChatGPT chat selection**. The next fix needs to be narrowly aimed at native-crop visual text detection and destination verification for custom Electron content. Once that is working, the same regression should pass in under roughly 5–7 seconds end-to-end, not 20+ seconds.

## Conclusion
The current system will now reliably stop rather than misclick when it cannot prove the target. That is an improvement, and state capture is much healthier after the Codex changes. But ChatGPT sidebar selection still fails the basic user-facing control test because the tool cannot yet ground individual conversation titles into a verified click target. 
