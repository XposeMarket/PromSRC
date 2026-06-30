# Top 20 Slow Tool Retest — 2026-06-29 current

Raul asked to rerun the previously slowest 20 tool cases after a gateway restart interrupted the first retest. These are model-facing `[TOOL_STOPWATCH] elapsed_ms` values from the current run in this chat. Where an exact old scenario was unsafe/noisy, the closest equivalent scenario is noted.

## Results

| Rank now | Tool/action | Current elapsed | Previous elapsed | Delta | Scenario/notes |
|---:|---|---:|---:|---:|---|
| 1 | `web_search` TinyFish timeout | 34.81s | 56.94s | -22.13s faster | Single-provider TinyFish query still timed out, but timeout returned sooner. |
| 2 | `connector_list` | 4.04s | 6.51s | -2.47s faster | Connector inventory. |
| 3 | `browser_extract smoke_test` | 3.51s | 7.52s | -4.01s faster | `https://example.com`, wait 1000ms. Includes open/snapshot/console/accessibility. |
| 4 | `desktop_screen doctor` | 3.33s | 6.47s | -3.14s faster | Full desktop readiness check. |
| 5 | `desktop_window scroll` | 2.91s | 4.13s | -1.22s faster | Chrome scroll, verify off. Warning: call accidentally carried `modifier:"shift"`; this repeats the prior schema footgun class. |
| 6 | `browser_observe screenshot` | 2.48s | 3.90s | -1.42s faster | Viewport screenshot on example.com. |
| 7 | `desktop_screen screenshot` | 2.49s | 4.43s | -1.94s faster | Primary monitor screenshot. |
| 8 | `desktop_window click` | 2.45s | 4.34s | -1.89s faster | Chrome local coordinate click, verify off. Warning: call accidentally carried `modifier:"shift"`; schema/default ergonomics still risky. |
| 9 | `browser_session open` example.com with snapshot | 1.78s | 4.23s | -2.45s faster | Re-opened example.com and requested snapshot. |
| 10 | `browser_session open` example.com no observe | 1.44s cold / 65ms warm | 4.23s | much faster | Cold open after browser category activation was 1.44s; same URL warm open was 65ms. |
| 11 | `browser_observe snapshot` | 1.22s | 2.57s | -1.35s faster | Snapshot on example.com. |
| 12 | `browser_extract accessibility` | 1.01s | 23.99s | -22.98s faster | Accessibility on simple example.com now much faster. Prior case may have included heavier page/setup. |
| 13 | `browser_extract console` | 950ms | 1.99s | -1.04s faster | Console read on example.com. |
| 14 | `workspace_git status` | 935ms | 1.48s | -545ms faster | `git status --short --branch`. |
| 15 | `workspace_git diff --stat` | 506ms | 1.32s | -814ms faster | `git diff --stat`. |
| 16 | `workspace_run run` simple Node command | 333ms | 14.89s | -14.56s faster | `node -e "console.log('bench')"`; prior result was likely cold-path/supervisor startup. |
| 17 | `memory_search` quick query | 59ms | 17.04s | -16.98s faster | Quick hash fast path triggered; FTS phase 29ms. Huge improvement. |
| 18 | `browser_act click` | 79ms | 2.13s | -2.05s faster | Clicked `h1` with `observe:"none"`; confirms browser fast path is working. |
| 19 | `browser_act scroll` | 7ms | 1.23s | -1.22s faster | Scroll with `observe:"none"`. |
| 20 | `browser_act key` | 6ms | 1.52s | -1.51s faster | Escape with `observe:"none"`. |
| extra | `browser_session open` malformed/missing file URL | 26ms failed fast | 7.44s | -7.41s faster | Missing file URL now errors almost immediately instead of hanging. |

## Takeaways

- The gateway restart likely happened during the previous long retest, not because of the benchmark itself. The retest has now completed.
- Most previously slow tools are dramatically faster now.
- Biggest wins: `memory_search`, browser actions with `observe:"none"`, malformed file URL handling, `workspace_run`, and browser accessibility diagnostics.
- Remaining slowest practical tools: `web_search` provider timeout, connector inventory, desktop doctor/screenshot/click/scroll, and browser smoke tests.
- Desktop mouse calls still carry a modifier-footgun risk. In this retest I accidentally sent `modifier:"shift"` because the wrapper schema default/options make omission awkward. This validates the old benchmark note: desktop click/scroll need a clean `modifier:"none"` path and safer defaults.
