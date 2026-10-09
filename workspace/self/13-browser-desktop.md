# 13 — Browser, Desktop & Media Assets

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/gateway/browser-tools.ts`, `src/gateway/desktop-wrappers.ts`, `src/tools/`, `src/connections/`
> **Read this when:** Automating a website or desktop app, transferring login control to the user, teaching a repeatable browser workflow, or downloading/analyzing media.

## TL;DR
- Browser automation uses the user-facing in-app browser and a persistent browser profile; it is not a general-purpose credential scraper. Re-anchor from current observations/screenshots when page state changes.
- Browser-facing actions are grouped into session setup, observation, interaction, extraction, and screenshots (`browser_session`, `browser_observe`, `browser_act`, `browser_extract`, vision screenshot surface). Treat a fresh screenshot as the truth for dynamic/ambiguous UI.
- Browser interaction modes include agent, copilot, and teach. Teach captures steps for later verification; copilot is collaborative rather than silently taking over the user's workflow.
- For a login wall, navigate to the site's login page, hand control to the user through `request_browser_login`, then re-observe after they confirm. Never ask them to type credentials into chat.
- Browser sessions are shared for subagents and the open chat panel follows the active thread (recent source change); avoid creating duplicate unrelated profiles.
- Desktop automation is a distinct native surface: `desktop_screen`, `desktop_apps`, `desktop_window`, `desktop_input`, and `desktop_macro` are backed by `src/gateway/desktop-wrappers.ts` and `src/gateway/desktop-tools.ts`.
- Desktop window focus, coordinates, keyboard input, and macro replay are stateful. Capture a fresh screen before acting on a changed screen; use small, verifiable action batches.
- Direct media work uses `download_url`/`download_media` and `analyze_image`/`analyze_video`. Use browser automation for a download initiated by a webpage; use media-assets tools for a known URL/file.
- Browser, desktop, and media-assets categories are separately provisioned. Do not assume that a tool available in one category is present in another.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Browser state, profiles, session metadata | `src/gateway/browser-tools.ts` → `BrowserSessionMetadata`, `getBrowserSessionMetadata()` | Owns profile/session state and interaction/teach types. |
| Browser teach state | `src/gateway/browser-tools.ts` → `BrowserTeachSessionSnapshot`, `saveBrowserTeachSessionSnapshot()` | Phases include recording, approval pending, verifying, verified. |
| Browser interaction modes | `src/gateway/browser-tools.ts` → `BrowserInteractionMode` | `agent`, `copilot`, `teach`. |
| Browser setup/observe/act/extract | browser automation wrappers → `browser_session`, `browser_observe`, `browser_act`, `browser_extract` | Load `browser_automation` category; use the current wrapper schema. |
| Browser screenshot grounding | browser vision screenshot wrapper; `analyze_image` for a local image | Fresh screenshot is preferred over DOM/JS guesses on dynamic UI. |
| User login handoff | `request_browser_login` runtime card | User types secrets directly into the browser and confirms; never transcribe them. |
| Browser-backed integrations | `src/connections/adapters/browser-session.ts` | Connection setup may rely on the in-app browser session. |
| Desktop gateway surface | `src/gateway/desktop-wrappers.ts` → `desktop_screen`, `desktop_apps`, `desktop_window`, `desktop_input`, `desktop_macro` | Prometheus wrappers dispatch to native desktop helpers. |
| Desktop implementation | `src/gateway/desktop-tools.ts` | Native OS input/screen/window/app/macro capabilities (granular handlers behind the wrappers). |
| Desktop native helper | `src/gateway/desktop-tools.ts` | Helper/process integration, distinct from browser automation. |
| Download URL | `src/gateway/tools/defs/file-web-memory.ts` → `download_url` | Direct remote file download; GitHub blob URLs are rewritten to raw files. |
| Download supported-page media | `src/gateway/tools/defs/file-web-memory.ts` → `download_media` | Uses yt-dlp for supported media pages. |
| Analyze media | `src/gateway/tools/defs/file-web-memory.ts` → `analyze_image`, `analyze_video`; `src/tools/media-analysis.ts` | Inspect a local/uploaded image or video; vision-capable turns may receive images directly. |
| Tool/category routing | `src/runtime/tool-category-manifest.ts`; `src/runtime/tool-category-keyword-router.ts` | Browser, desktop, and media assets load separately. |
| Current tool list | [`generated/tools.md`](generated/tools.md); [`generated/tool-categories.md`](generated/tool-categories.md) | Generated inventory is authoritative for names/schema ownership. |

## How it works

### Browser session: observe before action
1. Start or select the in-app browser session/profile with `browser_session`. Keep site-specific work on the intended tab/session; use current session metadata rather than assuming the last tab is still active.
2. Observe the page with a snapshot/accessibility/DOM view and, when the page is dynamic, a fresh vision screenshot. Locate the actual visible target before clicking or typing.
3. Act with the narrowest operation available through `browser_act`. Wait for navigation/loading, then observe again. A click result is not evidence that the intended state change succeeded.
4. Extract text or structured values only from the page that is actually open. Do not use arbitrary script execution as a substitute for a visible confirmation or to evade website controls.
5. For important state changes, verify on the resulting page and report only what the fresh evidence shows. Re-anchor after navigation, modal transitions, login, or a page that re-renders.

Use `browser_extract` for page content, not for actions. Use a screenshot when element refs, page text, and observed UI disagree. Vision is the highest-confidence current state on pages likely to change; repeatedly probing script/DOM without a new view often chases stale state.

### Login handoff
- When a site requires a password, OAuth, CAPTCHA, or 2FA, first navigate the in-app browser to that site's login page. Call `request_browser_login` for the named site with the current login URL and why user input is needed.
- The user enters credentials in the browser itself. Do not collect, repeat, store, or paste passwords/one-time codes in chat or tool arguments.
- After the handoff returns, re-check the page/session. Only continue if the expected authenticated state is visible; otherwise resume or report the specific blocker.
- For connector setup, use `connection_ops` (see [12 Connectors & MCP](12-connectors-mcp-integrations.md)) so login continuation is attached to a durable connection attempt and the result can be verified.
- Do not call the handoff before navigating to a login page or assert that authentication succeeded based on the user saying they entered details: confirm the resulting page.

### Copilot and teach modes
- Agent mode performs the requested browser task using the session tools. Copilot mode is collaborative: preserve the user's control and account context; do not turn it into invisible background activity.
- Teach mode models an observed workflow as a sequence of step snapshots. `BrowserTeachPhase` represents `idle`, `recording`, `approval_pending`, `verifying`, and `verified`; a recorded sequence is not automatically a verified reusable automation.
- The teach snapshot includes steps, a pending step, risk information, and verification output. Inspect and approve a pending high-risk step before treating the learned routine as ready.
- Teaching does not authorize future high-impact posts, sends, purchases, deletes, or account changes without the ordinary approval gate for that action.
- When playback is uncertain or a site layout changes, stop, re-observe, and re-verify; do not blindly replay stale selectors or coordinate sequences.

### Desktop app automation
- `desktop_screen` grounds actions in the current display. `desktop_apps` discovers/launches installed applications; `desktop_window` inspects/selects/focuses target windows; `desktop_input` performs keyboard/mouse input; `desktop_macro` records or replays multi-step input.
- Keep the target app/window explicit. Before coordinate-based input, inspect a recent screenshot and make sure the active window is the one intended.
- Prefer semantic window/control operations where available; screen coordinates can change with window size, DPI, layout or overlays.
- For a multi-step macro, build a short sequence, observe between meaningful transitions and verify its final state. Do not replay a long macro after an app has moved to a different state.
- Keyboard shortcuts can send destructive actions to the wrong window if focus changed. Re-check focus and visible state immediately before consequential input.
- The desktop backend has native helpers and persistent PowerShell-host fast paths. A stale helper or long-lived host can make results appear out-of-date; inspect process/helper state before assuming the new action ran.

### Media assets: known files vs web pages
- Use `download_url(url, filename?)` for a known direct asset URL. It saves the fetched file into the workspace and can rewrite GitHub blob URLs to raw file URLs.
- Use `download_media(url, audio_only?)` for a supported media page (for example a public video/post page handled by yt-dlp). It is not a general authenticated browser download mechanism.
- Use `analyze_image` or `analyze_video` on a local/uploaded path to inspect visual content. A vision-capable chat turn may accept the screenshot/image directly; avoid an unnecessary second analysis request when the image is already visible to the model.
- For browser-triggered downloads that depend on a signed-in session or a webpage button, use browser automation and its download behavior. A raw URL fetch cannot inherit the user's browser cookies.
- If the user asks to inspect a local screenshot, call `analyze_image` or use current vision evidence; keep conclusions tied to what the media shows, not guessed metadata.

## Config & knobs
- Browser profile/tab/session lifecycle is managed by browser runtime state; session IDs and metadata are runtime context, not credentials. Share the intended session deliberately when continuing work from another chat or subagent.
- The main browser interaction modes represented in source are `agent`, `copilot`, and `teach`. Mode changes affect how control is shared; they do not remove website or approval boundaries.
- Browser and desktop categories are distinct from one another and from `media_assets`. Category activation exposes the relevant wrapper surface; check [`generated/tool-categories.md`](generated/tool-categories.md) for category ownership.
- `download_media` accepts an audio-only option and uses supported-page resolution; consult the tool schema for current default output naming and available formats.
- `desktop_macro` operates on native input rather than browser DOM. Keep all target-window/focus details explicit in each run.
- Browser automation policies and current tool schemas are generated into [`generated/tools.md`](generated/tools.md); avoid relying on names copied from old prompts if the schema has changed.
- UNVERIFIED: there is no per-site browser timeout/selector default asserted here; check the live wrapper schema/config before tuning those values.

## Gotchas / sharp edges
- **DOM/vision disagreement:** if a dynamic page has changed, trust a fresh screenshot over stale refs, a previous extraction, or an assumption. Re-observe and re-anchor before clicking.
- **Stale state after action:** navigation, login and modal actions can take time. Wait, take a new observation, then verify the page before reporting success.
- **Wrong tab/profile:** subagents share the in-app browser profile; a browser panel may follow the open subagent chat (change landed Oct 6). Confirm current session/tab before acting or two workflows can collide.
- **Credentials in chat:** stop and use the login handoff. Never ask a user to paste a password, OAuth secret, or one-time code into the transcript.
- **Teaching vs approval:** a captured/replayed teach step does not confer authority for a high-impact external action. Stop at approval before posting, sending, purchasing, deleting, or submitting.
- **Coordinate drift:** changing windows, display scale or layout invalidates desktop coordinates. Capture a fresh screen and re-identify the intended target.
- **Focus drift:** keyboard input may land in an unexpected window. Verify the active window before typing or invoking destructive shortcuts.
- **Macro staleness:** a recorded UI sequence may no longer match the page/app state. Rehearse short steps and inspect the result instead of blind replay.
- **Download URL vs content page:** a page URL may not be a direct file. Use `download_media` for supported public media pages or use the browser when authentication/button interaction matters.
- **Avoid duplicate image analysis:** vision input in the current turn may already make the image visible. Analyze separately only when needed or the media is not in current context.
- **Separate tool categories:** if a wrapper is missing, activate the correct category rather than repeatedly probing an unloaded tool.
- **No successful action without evidence:** tool call completion means the backend returned, not that the user-visible site/app reached the requested state.

## How to change it safely
- Search [`generated/tests.md`](generated/tests.md) for browser, desktop, media-analysis, download, and tool-category regressions before editing.
- Browser changes: inspect `src/gateway/browser-tools.ts` and its targeted browser-session/continuity regressions. Test session selection, page observation, navigation, and login continuation in a fresh in-app browser session.
- Desktop changes: inspect `src/gateway/desktop-wrappers.ts` and `src/gateway/desktop-tools.ts`; run focused desktop regressions and verify screen/window/input behavior with a non-destructive app.
- Media asset changes: inspect `src/gateway/tools/defs/file-web-memory.ts`, `src/tools/media-analysis.ts`, or `src/tools/download-tools.ts` as relevant; test known URL, supported media page and local analysis separately.
- Keep source edits in an isolated PR worktree. Do not rebuild or modify the dirty live PromSRC checkout while documenting or changing this surface.
- Live verification should use a fresh screenshot, explicit active target, and harmless action first. Confirm the resulting visual state before claiming a workflow completed.

## Related
[12 Connectors & MCP](12-connectors-mcp-integrations.md) · [21 Security & approvals](21-security-approvals-permissions.md) · [generated tool inventory](generated/tools.md) · [generated categories](generated/tool-categories.md) · [generated tests](generated/tests.md)


## Practical verification recipes

### Browser action loop
1. Confirm the intended account, session and tab; get a fresh page observation and screenshot.
2. State the requested target precisely (button, menu item, form field or visible text) and locate it in the current view.
3. Make one state-changing interaction. Avoid sending a multi-action blind sequence across an unknown navigation boundary.
4. Wait for visible progress to settle, then capture a second screenshot/observation and check the resulting state.
5. If the state differs from expectation, stop and re-anchor from the page. Do not retry a click just because the first call returned without an error.
6. Before submitting an external high-impact action, prepare the final UI and use its approval gate. Approval applies to the exact action/content/recipient shown, not a later modified form.

### Common browser failure diagnosis
| Symptom | Likely cause | First check |
|---|---|---|
| Target ref cannot be found | Page re-rendered, wrong tab or stale snapshot | Fresh observe + screenshot; rebuild target references. |
| Click appears to do nothing | Overlay, disabled control, hidden page state | Check screenshot and actual visible/enabled state; wait for app response. |
| Login repeats after handoff | User entered credentials into a different tab/profile, or site still needs a step | Reopen correct in-app browser session and inspect current login state. |
| Extraction conflicts with screenshot | Stale DOM/text snapshot or canvas-rendered UI | Prefer fresh screenshot evidence and re-extract after re-anchoring. |
| Download fails on a signed-in site | Raw downloader has no browser session cookies | Use in-app browser; do not copy session cookies into arguments. |
| Teach playback stops at approval pending | Workflow contains a risky/ambiguous step | Review the exact pending step, approve through intended UI, then verify; never skip by replaying blindly. |

### Desktop action loop
- Find the target app/window with `desktop_apps` and `desktop_window`; verify the title/process and active/focused window before input.
- Capture a screenshot using `desktop_screen` before using screen coordinates. Prefer existing semantic controls/operations where the wrapper provides them.
- Use `desktop_input` for one small interaction at a time. Check the screen after typing, navigating or confirming dialogs.
- Save a `desktop_macro` only after a harmless rehearsal. Keep the sequence as short as possible and verify a full successful playback in the expected window.
- If the environment has multiple monitors, changed scaling or a resized window, retake the screenshot. Do not reuse old pixel coordinates.
- For a native file picker, password dialog, or OS permission prompt, interact through the desktop only as needed; do not scrape credential contents to report them back.

### Media asset troubleshooting
- For a direct file URL, check whether a redirect/login page was saved instead of the intended asset; inspect file type/size and analyze the downloaded file before using it.
- For a video webpage, `download_media` depends on yt-dlp support and the source page's availability. If it is login-gated or requires a browser control, switch to the browser route.
- For a large or unsupported local video, check the analysis tool's accepted media path/size constraints and transcode/crop only with user authorization if it changes the source.
- Direct downloads and `analyze_image`/`analyze_video` operate on file references; they are not a substitute for interacting with a browser page, nor do they inherit the browser profile.

## Change-review checklist
- [ ] Does every browser action start from fresh current session/page evidence?
- [ ] Are wait/navigation/modal states followed by a new observation?
- [ ] Does a login wall invoke the user-facing browser handoff rather than requesting a password in chat?
- [ ] Are browser modes/session sharing changes covered by continuity regressions?
- [ ] Are desktop app/window targets explicit and screenshots current before coordinate input?
- [ ] Does a macro verify its target window, replay state, and resulting UI without destructive steps?
- [ ] Do direct URL and supported media-page downloads use the right path separately?
- [ ] Does local media analysis avoid duplicate work when the model already sees the image?
- [ ] Are final claims backed by visible page/app state rather than a successful tool return?

## Ownership boundaries
- Website navigation and DOM/page interpretation belong to the browser session tools. Native window enumeration and OS inputs belong to the desktop wrappers.
- Media analysis/download calls work on URLs or local files and do not own browser tabs, passwords, site sessions, or app state.
- Browser session credentials remain in the controlled browser profile. Desktop screenshots may contain private information; report only what the task requires and avoid unnecessary screenshots/exports.
- Browser teach snapshots are workflow artifacts and need review before becoming a reusable process. They are not a general-purpose recorder of hidden account state.
- A successful website login is only one step in a connector connection; [12 Connectors & MCP](12-connectors-mcp-integrations.md) defines adapter setup and readiness verification.


## Additional safety notes
- Use the user's logged-in browser identity only for the requested site/task. Never harvest browser storage/cookies, export credentials, or move them into shell arguments.
- A screenshot can show account data or private messages. Keep evidence local and include only the specific portion necessary to confirm the requested outcome.
- Site terms and anti-abuse controls are still relevant: do not evade access controls or automate at a volume outside the intended user workflow.
- Browser downloads may include untrusted filenames/content. Use the provided download flow and inspect type/size before opening or executing anything locally.
- Desktop macros can type into any focused field, including the terminal or an account password box. Confirm window identity and target control immediately before macro replay.
- If a macro includes a high-impact click, leave that action for a separately reviewed/approved step rather than hiding it in a larger unattended sequence.
- A media-analysis result is model interpretation, not authoritative identity verification. Distinguish what is visibly present from uncertain inferences.
- Before altering or transcoding a user media file, preserve the original or use a separate output path; the analysis task normally does not require modifying the source.


## Current feature notes
- A browser profile is shared across subagent work by design; browser UI/chat selection follows the open conversation so users can see the active subagent's page. This is continuity behavior, not isolated per-agent cookie storage.
- The login card displays the URL/context and reason but keeps the user's password and OAuth interaction outside tool arguments. A post-handoff verification is still required.
- Desktop wrappers include separate screen, apps, window, input and macro action enums. The stable window/app identifiers come from list actions; use these rather than searching by guessed process name each time.
- The desktop wrapper maps convenience operations to lower-level native tools. If a wrapper operation is unavailable, inspect its dispatch table and the exact lower-level operation before falling back to raw coordinate input.
- `analyze_image` can display the target image directly to a vision-capable turn; for screenshots of a live browser or desktop, prefer the browser/desktop screenshot wrapper because it carries current session/window context.
