# 25: Sharp Edges

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** cross-cutting
> **Read this when:** something behaves strangely, a tool "fails", or you're about to do something irreversible. Add a new edge whenever you lose 10+ minutes to one.

## TL;DR
- There are **two copies of self/**: the workspace one (this one, canonical for agents) and `PromSRC/workspace/self` (git-tracked, shipped). See §1.
- **`gh` is not installed.** Use `connector_github`. `workspace_git(action:"open_pr")` fails.
- **Zero search results usually means wrong search mode,** not a broken tool. Alternation (`a|b`) needs `regex:true`.
- **The live checkout has ~140 unrelated dirty files.** Never `git add -A`, reset or clean in `C:\Users\rafel\PromSRC`.
- **Paid media runs cost real money.** Check the model's input schema and quote the cost before every run.

## 1. Two self/ directories
| Copy | Path | Who reads it |
|---|---|---|
| Workspace guidebook | `%APPDATA%\Prometheus\workspace\self\` | The runtime: `prompt-context.ts` resolves `self/index.md` and `self/06-image-voice.md` relative to the **workspace** |
| Repo copy | `C:\Users\rafel\PromSRC\workspace\self\` (111 tracked files) | `scripts/test-self-doc-drift.mjs` (checks index links), packaging/public workspace seeding, PR diffs |

PRs have edited the repo copy (e.g. #559 changed `WEB_UI_THEMES.md` on 2026-10-07), so the two drift apart. **Decision pending (Raul):** sync this rebuilt guidebook into the repo copy via a PR, or point the repo at it. Until then, edits made in a PR to `PromSRC/workspace/self` must be mirrored here by hand. `dev-source-approvals.ts` treats both `self` and `workspace/self` as self-doc dirs.

## 2. Git, PRs, worktrees
- **PR work only in `C:\Users\rafel\promsrc-pr\<slug>`** (git worktree). Inspect branch and dirty state before creating or switching.
- **Worktrees have no `node_modules`.** The established trick is a directory junction to PromSRC's `node_modules`. Never `npm install` into the live checkout from a worktree.
- **Force-removing worktrees can be blocked by goal policy.** Stale scratch worktrees (`promsrc-pr\lf-check`, `main-check`) were left registered. Clean them up deliberately with `git worktree list` / `remove`.
- **No self-merge.** Astra (Codex) reviews and merges Prom PRs when green. The exception: Raul says "build it / get it live", in which case carry it through merge → pull → build → restart → smoke test.
- **`$LASTEXITCODE` is unreliable through PowerShell pipelines.** Check the run's own exit code.

## 3. Search & file tools
- `workspace_read grep/search` defaults to **literal** matching. A pattern with `|`, `(`, `\d` and no `regex:true` returns 0 matches plus a warning. Retry with the right mode before suspecting the tool.
- `search_files` **default-excludes `dist/`, `build/`, `generated/`, `temp/`, `logs/`**. Searching built output returns nothing silently. Use `rg` via `workspace_run` with an explicit path.
- Note the default exclude on `generated/` in particular: `self/generated/` won't show up in default searches. Search it explicitly.
- Big tool outputs get spilled to `temp/tool-results/*.txt` (`[TOOL_RESULT_ARTIFACT]`). Read the targeted range; don't rerun the command.
- Giant files: `src/gateway/routes/chat.router.ts` (~17k lines) and `src/gateway/prompt-context.ts`. Grep for symbols, then read windows. See [generated/source-map.md](generated/source-map.md).

## 4. Windows / PowerShell
- In `workspace_run`, `"*.ts"` inside complex one-liners can break PowerShell parsing. Keep globs in simple commands, or use `-g '*.ts'` with single quotes.
- `Join-String` doesn't exist in Windows PowerShell 5.1. Use `-join`.
- **MAX_PATH (260):** deep media paths (trend-pipeline frames reached 278 chars) fail. Keep generated asset paths short.
- Admin actions use `elevated:true` (one-shot approval each time, UAC once at broker install). Background `start` can't be elevated.

## 5. Models, providers, spawning
- **Don't spawn Anthropic subagents while main chat runs on Anthropic** (Max-plan 429s).
- OpenAI spawns: `gpt-6.1-sol` takes reasoning effort **low/medium only**; `gpt-6-luna` takes **xhigh/max only** and needs `speed:"fast"` with an explicit provider+model. `gpt-6-sol` is retired.
- Background workers get **core tools plus the declared `tool_categories`** only. The prompt is not keyword-scanned, so declare `workspace_write` etc.
- The `background_ops` spawn timeout (120s default) is a join window, not a kill.

## 6. Media / money
- Image generation goes through **built-in OpenAI or xAI only**. fal/Higgsfield are for video, lip-sync, swaps and upscales.
- **Check the model's inputs before paying.** Synced fal entries for Kling v3 motion-control were mis-mapped (missing `image_url` and the required `character_orientation`). A custom model entry was needed.
- Project spend caps (`capUsd`) block jobs silently at quote time. Check the quote against the remaining cap first.
- Old drain-host processes can keep holding ports across fixes. Check PIDs before assuming new code is running.

## 7. Gateway / runtime
- After pulling into PromSRC: build (see [07](07-source-editing-and-pr-workflow.md)), then restart the gateway, then smoke test. **A running gateway serves old `dist/` until it restarts.**
- Restarts pause in-flight background tasks (`paused on gateway_restart`). Resume or cancel them explicitly.
- Health check: `GET http://localhost:18789/...`. See [02](02-startup-gateway-runtime.md) for the exact endpoint.

## 8. Teams (see [09](09-teams.md))
- `team_bg_*` wrapper IDs historically didn't resolve in watches or `get_agent_result`; only task UUIDs did.
- Duplicate `GOAL_COMPLETE` signals and null-taskId duplicate dispatches have been observed. Verify deliverables on disk rather than trusting the completion event.
- Members should write to their target dir (e.g. `teams-test/…`), not the team workspace.

## 9. Behavioral rules that look like sharp edges
- Asking Raul a choice goes through `ask_prometheus_questions`, never prose options.
- Connector gaps (no full API or `api_request`) get fixed via PR immediately; don't ask.
- Links meant for Raul's phone use **Tailscale Funnel**, not `serve` (his phone is not on the tailnet).
- Don't call `update_heartbeat` on casual greetings.

## Related
[index](index.md) · [07 PR workflow](07-source-editing-and-pr-workflow.md) · [ISSUES.md](ISSUES.md) · [generated/tests.md](generated/tests.md)
