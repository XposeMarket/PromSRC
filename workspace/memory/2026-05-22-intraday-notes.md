
### [TASK] 2026-05-22T03:36:54.095Z
_Source: Telegram chat session; session: telegram_1799053599_1779420593864; origin: Telegram_
Codex handoff submitted from Telegram session: Raul asked to tell Codex to commit and push the latest Prometheus source version to PromSRC. Used existing Codex chat "Inventory tracked runtime files" and sent prompt instructing Codex to inspect git status/diff, avoid private workspace/runtime junk/secrets/node_modules/build caches/nested repo artifacts, stage intended Prometheus source changes, commit, push to configured remote, and report commit hash/branch. Screenshot proof was sent to Telegram; Codex was actively running git add/staging commands.

### [TASK] 2026-05-22T03:41:29.962Z
_Source: Telegram chat session; session: telegram_1799053599_1779420593864_
Codex PromSRC commit/push follow-up completed. Codex reported it committed and pushed the latest Prometheus source update to PromSRC: commit 9cae9713d7b061aa1721fe4fd9c59177f743b7c7, branch/remote main -> origin/main, message "Update Prometheus source for 1.0.5". Codex said checks passed before commit: git diff --cached --check, staged forbidden/private path audit, staged secret-pattern scan, npm run check:web-ui, npm run build. It intentionally left local workspace/** changes and docs/OPENCUT_*.md uncommitted/unpushed. Screenshot proof sent to Telegram.

### [TASK] 2026-05-22T14:11:29.930Z
_Source: Main chat session; session: f2976ae6-8cb9-493a-9225-85c1e17e1413; origin: Desktop app_
Downloaded latest upstream OSS agent repos into workspace `oss agents/`: cloned `openclaw/openclaw` into `oss agents/openclaw` at main HEAD `ab684f508800d58800c07a06d29050ae4ea9da2e`, and `NousResearch/hermes-agent` into `oss agents/hermes-agent` at main HEAD `1e71b7180e5b4e84905b9a3086cf9cecca139562`. Verified both working trees show `main...origin/main`.

### [TASK] 2026-05-22T16:03:41.584Z
_Source: Main chat session; session: f283bcc7-8612-4653-a3ad-f7a493ae9cce; origin: Desktop app_
Created bundled skill `browse-sh-web-skills` (“Browse.sh Web Skills Adapter”) after Raul said bundled skill resource injection is fixed and asked to create a Browse.sh usage/import skill. The skill defines when Browse.sh/Browserbase Browse CLI is useful, default Prometheus-native adaptation, safety rules, import/update workflow, and includes `references/browse-sh-overview.md` with findings from browse.sh, Browserbase docs, and browserbase/skills README. Also wrote a SOUL tool rule noting bundled `skill_read` now auto-injects resources and Browse.sh-informed web automation should be imported/adapted into Prometheus skills/resources when used.

### [GENERAL] 2026-05-22T16:08:55.457Z
_Source: Main chat session; session: f283bcc7-8612-4653-a3ad-f7a493ae9cce; origin: Desktop app_
Raul confirmed the desired Browse.sh strategy: whenever Prometheus uses Browse.sh/Browse CLI/catalog intelligence for a web task, import/adapt that specific Browse.sh skill into Prometheus as a bundled skill or resource so Prometheus' web capabilities/search catalog grows over time. Wrote this as a SOUL tool rule. Note: switch_model('low') was attempted for quick memory write, but no low-tier model is configured.

### [TASK] 2026-05-22T16:52:07.957Z
_Source: Main chat session; session: 0889e2b9-113c-4497-b391-995151368583; origin: Desktop app_
xurl setup attempt from XDevelopers guide: fetched full article text; relevant #3-4 are install xurl and OAuth setup. npm global install failed because @xdevplatform/xurl@1.0.3 postinstall calls Unix `unzip`, which is missing on Windows. Worked around inside workspace by npm installing with --ignore-scripts to `workspace/tools/xurl-local`, patched install.js to use PowerShell Expand-Archive, ran installer, and verified CLI via `npm exec --prefix workspace\tools\xurl-local -- xurl --help`. `xurl auth status` reports no apps registered. Prometheus connector_list shows xAI connected but X connector not connected, so xurl OAuth still needs an X developer app Client ID/Secret registered with `xurl auth apps add ...` and browser OAuth with redirect URI `http://localhost:8080/callback`.

### [TASK] 2026-05-22T17:55:41.919Z
_Source: Main chat session; session: f2db1dc8-84c4-4034-9501-12f3fb3f812e; origin: Desktop app_
AI smoke test run on 2026-05-22: loaded ai-surface-smoke-research plus desktop/browser/X playbooks, focused Codex (handle 67262) and a Claude-related Chrome window, opened Reddit and X searches for `Claude OpenClaw Hermes AI`, collected Reddit result text and 22 X structured tweet items. Signals: Reddit discussion is heavily Hermes/OpenClaw comparison and migration focused; X chatter frames Claude/Codex/Hermes/OpenClaw as parts of agent OS/workflow stacks, with reliability, reusable workflow, shared context/memory, and small-business decision handoff as recurring themes.

### [TASK] 2026-05-22T17:59:42.255Z
_Source: Main chat session; session: 7359ae8c-3598-47b2-972d-e7aa46a1dae8; origin: Desktop app_
Browser smoke test/correction on 2026-05-22: Raul steered mid-run to use Prometheus' own browser tools/session, not desktop tools. Browser session had two X search tabs at indices 0 and 3; both were closed via browser_close_tab, then a new tab was opened to https://www.reddit.com/. Remaining tabs included New Tab, X Developer Console, about:blank, and Reddit active.

### [TASK] 2026-05-22T18:43:30.405Z
_Source: Mobile chat session; session: mobile_mph8jltd_f4cf3y; origin: Mobile app_
Updated `self/06-image-voice.md` after source inspection to correct Voice Agent docs: Voice Agent is not tool-less; it has a small allowlisted `voice_*` tool set (`voice_web_search`, `voice_web_fetch`, `voice_write_note`, `voice_skill_lookup`, `voice_memory_search`, `voice_timer`) defined/executed in `src/gateway/routes/chat.router.ts` via `buildVoiceToolDefinitions()`, `executeVoiceAgentToolWithTrace()`, `executeVoiceAgentTool()`, fallback routing, and `voice_agent_tool_event` process logs. Also updated `self/index.md` verification line to 2026-05-22 direct voice tool wrappers.

### [TASK] 2026-05-22T23:11:24.581Z
_Source: Main chat session; session: fb5b7c1d-64f7-49e5-a13c-97284bcd8539; origin: Desktop app_
Amazon toothbrush search completed with Browse.sh steering: read `browse-sh-web-skills`, fetched Browse.sh Amazon Product Search skill, opened Amazon search for `toothbrush`, extracted visible product cards with Amazon selectors, and saved adapted Browse.sh reference to `browse-sh-web-skills/references/browse-sh-amazon-search-products.md`.

### [TASK] 2026-05-22T23:22:19.221Z
_Source: Main chat session; session: fb5b7c1d-64f7-49e5-a13c-97284bcd8539; origin: Desktop app_
Updated `browse-sh-web-skills` to v1.0.1 overlay: broadened triggers to overlap with web-research/site extraction tasks, added Amazon-specific triggers, added default workflow mapping Browse.sh commands/raw HTML into Prometheus-native browser tools (`browser_extract_structured` preferred for repeated listings/products; snapshot/vision for verification; run_js fallback), updated Amazon resource with trigger hints and extraction schema, and added `references/resource-triggering-design-note.md` recommending first-class resource/template/example triggers plus auto-injection.

### [DISCOVERY] 2026-05-22T23:37:04.035Z
_Source: Mobile chat session; session: mobile_mphk3vjz_kcytrp; origin: Mobile app_
Investigated Prometheus run_command failure for Windows `powercfg /change ...` commands. Current blocker: `src/gateway/chat/chat-helpers.ts:isAllowedShellSegment` hard-codes allowed command tokens and omits `powercfg`, so `run_command` rejects it before approval/execution with “shell command is not allowed by policy.” `subagent-executor.ts` also validates native file-tool bypass, blocked patterns, absolute path scope, then command permission approval. Best fix is not broad shell bypass: add a controlled Windows system-command lane/config allowlist (at minimum `powercfg`) with commit-tier approval/audit, plus self docs update in `self/05-tools.md`/sharp edges. Elevated/admin commands may still require an explicit UAC/elevated execution path because captured run_command runs under the Prometheus process token.
