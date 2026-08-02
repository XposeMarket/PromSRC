# Full Prometheus Tool Benchmark — 2026-06-29

## Scope

Raul asked for a full Prometheus main-tool benchmark so we can see what is slow and start making browser, desktop, and file-related tools faster.

This pass benchmarked the model-facing `[TOOL_STOPWATCH] elapsed_ms=...` latency for the main safe tool surfaces available in this session:

- Workspace tools: `workspace_read`, `workspace_edit`, `workspace_run`, `workspace_git`, `workspace_safety`, `workspace_code_nav`
- Prometheus dev/source read tools: `dev_source_read`
- Browser wrappers: `browser_session`, `browser_observe`, `browser_act`, `browser_extract`
- Desktop wrappers: `desktop_screen`, `desktop_apps`, `desktop_window`, `desktop_input`, `desktop_background`
- Memory, notes, skills, timers, tasks, schedules, watches, dashboard, connectors, background agents, cards, business context

Skipped or represented by non-mutating equivalents:

- Destructive or external side-effect actions: git commit/push/PR, purchases/posts/sends/deletes, schedule mutation, connector mutation.
- `prometheus_source_write` / dev source edits: requires approval and should not be benchmarked by editing source just for timing.
- Restore/revert paths: benchmarked snapshot/preview/scan instead, because restore/revert would alter workspace state.
- Browser Teach/final-action approval: only relevant in a live final-action workflow.

Timing source: exact `[TOOL_STOPWATCH]` lines shown in tool observations.

## Executive Summary

### Fastest surfaces

| Surface | Observed timings | Notes |
|---|---:|---|
| Core state/list calls | 0-6ms | `schedule_job list`, `internal_watch list`, `timer list`, `business_context_mode`, `show_ui_card`, `write_note`, `memory_write` |
| Workspace reads | 3-16ms typical | `read`, `list`, `list_files`, `exists`, `stats`, `search`, `tree` are excellent |
| Workspace safety scans | 4-52ms | `scan_secrets`, `scan_large_files`, `snapshot` are fast on bounded paths |
| Dev source reads | 205-479ms | Healthy, predictable, and much cheaper than workspace-wide shell scans |
| Browser warm lightweight reads | 17-39ms | `page_text`, `focused_item`, `snapshot_delta`, `run_js` on warm page can be extremely fast |
| Workspace edits | 160-220ms typical | Most file mutation actions are solid |

### Slowest surfaces

| Surface / scenario | Elapsed | Finding |
|---|---:|---|
| `web_search` TinyFish timeout | 56.94s | Needs tighter provider timeout/fallback path |
| `browser_extract accessibility` | 23.99s | Axe/accessibility checks are heavy; use only for QA |
| `memory_search` quick query | 17.04s | SQLite FTS phase dominated the query |
| `workspace_run run` simple Node command | 14.89s | Major cold-start/supervisor outlier; later run helpers were 0.35-0.67s |
| `browser_extract smoke_test` | 7.52s | Bundled open + snapshot + console + a11y, expected heavy |
| `browser_session open` malformed file URL | 7.44s | Failed slowly after URL normalization issue |
| `desktop_screen doctor` | 6.47s | Does many checks; not for normal operation |
| `connector_list` | 6.51s | Connector inventory has meaningful fixed overhead |
| `desktop_window click/scroll` | 4.13-4.34s | Visible desktop actions remain expensive |
| `desktop_screen screenshot` | 4.43s | Full monitor capture is heavy |

## Workspace Tool Benchmarks

### `workspace_read`

| Action | Scenario | Elapsed |
|---|---|---:|
| `batch_read` | Read existing benchmark files | 6ms |
| `tree` | Workspace tree, depth 2, capped | 16ms |
| `list` | `browser-tool-bench` | 5ms |
| `list_files` | Markdown files in bench dir | 5ms |
| `exists` | README path | 5ms |
| `stats` | README path | 6ms |
| `read` | fixture HTML | 4ms |
| `read` | scratch file | 3-5ms |
| `search` | `benchmark` in bench markdown files | 6ms |
| `grep` | Directory path with file_glob | 6ms, failed |

Finding: workspace reads are already very fast. The only issue found was ergonomic/behavioral: `workspace_read(action:"grep", path:"browser-tool-bench")` treated the directory as a file and returned `ERROR: "browser-tool-bench" is not a file`, while `search` worked. `grep` should either support directory paths consistently or validate with a clearer message.

### `workspace_edit`

| Action | Scenario | Elapsed |
|---|---|---:|
| `create` | Scratch file | 194ms |
| `find_replace` | Replace one line | 190ms |
| `insert_after` | Insert line | 209ms |
| `copy` | Copy scratch file | 198ms |
| `move` | Move copied file | 163ms |
| `replace_lines` | Replace line span | 186ms |
| `delete_lines` | Delete line | 187ms |
| `mkdir` | Create temp dir | 174ms |
| `delete_file` | Delete moved scratch file | 219ms |
| `apply_patch` | Apply unified diff | 910ms |
| `patchset` | Incorrect edit shape | 2ms, failed validation |

Finding: normal file edits are fast enough. `apply_patch` is slower but acceptable. `patchset` failed because I passed `{action,path,...}` instead of the expected per-edit shape. The wrapper should either accept the same action names as `workspace_edit` or return a more specific schema error.

### `workspace_run`

| Action | Scenario | Elapsed |
|---|---|---:|
| `run` | `node -e console.log(...)` | 14.89s |
| `typecheck` | Placeholder Node command | 351ms |
| `test` | Placeholder Node command | 460ms |
| `lint` | Placeholder Node command | 410ms |
| `format` | Placeholder Node command | 667ms |

Finding: the first plain `run` was the biggest workspace outlier at 14.89s for a trivial Node process. Later run-helper actions were normal at subsecond latency. This suggests a cold-start/supervisor/PTY/process-launch path issue rather than Node itself.

### `workspace_git`

| Action | Scenario | Elapsed |
|---|---|---:|
| `status` | Workspace repo status | 1.48s |
| `diff --stat` | Current dirty repo | 1.32s |
| `log` | Last 3 commits | 388ms |

Finding: git is fine for small log reads, but dirty-repo diff/status is naturally heavier. Current repo is very dirty, so 1.3-1.5s is reasonable.

### `workspace_safety`

| Action | Scenario | Elapsed |
|---|---|---:|
| `snapshot` | Bounded snapshot of bench area | 52ms |
| `scan_secrets` | Bench directory | 5ms |
| `scan_large_files` | Bench directory | 4ms |
| `operation_plan` | Dry-run read/write plan | 4ms |
| `preview_patch` | Bad patch missing standard headers | 3ms, failed |
| `preview_patch` | Valid unified diff check | 390ms |

Finding: safety tools are fast. Valid patch preview has a bit of overhead but is acceptable.

### `workspace_code_nav`

| Action | Scenario | Elapsed |
|---|---|---:|
| `symbols` | Query `handleChat` from workspace root | 370ms, no result |
| `outline` | HTML fixture outline | 49ms |

Finding: outline is fast. Symbol search needs more targeted path/query use, but latency is fine.

## Prometheus Dev Source Read Benchmarks

| Action | Scenario | Elapsed |
|---|---|---:|
| `read` | `prom-root/package.json` | 240ms |
| `list` | `src/gateway/tools/defs` | 205ms |
| `stats` | `src/gateway/tool-builder.ts` | 237ms |
| `grep` | `workspace_read` in tool defs | 232ms |
| `search` | `browser_session` in gateway | 378ms |
| `batch_read` | tool defs + browser-tools snippets | 479ms |
| `stats_batch` | tool-builder + browser-tools | 222ms |

Finding: dev source reads are predictable and reasonably fast. They are much cheaper and safer than shelling out to `rg` when source-read is available.

## Browser Tool Benchmarks

### Session/navigation

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `browser_session doctor` | Check browser state/CDP | 145ms |
| `browser_session open` | Malformed `file://` URL path | 7.44s, failed |
| `browser_session open` | `https://example.com` compact | 4.23s |
| `browser_session list_tabs` | 3 open tabs | 4ms |
| `browser_session close` | Close active tab | 35ms |

Finding: browser doctor/list/close are fast. Navigation still dominates. The malformed `file://` URL path failed slowly because it was normalized to `https://file///...`; this is worth fixing or guarding.

### Observation

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `browser_observe snapshot` | Example.com | 2.57s |
| `browser_observe page_text` | Example.com | 20ms |
| `browser_observe screenshot` | Viewport screenshot | 3.90s |
| `browser_observe focused_item` | No focused item | 17ms |
| `browser_observe snapshot_delta` | No DOM changes | 21ms |
| `browser_observe element_watch` | Existing selector | 34ms |
| `browser_observe wait` | 250ms request, actual 500ms | 529ms |

Finding: observation speed is extremely mode-dependent. Text/focus/delta are excellent. Full snapshot is ~2.6s and screenshot is ~3.9s. `wait` rounded 250ms to 500ms, which is worth noting for fine-grained loops.

### Actions

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `browser_act fill` | Fill input, `observe:none` | 871ms |
| `browser_act click` | Click injected button, `observe:delta` | 2.13s |
| `browser_act key` | Tab, `observe:none` | 1.52s |
| `browser_act scroll` | Scroll one viewport | 1.23s |
| `browser_act type` | Type into focused input | 24ms |
| `browser_act upload_file` | Upload text fixture | 799ms |
| `browser_act click_and_download` | Data URL download | 1.62s |

Finding: browser actions vary more than expected. `type` into an already-focused element was excellent at 24ms, while click/key were 1.5-2.1s. That points to wrapper/post-action observation/metadata overhead, not only CDP input cost.

### Extraction/diagnostics

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `browser_extract run_js` | Inject benchmark controls | 27-39ms |
| `browser_extract console` | Read console entries | 1.99s |
| `browser_extract network start/read` | Start/read no responses | 6ms / 4ms |
| `browser_extract accessibility` | Axe/accessibility on example page | 23.99s |
| `browser_extract smoke_test` | Example.com safe smoke | 7.52s |
| `browser_extract extract_structured` | Bad schema shape | 4ms, failed |
| `browser_extract scroll_collect` | Bad schema path mapped to structured validation | 4ms, failed |

Finding: `run_js` and network start/read are very fast. Console read has noticeable overhead. Accessibility is by far the heaviest browser diagnostic. Smoke test is predictably heavy because it bundles multiple checks.

## Desktop Tool Benchmarks

### Screen/app discovery

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `desktop_screen doctor` | Full desktop readiness check | 6.47s |
| `desktop_screen monitors` | Monitor geometry | 1.16s |
| `desktop_screen screenshot` | Primary monitor screenshot | 4.43s |
| `desktop_apps list_windows` | Open windows | 1.15s |
| `desktop_apps process_list` | Chrome processes/window match | 980ms |
| `desktop_apps find_installed_app` | Chrome lookup | 3.26s |

Finding: `desktop_screen doctor` and screenshots are heavy. Window/process discovery is around 1s. Installed app lookup is heavier because it searches multiple system sources.

### Window/text/input

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `desktop_window state` | Chrome state | 2.11s |
| `desktop_window screenshot` | Chrome window screenshot | 2.78s |
| `desktop_window text` | Active terminal text | 799ms |
| `desktop_window accessibility_tree` | Active window, depth 2 | 772ms |
| `desktop_window focus` | Missing name | 4ms, failed validation |
| `desktop_window focus` | Chrome by title | 3.46s |
| `desktop_window key` | Escape, focus_first, verify off | 2.07s |
| `desktop_window scroll` | Scroll Chrome, verify off | 4.13s |
| `desktop_window click` | Harmless Chrome click, verify off | 4.34s |
| `desktop_input wait` | 100ms wait | 118ms |
| `desktop_input key` | Escape | 423ms |
| `desktop_input clipboard_get` | Clipboard read, 18.9k chars | 968ms |
| `desktop_background status` | Background desktop availability | 1.74s |

Finding: desktop text/UIA reads are subsecond and should be preferred for text state. Desktop click/scroll are still ~4s even with verification off, which is too slow for fluid control. `desktop_input key` is much faster than window-scoped key when exact window scoping is not required.

Important footgun observed: the benchmark click was harmless, but the tool result showed `+ctrl` because the call carried `modifier:"ctrl"`. The schema should allow/encourage `modifier:"none"` or omit modifier cleanly. Raul specifically prefers normal coordinate clicks unless a modifier is truly required.

## Memory, Notes, Skills, Automation, and Core Tool Benchmarks

| Tool/action | Scenario | Elapsed |
|---|---|---:|
| `skill_list` | No benchmark skill match | 724ms / 680ms |
| `skill_list` | Query `file`, returned 8 skills | 643ms |
| `skill_read` | Browser automation playbook | 4ms, huge output |
| `skill_read` | File Surgery | 5ms, huge output |
| `write_note` | Intraday benchmark note | 1ms |
| `memory_write` | Durable benchmark memory fact | 2ms |
| `memory_read` | Full MEMORY.md | 2ms, huge output |
| `memory_search` | Benchmark/tool latency query | 17.04s |
| `timer list` | Current session timers | 2ms |
| `task_control list` | Current/session tasks | 179ms |
| `schedule_job list` | Existing schedules | 0ms |
| `schedule_job_detail` | Trading brief job | 220ms, huge output |
| `internal_watch list` | Active watches | 0ms |
| `automation_dashboard` | Summary dashboard | 1.17s, huge output |
| `connector_list` | All connectors | 6.51s |
| `business_context_mode status` | Business context status | 1ms |
| `background_spawn` | One-sentence benchmark task | 787ms to spawn, ~4.8s to completion |
| `background_wait` | Completed background task | 1ms |
| `show_ui_card` | Comparison card | 1ms |
| `web_search` | TinyFish single-provider query | 56.94s timeout |

Finding: notes/memory writes and simple automation lists are excellent. `memory_search` is too slow at 17s; telemetry showed the FTS phase consumed ~16.94s. `skill_read` is fast but injects enormous output for bundle skills, so token cost is the problem, not latency. `web_search` needs timeout/fallback tuning.

## Highest-Value Speed Fixes

### 1. Browser actions: add a true no-observation fast path

Observed:

- `browser_act type` into focused input: 24ms
- `browser_act fill`: 871ms
- `browser_act key`: 1.52s
- `browser_act click`: 2.13s

The 24ms `type` result proves sub-100ms browser interaction is possible when the wrapper avoids extra work. Make click/key/fill able to follow the same fast path when `observe:"none"` and no post-action evidence is needed.

Likely source work:

- Audit `browser_act` wrapper dispatch for mandatory post-action metadata probes.
- Ensure `observe:"none"` means no snapshot, no screenshot, no full DOM recount, no title/focus diff unless explicitly requested.
- Return a compact ack only.

### 2. Desktop click/scroll: reduce fixed overhead

Observed:

- `desktop_input key`: 423ms
- `desktop_window key`: 2.07s
- `desktop_window scroll`: 4.13s
- `desktop_window click`: 4.34s

Desktop mouse actions are too slow for normal UI operation. Since verify was off, the remaining cost is likely focus/window resolution/capture/change-check overhead.

Likely source work:

- Add an explicit `fast:true` or `verify:"off"` path that skips screen-change wait and post-action recapture.
- Cache window handles/bounds for the current active target for a short TTL.
- Avoid re-focusing if target is already active.
- Add `modifier:"none"` to schema and prompt docs to prevent accidental Ctrl-clicks.

### 3. Workspace run cold-start investigation

Observed:

- First `workspace_run(action:"run")` trivial Node command: 14.89s
- Later `test/lint/typecheck/format` trivial Node commands: 0.35-0.67s

This looks like a cold path or wrapper/supervisor delay.

Likely source work:

- Add phase telemetry inside `workspace_run`: command approval/policy, process spawn, first output, exit wait, serialization.
- Compare shell auto vs cmd vs powershell vs bash.
- Check if `run` path differs from check helpers.

### 4. Memory search quick mode needs a faster FTS path

Observed: `memory_search` quick query took 17.04s, with `fts_query_ms` ~16.94s.

Likely source work:

- Inspect FTS query construction and indexes.
- Add a hard quick-mode timeout with partial lexical/vector fallback.
- Consider limiting candidate set earlier for common broad terms like `tool`, `browser`, `desktop`, `latency`.

### 5. Browser diagnostics should be opt-in only

Observed:

- `browser_extract accessibility`: 23.99s
- `browser_extract smoke_test`: 7.52s
- `browser_observe screenshot`: 3.90s
- `browser_observe snapshot`: 2.57s

These are useful, but too heavy for routine operation.

Agent behavior rule:

- Use `page_text`, `focused_item`, `snapshot_delta`, and `run_js` first when appropriate.
- Use screenshot/snapshot only when visual truth or refs are needed.
- Use accessibility/smoke only for QA, not regular navigation.

### 6. Skill read output needs compact mode

`skill_read` returns in 4-5ms, but large bundle skills inject tens of thousands of characters. Latency is fine; token cost is not.

Likely source work:

- Add `skill_read({id, mode:"summary"|"full"})` or a separate `skill_summary`.
- Return SKILL.md only by default, not every history/reference resource, unless requested.

### 7. Web search provider timeout/fallback

Observed: TinyFish single-provider query timed out after 56.94s.

Likely source work:

- Enforce per-provider timeout under ~8-12s for interactive chat.
- If primary provider times out, return partial/fallback results from other providers rather than blocking for nearly a minute.

## Proposed Next Engineering Targets

1. **Browser fast path proposal/edit**: make `observe:"none"` truly minimal for click/key/fill/type.
2. **Desktop fast path proposal/edit**: optimize `desktop_window click/scroll/key` with cached active window and no post-action verification when `verify:"off"`.
3. **Workspace run telemetry**: instrument sub-phases to explain the 14.89s cold run.
4. **Memory search quick timeout**: cap FTS latency and return partial candidates.
5. **Skill compact read**: reduce prompt bloat from bundle skills.
6. **File URL guard**: fix `browser_session open` normalization for `file:///C:/...` paths or reject quickly with an actionable message.
7. **Workspace wrapper polish**: normalize `workspace_read grep` directory behavior and `workspace_edit patchset` schema ergonomics.

## Bottom Line

Workspace file tools are already extremely fast: most reads are single-digit milliseconds and most edits are ~0.16-0.22s. The biggest practical speed wins are not in basic file IO; they are in browser/desktop orchestration, memory search, web-search timeout behavior, and token-heavy skill outputs.

Browser has proof that very fast interaction is possible: warm `run_js`, `page_text`, `focused_item`, `snapshot_delta`, and focused `type` were all 17-39ms. The slow cases are wrappers that do extra observation/diagnostic work. Desktop is similar: text/UIA reads are subsecond, but visible mouse actions and screenshots are still multi-second. Those are the places to attack first.
