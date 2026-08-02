# Prometheus Full Product, Architecture, Security, and Quality Audit

**Repository:** `C:\Users\rafel\PromSRC`  
**Audit date:** 2026-07-10  
**Audited state:** the current working tree, including existing uncommitted changes  
**Prepared by:** GPT-5.6 Sol / Codex audit team  
**Report status:** evidence-backed static and local-runtime review; no product source was modified

## Executive verdict

Prometheus is an unusually ambitious local AI operating layer. It already combines a serious chat runtime, multi-provider model routing, tools, browser and desktop automation, mobile pairing, tasks, schedules, teams, memory, connectors, extensions, voice, and a broad creative suite. The core idea is compelling and several underlying designs are strong.

The main problem is no longer a shortage of features. It is that product breadth has outrun security boundaries, test coverage, packaging reliability, and maintainability.

The current checkout should **not be treated as release-ready or safe for remote exposure**. There are multiple confirmed release blockers:

1. A remote client can self-create, self-approve, and collect a pairing credential because all pairing administration is public.
2. Unvalidated session/project IDs can traverse filesystem paths for read/write/delete, while the task path independently permits out-of-store deletion.
3. Model/user-controlled markup reaches unsanitized `innerHTML` and same-origin scripted iframes, enabling privileged-origin execution. When a configured creative worker carries the gateway bearer in its URL, that adds a conditional credential-exfiltration chain.
4. Electron's internal-origin test is a bypassable string prefix check; if XSS, a redirect, or another primitive induces main-window navigation, a remote page can load with Prometheus preload privileges.
5. The private Windows build and Docker build are structurally broken before runtime testing.
6. There is no meaningful CI or automated regression suite protecting a very large and privileged codebase.

The correct strategic move is a stabilization phase: temporarily stop expanding the public feature surface, close the critical boundaries, establish trustworthy packaging and tests, then simplify the largest modules and overlapping subsystems.

### Overall scorecard

| Area | Assessment | Why |
|---|---|---|
| Product vision and breadth | Strong | A differentiated local AI control plane already exists. |
| Core TypeScript compile health | Good | Strict TypeScript compilation passes. |
| Desktop/mobile visual direction | Good | Both surfaces render and are visually coherent. |
| Security posture | Critical | Confirmed remote pairing takeover, traversal, privileged-origin XSS/isolation, and Electron-origin defects. |
| Release readiness | Critical | Private installer, Docker, local updater artifacts, signing, and tests are not reliable. |
| Runtime correctness confidence | Poor | Important red tests are stale; critical behavior has almost no automated coverage. |
| Maintainability | Poor | Several 18k-41k-line god modules and extensive global browser state. |
| Performance/scalability | Weak | Large eager UI graphs and full synchronous session rewrites block the gateway. |
| Repository hygiene | Critical | About 2 GB of tracked workspace material, nested dependencies, binaries, and orphan gitlinks. |
| Self-documentation coverage | Excellent | The intent and operational history are unusually well documented. |
| Self-documentation accuracy | Mixed | Multiple competing, stale, and contradictory sources of truth. |

## Immediate containment before any code work

Until the critical fixes are merged and independently tested:

1. Bind the gateway to `127.0.0.1` only.
2. Disable Tailscale Funnel, public remote access, LAN binding, and port forwarding for gateway ports.
3. Do not distribute the current Windows installer or updater metadata.
4. Treat existing paired devices and gateway URLs/tokens as potentially exposed; revoke and rotate them after the pairing/auth patch is deployed.
5. Do not open untrusted generated HTML, model-authored visuals, or imported workspace pages inside the privileged app.
6. Preserve the dirty working tree before remediation. Do not run broad cleanup, reset, or deletion commands against the current workspace.
7. Run a dedicated secret scanner over Git history and tracked workspace logs, then rotate anything confirmed live.

Loopback binding is containment, not a complete fix. It removes direct network reachability, but privileged-origin XSS, permissive `Origin: null`/localhost trust, and the loopback-only unauthenticated shutdown path remain reachable from malicious local browser content.

## Scope, evidence standard, and limitations

### Scope reviewed

- `src/`: gateway, providers, tools, auth, security, extensions, persistence, agents, scheduling, voice, creative, and runtime code.
- `web-ui/`: desktop UI, mobile PWA, service worker, settings, chat, creative editors, and shared utilities.
- `electron/`: main process, preload bridges, embedded browser surface, startup, updater, and process management.
- Build/release configuration: `package.json`, TypeScript/ESLint, Docker, Compose, Electron builders, runtime manifest, and release verifier.
- Repository structure, Git state, dependencies, tracked artifacts, nested repositories, and submodules.
- All material under `workspace/self/`, plus `workspace/SELF.md`, the legacy SELF document, feature indexes, creative docs, and public-release runbooks.
- Safe local runtime behavior at `127.0.0.1:18789`, including desktop and 390x844 mobile UI rendering.

### Finding labels

- **Confirmed defect:** directly demonstrated by code path, local runtime behavior, or a failing check.
- **Confirmed security boundary failure:** an authorization, isolation, or injection path proven from source and/or safe local requests.
- **Conditional risk:** code supports the failure, but exploitation needs a specific provider, remote exposure, OS behavior, or malicious input.
- **Product gap/debt:** missing capability, test, documentation, or architecture work rather than a single broken line.

### Important checkout caveat

The repository was already heavily dirty: 72 tracked files had changes and Git reported 58 untracked entries/groups. The diff contained about 5,434 added and 1,270 deleted lines. Findings describe the current working state and may include unfinished work. This audit did not reset, rewrite, or attribute those changes.

### What was not done

- No destructive exploit was run.
- No credential values were printed or copied.
- No remote account, provider, social, payment, or deployment mutation was performed.
- Docker was not installed on this machine, so deterministic Docker failures were verified from the build lifecycle rather than by executing an image.
- A clean-machine installer smoke test was not possible because the existing artifact set is internally inconsistent.

## System map

```text
Electron desktop / Mobile PWA / Browser UI / CLI / Telegram
                         |
                         v
                Express + WebSocket gateway
                |          |             |
                |          |             +--> Voice / Realtime
                |          +--> Chat orchestration / context / compaction
                |                         |
                |                         +--> Provider adapters / model routing
                |
                +--> Tool registry and executor
                |      | browser | desktop | files | shell | MCP | connectors
                |
                +--> Tasks / schedules / teams / subagents / goals / Brain
                |
                +--> Creative image/video/HTML-motion/HyperFrames/Remotion
                |
                +--> .prometheus state + workspace files + SQLite/JSON stores
```

This breadth is the product advantage, but it also means a single auth, XSS, path, or tool-policy mistake crosses many downstream capabilities. Security boundaries must be explicit and shared rather than inferred independently in each subsystem.

## Repository and validation snapshot

### Size and concentration

- 577 application/config files across `src`, `web-ui`, Electron, scripts, native, and integrations, excluding `web-ui/vendor`.
- 378,248 non-empty source/config lines using that broad file set (`Get-Content | Measure-Object -Line`); the per-file table below uses physical line counts, including blank lines.
- 7,168 tracked Git entries totaling about 2.0 GB in the working tree.
- `workspace/` alone: 6,225 tracked entries and about 1.91-1.96 GB.
- Git pack size: about 455.65 MiB.

Largest first-party modules observed:

| File | Approx. lines |
|---|---:|
| `web-ui/src/pages/ChatPage.js` | 40,803 |
| `web-ui/src/mobile/mobile-pages.js` | 29,206 |
| `src/gateway/agents-runtime/subagent-executor.ts` | 19,954 |
| `src/gateway/routes/chat.router.ts` | 17,908 |
| `web-ui/src/styles/mobile.css` | 12,333 |
| `src/gateway/browser-tools.ts` | 9,694 |
| `web-ui/index.html` | 8,163 |
| `src/gateway/routes/canvas.router.ts` | 7,972 |
| `src/gateway/comms/telegram-channel.ts` | 7,690 |

### Validation results

| Check | Result | Interpretation |
|---|---|---|
| `npm run build` | Pass, ~86.8s | TypeScript and UI-sync build succeeds; build latency is high. |
| `npm run lint` | Pass, ~31.7s | Syntax/type-aware parse succeeds, but ESLint has no substantive rules and checks only `src/**/*.ts`. |
| ESLint over `web-ui/src`, `electron`, `scripts` | Pass | Mainly proves parsing because the ruleset is empty. |
| Node syntax check for Electron main/preloads | Pass | The JavaScript parses; behavior/security still require Electron tests. |
| Public web UI source/generated sync | Pass | The duplication guard currently catches drift. |
| `test-ui-action-policy.mjs` | Pass | Existing final-action categories behave as expected in covered cases. |
| `test-creative-command-bus.js` | Pass | Creative command bus basic checks work. |
| `test-hyperframes-roundtrip.mjs` | Pass | Parse/normalize/roundtrip path works. |
| Production HyperFrames helper render | Pass | The compiled production entry logged frames 1/24 through 24/24 and produced ignored artifact `.prometheus/creative/hyperframes-test/production-helper-audit.mp4` (27,658 bytes). |
| `test-hyperframes-catalog-pipeline.mjs` | Fail | Test invokes producer differently from production; this is primarily a stale/broken test. |
| `test-desktop-registry-parity.mjs` | Fail | Test assumes direct switch cases and misses wrapper normalization; alternate legacy registry parity still needs resolution. |
| Extension verification | Misleading pass | Bundled extensions validate, but user-plugin scanning throws an initialization error that is swallowed. |
| `npm audit --omit=dev` | Fail | 35 production advisories: 16 high, 19 moderate. |
| Full `npm audit` | Fail | 51 total advisories: 30 high, 19 moderate, 2 low. |
| Existing public release verification | Fail | Local 1.0.9 installer hash/size does not match `latest.yml`. |
| `/health` | 404 | Docker and Compose healthchecks target a nonexistent route. |
| `/api/health` | 200 | Implemented liveness route works. |
| Local desktop UI | Pass | Desktop chat shell loaded with no captured console warnings/errors. |
| Local mobile UI | Partial | Mobile pair screen renders, but accessibility and pairing lifecycle defects were confirmed. |

## What is working well

These strengths should be preserved during refactoring:

1. **Strict TypeScript compilation succeeds.** The backend is not in a generally uncompilable state.
2. **Provider and extension descriptors are a good foundation.** `src/providers/provider-registry.ts` and extension schemas provide a path toward generated, canonical catalogs.
3. **Bundled extension consistency is strong.** The verifier saw 14 connectors and 108 connector tools with no descriptor consistency errors.
4. **Electron uses important secure defaults.** The main and embedded browser views set `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
5. **The vault is thoughtfully designed.** AES-256-GCM, random IVs, authenticated decryption, atomic persistence, and Electron `safeStorage` sealing are strong choices.
6. **Pairing tokens are hashed at rest.** Device token comparison is timing-safe.
7. **OpenAI OAuth already has useful race protection.** Its refresh singleflight/rotated-token handling is a model for xAI and MCP refresh work.
8. **AsyncLocalStorage is already used for active workspace context.** The isolation primitive is right even though not every execution path respects it.
9. **The action policy and durable approval work are valuable.** The covered UI-action rules pass, and actual approval persistence is more advanced than some docs claim.
10. **WebSocket broadcasting includes backpressure limits.** This is better than unbounded broadcasting.
11. **Some persistence code already uses atomic replacement.** Task index and cron store patterns can be reused elsewhere.
12. **Public packaging has a deliberate dependency model.** The public builder, runtime manifest, bundled Chromium, fonts, FFmpeg/FFprobe, and verifier show good operational thinking even though closure is incomplete.
13. **Release verification catches real defects.** It correctly rejected the corrupted/stale local 1.0.9 artifact set.
14. **Desktop and mobile have a coherent visual identity.** Local visual inspection showed a polished foundation rather than an unfinished mockup.
15. **The SELF documentation is unusually valuable.** It captures intent, history, sharp edges, and desired target architecture that would otherwise be lost.

## Critical security findings

### SEC-01 — Remote clients can self-pair and obtain full gateway authority

**Severity:** Critical  
**Status:** Confirmed security boundary failure  
**Exposure:** Any gateway reachable over LAN, Tailscale/Funnel, port forwarding, container networking, or another non-loopback interface

Pairing is mounted before gateway and account authorization at `src/gateway/server-v2.ts:786-793`. The router explicitly states that every endpoint except `/api/pairing/me` is open at `src/gateway/routes/pairing.router.ts:18-22`.

An unauthenticated network caller can:

- Create a challenge: `pairing.router.ts:168-203`.
- Claim it: `pairing.router.ts:226-269`.
- Poll the credential: `pairing.router.ts:272-290`.
- Approve its own claim: `pairing.router.ts:299-306`.
- Deny claims and list/change/revoke devices: `pairing.router.ts:308-336`.
- Read/change remote-access state and invoke Tailscale Funnel operations: `pairing.router.ts:380-411,417-497`.

The claim endpoint checks only the process-global account session (`pairing.router.ts:228-230`). Account login routes are themselves exempted from gateway authentication (`src/gateway/gateway-auth.ts:120-143`) and replace the one global account session (`src/gateway/routes/account.router.ts:422-474`). Any valid paired token is then accepted as complete gateway authentication before a configured gateway token is checked (`gateway-auth.ts:145-166`).

This means the same caller can perform both halves of the intended approval handshake. It can log the process into an account it controls, create/claim/approve a challenge, collect the plaintext device token, and use that token against protected APIs.

The pairing store also removes only expired challenges/pending requests (`src/gateway/pairing/pairing-store.ts:160-166`). Approved and denied requests remain in memory, approval temporarily stores the plaintext token (`:270-298`), and consumption clears only the token rather than the request (`:309-316`). Without rate/count limits, the public chain also permits unbounded terminal request/device growth.

**Impact:** Full API and tool access, chat/session access, files and shell through agent surfaces, device revocation, global account replacement, and remote-access/Funnel control.

**Required fix:**

1. Split public handshake routes from privileged desktop administration.
2. Keep only claim, poll, and certificate retrieval public.
3. Put QR creation, pending-list, approve/deny, device management, remote-access settings, and Tailscale commands behind authenticated desktop authority.
4. Prefer Electron IPC or an unpredictable loopback renderer secret for desktop-only administration.
5. Do not exempt account login from a configured gateway bearer token on remotely reachable listeners.
6. Bind claims to a secret proof not returned through the public request ID.
7. Give phone credentials explicit scopes; a mobile chat token must not imply shell/admin authority.
8. Add strict per-IP/account rate limits and an end-to-end negative takeover test.
9. Delete terminal requests after a bounded poll window, cap device/request counts, and erase plaintext credentials immediately after one-time delivery.

### SEC-02 — Session, project, and task IDs permit filesystem traversal

**Severity:** Critical  
**Status:** Confirmed  
**Precondition:** Authenticated API access; SEC-01 supplies a remote path when exposed

Several stores concatenate unvalidated request IDs into filesystem paths.

#### Sessions

- Path construction: `src/gateway/session.ts:628-630`.
- Read: `session.ts:1565-1575`.
- Touch/write: `session.ts:1115-1126`.
- Delete: `session.ts:2164-2177`.
- Flush: `session.ts:2344-2386`.
- Transcript/compaction paths repeat the pattern: `session.ts:1299-1302,1345-1348`.
- Arbitrary IDs enter from chat/session routes, including `src/gateway/routes/chat.router.ts:17232-17246,17548-17570,17886-17903`.

An ID such as `../config` resolves outside the sessions directory. Encoded separators matter because Express decodes route parameters.

#### Projects

- Project ID becomes metadata and workspace paths: `src/gateway/projects/project-store.ts:63-76`.
- Raw JSON load: `project-store.ts:100-126`.
- Routes pass `req.params.id` directly: `src/gateway/routes/projects.router.ts:91-115,148-175`.
- Removing a project session deletes the supplied session even when it is not a member: `project-store.ts:265-277`, route `projects.router.ts:131-136`.
- Knowledge metadata stores and later trusts an absolute path (`project-store.ts:302-338`). This is a conditional integrity path requiring tampered metadata or another write primitive; the normal upload API generates a confined path.

#### Tasks

- Task path: `src/gateway/tasks/task-store.ts:404-406`.
- Unconditional delete: `task-store.ts:1123-1163`.
- Route: `src/gateway/routes/tasks.router.ts:540-543`.

**Impact:** Session/project traversal enables authenticated read, overwrite, corruption, or deletion outside the intended store. The task path proves unconditional out-of-store deletion, not arbitrary task-backed read/write. Project-session removal can delete an unrelated session, and tampered knowledge metadata can extend the integrity impact.

**Required fix:**

- Create one opaque ID validator used by every route and store.
- Allow only a bounded alphabet such as `^[A-Za-z0-9_-]{1,128}$` where compatible.
- Decode exactly once at the HTTP boundary, validate the resulting opaque ID, and reject `/`, `\`, `..`, drive prefixes, UNC paths, and control characters. Do not recursively decode attacker input.
- Resolve a candidate and prove it remains beneath the canonical root before every read or mutation.
- Generate IDs server-side wherever possible.
- Require parent-child membership before deletion.
- Store root-relative knowledge paths and reconfine them on every use.
- Add Windows and POSIX regression tests for `%2f`, `%5c`, mixed separators, double-encoded inputs that must remain invalid after one decode, drive paths, junctions, and UNC forms.

### SEC-03 — Untrusted markup can execute in the privileged app origin and may expose gateway credentials

**Severity:** Critical  
**Status:** Confirmed execution/isolation primitives; credential exfiltration is conditional

There are several mutually reinforcing injection paths:

1. Markdown is parsed with `marked.parse()` and assigned to `innerHTML` without a sanitizer in `web-ui/src/utils.js:545-579` and `web-ui/src/pages/ChatPage.js:7318-7352,11468-11483`. The same rendering path reaches mobile messages (`web-ui/src/mobile/mobile-pages.js:1869-1885`) and task content (`web-ui/src/pages/TasksPage.js:529,550,609`).
2. AI visual blocks use `srcdoc` with `sandbox="allow-scripts allow-same-origin"` at `utils.js:145-175,443-445,502-520`. A scripted same-origin iframe is not meaningfully isolated from its parent. Mermaid is also configured with `securityLevel: 'loose'` at `utils.js:424`.
3. Desktop workspace preview removes the sandbox for binary/document previews and applies `allow-scripts allow-same-origin` to non-binary previews (`web-ui/src/pages/ChatPage.js:36417-36426`); raw HTML reaches `frame.srcdoc` at `:36548`. Both branches need an explicit trust boundary. HTML-motion preview uses the unsafe scripted/same-origin combination (`ChatPage.js:27821-27847`). Mobile live web canvas additionally allows forms and popups (`web-ui/src/mobile/mobile-shell.js:2000-2004`).
4. When gateway authentication is configured and `resolveGatewayAuthToken()` returns a token, the headless creative renderer places the full bearer in a worker URL query (`src/gateway/routes/canvas.router.ts:1633-1646`). The UI retains it in `location.search` and `window.__PROM_CREATIVE_RENDER_CONTEXT` (`web-ui/index.html:246-257`). Exfiltration additionally requires attacker-controlled content to execute in that worker page.
5. Hundreds of inline event handlers embed HTML-escaped data into JavaScript contexts. Project creation accepts an arbitrary name (`src/gateway/routes/projects.router.ts:85-87`) and project names enter `onclick` at `web-ui/src/pages/ProjectsPage.js:188-233`. HTML entity decoding happens before inline-handler compilation, so a harmless demonstrator shape such as `x');alert(1);//` crosses the source-to-sink path. Similar patterns exist in the index skill handlers and Connections, Teams, Tasks, and Subagents pages.
6. The shared `log(text)` helper writes unescaped text through `innerHTML` (`web-ui/src/utils.js:132-139`). This is a sink requiring call-site review; the audit did not establish an attacker-controlled path to it, so it is not counted as a separate confirmed XSS.

**Impact:** Model output, imported/generated HTML, project names, messages, or compromised content can execute in the gateway origin, access the parent DOM and local storage, call local APIs, read pairing/account state, and reach Electron preload bridges. In a configured creative worker carrying the bearer query parameter, the same class of execution can exfiltrate that credential. This collapses the boundary between "preview untrusted content" and "control the local AI operator."

**Required fix:**

1. Sanitize all rendered markdown/HTML with a maintained sanitizer and a minimal allowlist; disallow event attributes, scripts, dangerous URLs, SVG script surfaces, and unsafe style constructs.
2. Never combine `allow-scripts` and `allow-same-origin` for untrusted `srcdoc`.
3. Serve creative/generated previews from a distinct unprivileged origin or protocol with no app cookies/storage/preload access. Communicate only through a validated `postMessage` contract.
4. Remove gateway credentials from URLs and globals. Use scoped, ephemeral headers or an isolated renderer channel.
5. Replace inline handlers with `addEventListener`/delegation and data attributes. Use context-specific encoding only where templating remains.
6. Add malicious-markdown, malicious-SVG, malicious-srcdoc, and malicious-name tests in both browser and Electron builds.
7. Add a restrictive CSP after inline code is removed or nonce-hardened.

### SEC-04 — Electron's internal-origin check is bypassable

**Severity:** Critical  
**Status:** Confirmed prefix-validation defect; full remote-preload compromise needs a navigation primitive

The main window treats any navigation whose raw string starts with `http://127.0.0.1:18789` as internal (`electron/main.js:1405-1409`). A URL using that text as credentials, such as the equivalent of `http://127.0.0.1:18789@external-host`, passes the prefix test while its parsed host is external.

If app-origin XSS, a trusted-page redirect, or another navigation primitive sends the main window there, the external page would load with Prometheus's preload APIs. The window-open handler also forwards arbitrary schemes to `shell.openExternal` without a protocol allowlist (`electron/main.js:1400-1408`). IPC handlers at `electron/main.js:1288-1351` do not consistently validate the owning `webContents`, main-frame identity, and parsed origin.

**Impact:** Conditional on an induced main-window navigation, remote code can gain file-dialog, native-browser, updater, and app-metadata bridges. Unsafe external schemes can launch local protocol handlers.

**Required fix:**

- Parse every URL and require exact `origin === new URL(GATEWAY_URL).origin`, plus the expected protocol/path rules.
- Reject credentials, non-HTTP(S) schemes, and malformed URLs.
- Permit only `https:` (and narrowly justified `http:`) in `shell.openExternal`.
- Require `event.sender === mainWindow.webContents`, the expected main frame, and an exact parsed origin in every privileged IPC handler; do not rely on `senderFrame.url` alone.
- Prefer a custom secure app protocol so the trusted renderer origin is not an ordinary localhost URL.
- Add Electron tests for username/password URL confusion, alternate ports, encoded hosts, redirects, and compromised renderer calls.

## High-severity security and isolation findings

### SEC-05 — Loopback CORS/origin trust enables local-browser CSRF

**Severity:** High  
**Status:** Confirmed; exploitability varies by browser and local threat model

`src/gateway/gateway-auth.ts:83-105,172-193,205-213` trusts a missing Origin, literal `null`, `file://`, and any `localhost`, `127.0.0.1`, or `::1` origin regardless of port. Safe local requests confirmed that `Origin: null` and `http://localhost:9999` could read the protected task API while an account session was active.

The shutdown route checks only TCP peer loopback (`src/gateway/server-v2.ts:750-757`), so a cross-origin form or `no-cors` request can trigger it. Pairing credentials are also accepted from `?pt=` on ordinary HTTP requests (`gateway-auth.ts:149-159,196-203`), leaking long-lived tokens through history, logs, screenshots, proxies, and referrers.

**Fix:** Use an exact scheme/host/port allowlist, never globally trust `null`/`file://`, validate `Sec-Fetch-Site`, add CSRF tokens to state changes, move shutdown to authenticated IPC, and allow query auth only in a narrowly controlled WebSocket handshake if unavoidable.

### SEC-06 — Raw status fast paths bypass Express authorization

**Severity:** Medium information disclosure  
**Status:** Confirmed in source and local runtime

`src/gateway/core/server.ts:249-330` handles `/api/health`, `/api/status`, and `/api/system-stats` before Express at `core/server.ts:340-358`. The protected Express status route (`src/gateway/server-v2.ts:726-748`) is therefore bypassed for normal GET/HEAD requests.

Local unauthenticated requests returned provider, active model, search-provider presence, absolute workspace path, memory/GPU/process statistics, and process RSS. The richer Express health implementation at `src/gateway/core/app.ts:40-56` is effectively dead for ordinary GETs.

**Fix:** Keep only a minimal public liveness response. Route status and system information through the normal auth/account middleware and remove duplicate implementations.

### SEC-07 — Tool side-effect policy fails open and matches by substring

**Severity:** High  
**Status:** Confirmed

Policy uses first-match substring rules (`src/gateway/policy.ts:208-224`), and unknown tools default to `READ`/pass-through (`policy.ts:198-205`). The small rule list (`policy.ts:23-111`) cannot safely classify a dynamic tool ecosystem.

Examples identified in review:

- X create/like mutations can default to `READ`.
- `x_api_delete_list` can match a read rule because its name contains `list`.
- Some deletes become `PROPOSE`, while only `COMMIT` reaches the blocking approval path.
- Arbitrary MCP mutations default to `READ` unless their names happen to match a small allowlist.
- Generic X POST/PUT/DELETE handlers execute mutations (`src/gateway/tools/handlers/xai-handlers.ts:918-1011`) without a second handler-level approval boundary.

**Fix:** Put explicit capability metadata on every tool (`readOnly`, `localWrite`, `externalWrite`, `destructive`, `credentialUse`), fail unknown tools closed, classify generic HTTP by method/target, enforce approvals again at the final dispatcher, and generate an exhaustive test over every registered tool.

### SEC-08 — `apply_patch` validates one workspace but edits another

**Severity:** High  
**Status:** Confirmed

Validation resolves against AsyncLocalStorage's active workspace (`src/tools/files.ts:299-316`), while execution selects the global configured workspace (`files.ts:1188-1220`; helper CWD `files.ts:319-325`). A scoped agent can validate `foo.ts` in its workspace and apply the patch to a different global workspace.

**Fix:** Derive validation, Git root, helper CWD, and final edit from one immutable active-workspace context. Reject a Git root outside it and test with two concurrent workspaces.

### SEC-09 — Lexical workspace checks follow symlinks and Windows junctions outside the root

**Severity:** High  
**Status:** Confirmed primitive

File and shell confinement relies on `path.resolve`/`path.relative` without canonical `realpath` checks (`src/tools/files.ts:166-228,388-398,478-505,668-677,976-990`; `src/tools/workspace-context.ts:105-124`; `src/tools/shell.ts:48-85,110-175`). A symlink or junction inside the allowed workspace can point elsewhere, and subsequent operations follow it.

**Fix:** Canonicalize the root and nearest existing target ancestor, reject reparse-point traversal for mutations unless explicitly authorized, recheck the final target before opening, and add Windows junction plus POSIX symlink tests.

### SEC-10 — Realtime and voice routes bypass the account gate

**Severity:** High credential/cost boundary inconsistency  
**Status:** Confirmed

Despite the comment that everything else requires account access, `realtimeRouter` and `voiceRouter` are mounted with only `requireGatewayAuth` at `src/gateway/server-v2.ts:790-796`. On the default tokenless loopback gateway, they are usable without account authentication. When paid-provider credentials are saved/configured, realtime can mint client secrets and proxy calls (`src/gateway/routes/realtime.router.ts:331-375`), while voice routes can invoke TTS/STT.

**Fix:** Add `requireAccountAccess`, explicit per-route scopes, rate/cost limits, and tests proving logged-out callers cannot mint provider sessions or consume paid voice APIs.

### SEC-11 — Request and WebSocket lifecycle hardening is insufficient

**Severity:** High availability risk when exposed  
**Status:** Confirmed

- Global JSON parsing occurs before auth with a 50 MB limit (`src/gateway/core/app.ts:34-38`).
- Request and socket timeouts are disabled (`src/gateway/core/server.ts:374-382`).
- Unknown upgrade paths are not explicitly closed (`core/server.ts:392-405`; voice listeners also return on mismatch).
- Public login and pairing routes lack meaningful rate limits.
- WebSockets authenticate only at connection time (`core/server.ts:459-472`) and remain open after logout, account invalidation, or device revocation even though they expose powerful control actions (`core/server.ts:702-755,894-897`).

**Fix:** Use route-specific limits, restore request/idle/handshake deadlines, centralize upgrade routing, close unknown sockets, cap connections, rate-limit public endpoints, associate sockets with principals/device IDs, and close/revalidate them on revocation.

### SEC-12 — Teach mode executes live actions and records sensitive fields

**Severity:** High privacy and user-expectation failure  
**Status:** Confirmed

The UI promise at `web-ui/src/pages/ChatPage.js:3575-3598` describes staged/pending behavior, while the implementation note at `:3017-3020` explicitly says the browser captures real click-through. The embedded preload intentionally lets captured clicks execute live and records them afterward (`electron/inhouse-browser-preload.js:78-93`). Element text/value capture at `inhouse-browser-preload.js:48-69,101-125` does not exclude password, payment, token, recovery-code, or other secret inputs, and synthetic events are not rejected.

Capture state changes before a fire-and-forget IPC Promise settles (`ChatPage.js:2977-2994`), so the synchronous `try/catch` cannot handle rejection. Electron can catch a native automation failure yet still return `{ok:true}` (`electron/main.js:944-952`). Captured events are attributed through global `nativeBrowserState.sessionId` rather than validating and mapping `event.sender` (`electron/main.js:1318-1343`), creating wrong-session attribution under profile changes or races.

**Impact:** A user teaching a workflow can submit a live action they believed was staged and persist passwords or secrets in macro/workflow data.

**Fix:** Align copy and behavior; default to non-executing capture for risky actions; ignore untrusted synthetic events; categorically drop/redact password, payment, token, recovery-code, and secret fields; await IPC and propagate real failure; bind events to a validated sender/session; and encrypt/scoped-store any nonsensitive retained workflow inputs. Confirmation is not an adequate control for recording secrets.

### SEC-13 — Authorization material appears in renderer logs or replayable contexts

**Severity:** Medium credential-hygiene/lifecycle defect  
**Status:** Confirmed contexts; external persistence of renderer-console logs was not established

- Settings logs raw MCP authorization headers to the renderer console at `web-ui/src/pages/SettingsPage.js:4523-4533`; the audit did not prove those console entries are persisted or exported.
- Creative render context places the gateway token in a URL/global (covered in SEC-03).
- Normal HTTP accepts a pairing token in the query string (SEC-05).
- MCP sessions retain resolved Authorization headers long-term (`src/gateway/mcp-manager.ts:519-540,581-625`), primarily a refresh/staleness lifecycle defect rather than an independently proven leak.

**Fix:** Redact all auth headers before logging, prohibit credentials in URLs and browser globals, retrieve MCP access tokens per call, and add centralized structured-log scrubbing tests.

### SEC-14 — OAuth and MCP refresh/endpoint validation have correctness and SSRF gaps

**Severity:** High/Medium depending on integration
**Status:** Confirmed implementation defects; rotation-loss and SSRF outcomes are conditional

- xAI refresh has no singleflight protection; with overlapping refreshes and rotating/single-use token behavior, one failure can clear a newly rotated credential (`src/auth/xai-oauth.ts:134-186,337-356`).
- Manual OpenAI OAuth shadows the requested local account ID with a remote claim and can save under the wrong slot (`src/auth/openai-oauth.ts:527-577`).
- MCP headers go stale because the access token is resolved at connection and reused (`src/gateway/mcp-manager.ts:519-540,581-668`).
- MCP OAuth discovery trusts advertised metadata/token endpoints without sufficient HTTPS, issuer, redirect, same-origin, or private-address validation (`src/gateway/mcp-oauth.ts:114-177,229-245`). SSRF requires malicious or compromised advertised OAuth metadata.

**Fix:** Copy OpenAI's refresh singleflight pattern to xAI, preserve local account identity separately from provider claims, refresh MCP per call or once on 401, require HTTPS/issuer consistency for remote MCP, and reject private/link-local metadata targets unless an explicit local-MCP mode is enabled.

### SEC-15 — Account validity and socket validity can outlive revoked credentials

**Severity:** High/Medium  
**Status:** Confirmed behavior

An expired access token with any refresh token remains authenticated (`src/gateway/routes/account.router.ts:507-531`), and failed refresh paths deliberately preserve the process-global session (`account.router.ts:341-365,394-416`). A definitively revoked credential may therefore leave local protected APIs available until logout. Open WebSockets are not closed when that session or a device is revoked.

Separately, `/api/account/status` is exempt from gateway authentication (`src/gateway/gateway-auth.ts:129-134`) and can disclose email, user ID, and admin state from `src/gateway/routes/account.router.ts:216-227,378-416`. This is a confirmed privacy/auth-parity defect even when no mutation authority follows from it.

**Fix:** Distinguish transient network failure from definitive `invalid_grant`, allow only a bounded offline grace, clear invalid sessions, bind each request/socket to a principal, and close all matching channels on logout/revocation.

### SEC-16 — Tracked runtime/tool logs need a real secret-history audit

**Severity:** Conditional high risk  
**Status:** Heuristic signal, not a confirmed live-secret disclosure

A redacted pattern-only scan found 82 tracked workspace files containing one of two repeated `sk-*`-shaped strings, primarily Brain/tool-result artifacts. No values were printed, and targeted review did not establish that either string is a live credential. The larger issue is that runtime tool outputs and reasoning artifacts are committed at all; any future credential echoed by a tool can be replicated across Git history.

**Fix:** Run Gitleaks/TruffleHog against the full history, rotate anything confirmed live, untrack temp/tool-result/log directories, scrub logs before persistence, and add secret scanning to CI and pre-commit hooks.

### SEC-17 — Browser security headers are absent

**Severity:** Medium defense-in-depth gap  
**Status:** Confirmed in source and live response headers

`src/gateway/core/app.ts:34-75` configures CORS, JSON, and static serving without CSP or equivalent hardening. Local response inspection found no `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, or `X-Frame-Options`/`frame-ancestors` protection.

The UI currently contains many inline scripts and hundreds of inline event attributes, so a useful strict CSP cannot simply be switched on without refactoring.

**Fix:** Remove inline scripts/handlers, adopt nonce/hash CSP and Trusted Types, set `object-src 'none'`, restrictive `base-uri`, route-appropriate `frame-ancestors`/`frame-src`, Referrer Policy, Permissions Policy, and MIME-sniffing protection. Evaluate COOP/CORP per route because blanket settings can break intended iframe/creative integrations; test Electron/PWA/creative surfaces under enforcement rather than report-only mode.

## Build, packaging, correctness, and reliability findings

### REL-01 — The private Windows installer cannot start its gateway

**Severity:** Critical release blocker  
**Status:** Confirmed from configuration

- `npm run build:win` does not build the backend (`package.json:31`).
- Packaged startup assumes `resources/app.asar/dist/gateway/server-v2.js` (`electron/main.js:46-53`).
- The private builder does not include `dist` and explicitly excludes it (`electron-builder.yml:9-18,59`).
- The private builder sets `asar: false` (`electron-builder.yml:88-90`), so the hard-coded `app.asar` root does not exist anyway.

**Fix:** Make packaging depend on a clean backend/UI build, include `dist`, resolve roots with `app.getAppPath()`, align ASAR configuration, and run a real installed-app smoke test that waits for a versioned `/api/health` response.

### REL-02 — Docker build and documented Docker startup are deterministically broken

**Severity:** Critical distribution-path defect  
**Status:** Confirmed from Docker/npm lifecycle; Docker unavailable locally

The builder copies only package files before `npm ci` (`Dockerfile:13-14`), but `npm ci` runs `postinstall`, which calls `scripts/postinstall.js`; `scripts/` has not been copied. Later, `npm run build` runs before `scripts/`, `web-ui/`, and generated UI inputs exist (`Dockerfile:16-19`).

Additional confirmed defects:

- Healthchecks use `/health`, while only `/api/health` exists (`Dockerfile:112-113`, `docker-compose.yml:143-144`). A live local request confirmed `/health` returns 404.
- Compose mounts OAuth/config state to `/root/.prometheus`, but `PROMETHEUS_DATA_DIR=/data` resolves the active config beneath `/data/.prometheus` (`docker-compose.yml:102-114`; `src/config/config.ts:63-68`).
- Ollama is the default provider but its service is profile-only; documented plain `docker compose up -d` does not start it (`docker-compose.yml:27-32,117-123`).
- `.env.example` advertises xAI and memory variables that Compose does not pass into the app.
- The runtime image serves root `/assets` in code but does not copy the root assets directory.
- Playwright install failure is swallowed with `|| true`, allowing a successful image with a broken required browser feature.

**Fix:** Reorder COPY/install/build stages, use `npm ci --ignore-scripts` only if postinstall is invoked deliberately later, copy every build input, add a Docker build/start test to CI, use one config mount, correct the health route, make provider profiles match the quick start, pass documented variables, and fail on missing required Chromium.

### REL-03 — Node 20 conflicts with installed HyperFrames engine requirements

**Severity:** High supported-runtime defect  
**Status:** Confirmed version-contract mismatch

The current shell and Docker use Node 20 (`Dockerfile:9,22`), while installed `@hyperframes/engine`, `@hyperframes/producer`, and `hyperframes` declare Node 22 requirements in their package metadata. A dry-run dependency operation reported `EBADENGINE`.

The actual production helper rendered successfully under this specific Node 20 environment, but that does not make the version supported; updates or less-traveled paths can fail.

**Fix:** Decide one supported Node major. Prefer moving development/Docker to Node 22 and verifying Electron compatibility, or pin HyperFrames to a release that explicitly supports the embedded/runtime Node. Add `package.json.engines` and CI across every shipped runtime.

### REL-04 — User extension scanning fails but verification exits successfully

**Severity:** High functional defect and false-green check  
**Status:** Confirmed

`npx tsx scripts/verify-extensions.ts` reported zero extension consistency errors while also logging:

```text
[extensions] Failed to scan user plugins dir: Cannot access 'configInstance' before initialization
```

`src/extensions/loader.ts:3,32-38` calls `getConfig()` during a circular initialization. `src/config/config.ts:70-75` already exposes an early-safe resolved config directory, but the loader does not use it. `src/extensions/registry.ts:62-67` suppresses the error and returns an empty user list.

**Impact:** User plugins silently disappear, live logs repeatedly show scan failures, and CI cannot detect the subsystem is broken.

**Fix:** Use the early-safe path helper, surface loader diagnostics as structured issues, and make verification fail when any configured extension root cannot be scanned.

### REL-05 — `integration_quick_setup` is advertised but has no executor

**Severity:** High model-facing broken contract  
**Status:** Confirmed and acknowledged by SELF docs

The tool is defined at `src/gateway/tools/defs/cis-system.ts:347-378`, included at `src/gateway/tool-builder.ts:933-935`, and prompted at `src/gateway/prompt-context.ts:781`, but no executor exists before unknown-tool handling near `src/gateway/agents-runtime/subagent-executor.ts:19948`. `workspace/self/10-mcp-and-connections.md:36-38` admits it is inert.

**Fix:** Implement and test it end to end or remove it from definitions, categories, prompts, UI, and docs. Never advertise a tool the runtime cannot execute.

### REL-06 — Command timeouts are marked successful

**Severity:** High agent-correctness defect  
**Status:** Confirmed

Both captured command branches use:

```ts
error: captured.code !== 0 && !captured.timedOut
```

at `src/gateway/agents-runtime/subagent-executor.ts:13636-13647,13664-13676`. A timeout therefore produces `error: false` even when the visible result says `TIMED OUT`.

**Impact:** Builds, tests, deploys, migrations, or verification steps can time out and still unlock downstream actions or a false completion claim.

**Fix:** Use `captured.timedOut || captured.code !== 0`, return structured termination reason/signal, and test success, nonzero, timeout, signal, and spawn error.

### REL-07 — Concurrent turns in one session can overlap and duplicate side effects

**Severity:** High  
**Status:** Confirmed

The chat route accepts a different request while a session is active (`src/gateway/routes/chat.router.ts:17232-17281`). `beginMainChatStream()` replaces the session's reconnectable stream record (`chat.router.ts:780-792,17283`), while both requests run live runtimes and mutate shared history (`chat.router.ts:17335-17436,8297-8417`).

**Impact:** Interleaved history, overwritten reconnect state, out-of-order completions, compaction races, and duplicate tool/external actions.

**Fix:** Add a per-session queue/mutex or return 409 for a second active turn; define explicit interruption semantics and keep client-request idempotency.

### REL-08 — Electron startup can kill an unrelated application

**Severity:** High data-loss risk  
**Status:** Confirmed on Windows path

Startup force-kills any PID listening on 18789 (`electron/main.js:349-369,484-486`) without proving it is a Prometheus process.

**Fix:** Prefer a dynamically assigned port. If fixed-port reuse is required, perform an authenticated ownership/instance handshake and request graceful shutdown only from a verified prior Prometheus process.

### REL-09 — API helper can replay sensitive mutations to localhost

**Severity:** High  
**Status:** Confirmed

`web-ui/src/api.js:14-41,71-98` retries failed `/api/*` requests against `http://127.0.0.1:18789` from non-local, non-HTTPS origins. It carries the body and pairing credential. A failed remote POST can therefore be replayed to Prometheus or another permissive local service, duplicating side effects or leaking data.

**Fix:** Enable local fallback only under an explicit Electron/dev capability, never retry non-idempotent methods automatically, and require an authenticated instance identity before fallback.

### REL-10 — Existing public 1.0.9 release artifacts are internally corrupt/stale

**Severity:** Critical for the current local release set  
**Status:** Confirmed by repository verifier

`npm run verify:public-release` rejected `release-public/Prometheus-Setup-1.0.9.exe` because its SHA-512 does not match `latest.yml`. The local executable is only about 268 KB, while metadata claims roughly 579 MB; its blockmap and `latest.yml` are older than the executable.

The verifier working is a strength. The artifacts must not be published or used for update testing.

**Fix:** Delete/regenerate release output only after preserving anything needed, build in a clean staging directory, make artifact generation atomic, verify hashes before publish, and smoke-test installation/update/rollback on a clean VM.

### REL-11 — PWA offline behavior does not match the generated public app

**Severity:** High user-visible reliability defect  
**Status:** Confirmed from service-worker/build paths

`web-ui/service-worker.js:24-50` precaches `/static/*` and `/src/*`, while fetch handling at `:131-157` does not serve `/static/` or `/vendor/`. Generated public UI imports `/static/*`; mobile also needs marked from `/vendor/`. Precache URLs omit query strings used by actual imports, and `cache.match()` is search-sensitive by default. Install suppresses all failures with `Promise.allSettled` and catches (`:52-58`), so a partial or empty offline shell can activate as "successful."

Update behavior adds risk:

- Manually maintained cache version and immediate `skipWaiting()`.
- Automatic reload on `controllerchange`, which can interrupt a draft, response, or voice operation.
- Cache purge reloads after a fixed 400 ms without awaiting the service worker acknowledgement.
- Mutable, unhashed assets receive one-day public caching.

**Fix:** Generate an exact content-hashed asset manifest, atomically cache the required graph, intercept `/static` and `/vendor`, test cold/warm offline boots, use user-coordinated activation/reload, and await purge/update acknowledgements.

### REL-12 — Mobile pairing route and polling lifecycle are broken

**Severity:** High/Medium  
**Status:** Confirmed

The router reads `?pair=` (`web-ui/src/mobile/mobile-router.js:57-61`) and forces the pair page (`:220-227`), while `mobileNavigate()` changes only the hash and preserves the query (`:125-132`). Cancel and Continue navigate to chat without consuming the query (`mobile-pages.js:25443-25450,25542-25544`), so pairing immediately reopens.

The 1.5-second polling loop can run for ten minutes without page cleanup or an AbortController (`mobile-pages.js:25542-25584`). Route changes can leave detached loops. A duplicate `if (!code)` block at `:25484-25493` is unreachable.

**Fix:** Remove the query with `history.replaceState`, maintain exactly one poll controller, abort it on route change/cancel/success, and delete the dead branch.

### REL-13 — Mobile pull-to-refresh binds only to the first drawer instance

**Severity:** Medium  
**Status:** Confirmed

`createMobileShell()` recreates the root/drawer (`web-ui/src/mobile/mobile-shell.js:748-799`), but `_wireDrawerPullToRefresh()` sets a module-global bound flag and never resets it (`:176-183`). New drawers receive no touch listeners after navigation.

**Fix:** Preserve the shell or track binding by element with a `WeakSet`/stored element reference.

### REL-14 — Toast and session-quota fallbacks produce incorrect UI state

**Severity:** Medium  
**Status:** Confirmed

- `showToast(title, body, type)` is defined at `web-ui/src/utils.js:69`, while dozens of callers pass `(message, 'error')` or `(message, 'success')`. The UI shows an info toast whose body literally says "error" or "success."
- Chat quota fallback says it retains recent sessions but applies `compact.slice(-8)` at `ChatPage.js:5683-5698`; sessions are newest-first at `:6387`, so it retains the oldest eight. It also replaces live `window.chatSessions` with a compact persistence projection.

**Fix:** Use a typed options object/valid overload for toasts. Keep persistence projection separate from runtime state and retain `slice(0, 8)` if newest-first remains canonical.

### REL-15 — Lazy page import failure can leave the application blank

**Severity:** Medium  
**Status:** Confirmed

`web-ui/src/app.js:381-448` changes visible mode before the page import has succeeded. Import errors are logged/swallowed at `:347-350,448`; the previous view is not restored and no retry UI appears.

**Fix:** Keep the current view until load succeeds, render an explicit error boundary with retry, and report module/load version information.

### REL-16 — Core persistence is not crash-atomic and session writes block the event loop

**Severity:** High reliability/performance debt  
**Status:** Confirmed

Task records, evidence buses, sessions, and schedule-memory data are rewritten directly (`src/gateway/tasks/task-store.ts:853-869,1176-1217`; `src/gateway/session.ts:2351-2386`; `src/gateway/scheduling/schedule-memory.ts:151-179,320-351,388-398`). A crash, disk-full condition, or two processes sharing a data directory can truncate state. Corrupt task records are silently treated as absent.

Session save also clones/scrubs/stringifies and writes the full conversation synchronously. Real local session files reach roughly 18-19 MB; one measured read/parse/stringify cycle consumed about 292 ms before scrubbing and disk write, blocking every client/timer in the single Node process.

**Fix:** Adopt temp + fsync + atomic rename immediately, retain last-known-good backups, and move sessions/tasks toward SQLite or an append-only event/message store with large artifacts stored by reference. The existing atomic task-index and cron-store patterns should be reused.

### REL-17 — Scheduler preemption is global and unconditional

**Severity:** Medium/High  
**Status:** Confirmed

Every scheduled job interrupts every background task runner at `src/gateway/scheduling/cron-scheduler.ts:1163-1183`, despite comments implying conditional preemption. Work resumes only after completion plus a delay (`:2103-2115`). Routine or hung schedules can stall unrelated user work.

**Fix:** Add explicit job priority/resource locks and default to nonpreemptive execution. Preserve the existing per-job `runningJobIds` lock, which is a good safeguard.

### REL-18 — Unknown provider IDs silently fall back to Ollama

**Severity:** Medium/High correctness and privacy risk  
**Status:** Confirmed

`src/providers/factory.ts:150-223` retains a hardcoded switch and silently selects Ollama for unknown providers. Settings accepts arbitrary provider strings (`src/gateway/routes/settings.router.ts:1551-1559,1660-1692`), while config updates do not fail them closed (`src/config/config.ts:830-852`).

**Impact:** A typo can send a workload to an unintended local provider, use the wrong model/privacy boundary, or produce confusing fallback behavior.

**Fix:** Validate provider/model IDs at the API boundary and fail with 400. Generate adapters and client catalogs from one canonical registry.

### REL-19 — Current red guardrail tests contain stale assumptions

**Severity:** Medium, but strategically important  
**Status:** Confirmed

- Desktop parity reports six wrapper tools missing because it searches direct switch cases. The wrappers are normalized at `src/gateway/agents-runtime/subagent-executor.ts:2358-2459,3053-3057`. Alternate `allDesktopTools`/Reactor parity remains a genuine concern, but the current failure message misdiagnoses it.
- HyperFrames catalog smoke test calls producer with a numeric FPS and missing production bridge/input configuration (`scripts/test-hyperframes-catalog-pipeline.mjs:171-188`). The real helper uses rational FPS and injects the producer bridge (`src/gateway/creative/hyperframes-producer.ts:96-147`). The actual production helper successfully rendered 24 frames in this audit.

**Fix:** Test the public wrapper/actual production entry points rather than scanning implementation syntax. Every guardrail must be valid and passing; a known false-red suite teaches maintainers to ignore real failures.

### REL-20 — Process-global execution context can collapse identity in legacy/Reactor paths

**Severity:** Medium/High  
**Status:** Confirmed static finding

`src/tools/execution-context.ts:6-20` stores mutable process-global tool context. Registry setters exist (`src/tools/registry.ts:215-228`) but no reviewed call sites initialize them before Reactor registry execution (`src/agents/reactor.ts:758,850`). Policy/audit/grants can therefore fall back to unknown or shared identities.

**Fix:** Use AsyncLocalStorage everywhere or pass an immutable execution context explicitly into every tool call; remove the process-global fallback and test concurrent reactors.

## Frontend, mobile, PWA, accessibility, and UX findings

### UX-01 — Closed mobile dialogs remain in the accessibility tree

**Severity:** High accessibility defect  
**Status:** Confirmed in source and at 390x844 runtime

The mobile drawer is always rendered as `role="dialog" aria-modal="true"` (`web-ui/src/mobile/mobile-shell.js:761-796`). Closing only changes CSS classes (`:1744-1760`); CSS uses opacity, transform, and pointer events (`web-ui/src/styles/mobile.css:1657-1693`) without `hidden`, `aria-hidden`, or `inert`.

The canvas sheet repeats the issue (`mobile-shell.js:1851-1893,1917-1924`; `mobile.css:9703-9733`). Runtime inspection showed both visually closed dialogs in the accessibility snapshot.

**Fix:** Use `hidden`/`inert` while closed, synchronize `aria-hidden`, trap focus only while open, restore focus to the trigger, and test with keyboard and screen reader semantics.

### UX-02 — Mobile tabs contain invalid nested interactive controls

**Severity:** Medium/High accessibility defect  
**Status:** Confirmed

Primary tab buttons contain checkbox inputs (`mobile-shell.js:878-884`); the model badge repeats the pattern (`:1765-1768`). These checkboxes appear in the accessibility tree despite `aria-hidden` and `tabindex=-1`.

**Fix:** Remove form controls from inside buttons. Implement visual/haptic state with CSS and ordinary noninteractive elements.

### UX-03 — Desktop primary navigation is mouse-only

**Severity:** High accessibility defect  
**Status:** Confirmed in source and runtime

Primary navigation uses clickable `<div>` elements with inline `onclick`, no link/button role, no tabindex, no keyboard activation, and no `aria-current` at `web-ui/index.html:2046-2106,2180`.

**Fix:** Replace with semantic `<a>` or `<button>` controls, native keyboard behavior, visible focus, and `aria-current="page"`.

### UX-04 — Zoom is disabled

**Severity:** Medium accessibility defect  
**Status:** Confirmed

`web-ui/index.html:5` sets `maximum-scale=1,user-scalable=no`, preventing users from zooming a dense interface.

**Fix:** Remove those restrictions and test reflow at 200-400% zoom.

### UX-05 — Programmatic labels and focus visibility are underbuilt

**Severity:** Medium/High systemic gap  
**Status:** Heuristic count plus confirmed examples

A static association scan found roughly 154 button/input/select/textarea elements without an evident programmatic label, only 19 `aria-label` attributes across roughly 463 controls, and 41 `outline:none` declarations/inline styles. Examples include session search and proposal/audit filters around `web-ui/index.html:2037,2455-2492`.

The exact count is heuristic, but the confirmed closed-dialog, nested-control, nav, and zoom defects show the pattern is real.

**Fix:** Adopt automated axe checks, enforce labels in lint/component APIs, restore visible `:focus-visible`, and test desktop/mobile navigation entirely by keyboard.

### UX-06 — Theme toggle announces the wrong next mobile theme

**Severity:** Low/Medium  
**Status:** Confirmed

Four themes cycle at `mobile-shell.js:459-469`, while accessible label/icon logic distinguishes only light versus dark at `:435-451`. A blue-to-purple transition can announce "light" even though both are dark.

**Fix:** Announce the actual next theme name and current selected state.

### UX-07 — PWA manifest icons are misdeclared

**Severity:** Low/Medium  
**Status:** Confirmed

`web-ui/manifest.webmanifest:14-32` declares the same 670x670 PNG as 192x192, 512x512, and maskable. There is no dedicated safe-zone maskable asset.

**Fix:** Generate real 192, 512, and padded maskable assets and verify install appearance on iOS/Android/desktop.

### UX-08 — Notification badge and notification navigation contain bugs

**Severity:** Medium  
**Status:** Confirmed

- `web-ui/service-worker.js:225-229` coerces the unresolved Promise from `getVisibleNotificationCount()` through `Number(count) || 0`; the result becomes zero and clears the badge instead of counting remaining notifications.
- Notification click trusts a push-supplied target URL at `service-worker.js:231-245` without a strict same-origin route allowlist.

**Fix:** Await the count, handle unsupported/rejected badge calls, and parse/allow only approved same-origin routes.

### UX-09 — Hidden background animation wastes CPU and ignores reduced motion

**Severity:** Medium performance/accessibility issue  
**Status:** Confirmed

The ember canvas loop in `web-ui/index.html:7960-8159` continuously schedules `requestAnimationFrame`, including light theme, non-chat modes, hidden mobile shell, and zero-width/missing centers. It lacks document visibility and `prefers-reduced-motion` guards.

**Fix:** Start/stop by route, theme, visibility, and media query; cancel on mobile/reduced-motion; respect device pixel ratio only while active.

### UX-10 — Client-side account/admin cache is trusted too early

**Severity:** Medium, with server-side consequences if any endpoint is under-gated  
**Status:** Confirmed

`web-ui/src/auth/account.js:15-28` trusts persisted `isAdmin`/`subscriptionActive`, and boot uses the cache before server verification (`web-ui/index.html:7707-7713`). A user can forge localStorage and unlock client UI offline.

**Fix:** Treat local claims as display-only stale cache. Hide or disable privileged UI until a fresh server response, and enforce every permission on the server regardless of UI state.

### UX-11 — Malformed mobile hashes can crash routing

**Severity:** Low/Medium  
**Status:** Confirmed

`web-ui/src/mobile/mobile-router.js:295,301,311,313` calls `decodeURIComponent()` without guarding malformed percent escapes.

**Fix:** Use a safe decoder and route invalid values to a recoverable not-found screen.

### UX-12 — Voice capture relies on deprecated main-thread audio processing

**Severity:** Medium compatibility/performance debt  
**Status:** Confirmed

Desktop and mobile voice paths repeatedly use `createScriptProcessor` (`mobile-pages.js:15619,15776,16013,21198`; `ChatPage.js:16585,20662`). The API is deprecated and prone to latency, glitches, and battery cost.

**Fix:** Consolidate the duplicated voice pipelines, use AudioWorklet with a tested fallback, and add real iOS Safari PWA/Android/Electron audio lifecycle tests.

### UX-13 — Lazy page and model complexity exceeds the current error UX

**Severity:** Medium recovery/diagnostic gap  
**Status:** Confirmed product debt

Several advanced pages can fail at import/provider/runtime boundaries, but the user generally sees a blank surface, generic toast, or stale state. Add a consistent error boundary that shows subsystem, retry, diagnostic ID, and safe next action without exposing credentials.

## Service-worker and Electron lifecycle gaps

### LIFE-01 — WebSocket pairing credentials are put in URLs

**Severity:** High credential-lifecycle defect  
**Status:** Confirmed

`web-ui/src/mobile/mobile-api.js:31-41` and `web-ui/src/ws.js:57-64` duplicate builders that append the long-lived pairing token as `pt=`. Beyond SEC-05, this creates maintenance drift.

**Fix:** Centralize socket auth and use a secure cookie, subprotocol/first authenticated message, or short-lived one-time WS token.

### LIFE-02 — Electron embedded browser views lack a retention and destruction policy

**Severity:** Medium privacy/resource lifecycle gap  
**Status:** Confirmed static finding

`electron/main.js:809-842` creates persistent `WebContentsView` instances/partitions by profile. Map entries can be removed without a clear view destruction, eviction, or browsing-data policy.

**Fix:** Add explicit destroy lifecycle, LRU/profile caps, session ownership, and user controls for retained cookies/site data.

### LIFE-03 — Embedded-browser protocol allowlist is broad; explicit permission policy is absent

**Severity:** Medium hardening gap  
**Status:** Broad protocol allowlist confirmed; permission outcome is conditional

`electron/main.js:721-725` permits data, file, about, HTTP, and HTTPS. Popup handling at `:795-797` loads URLs without equivalent validation. No explicit permission request/check policy was found for camera, microphone, location, notifications, clipboard, or display capture. That absence is a deny-by-default hardening gap, not proof that Electron automatically grants those permissions.

**Fix:** Default to HTTP/HTTPS, make local-file use an explicit confined capability, validate popup targets, and install per-origin/profile permission handlers with deny-by-default behavior.

### LIFE-04 — Readiness check can accept the wrong process

**Severity:** High process-identity defect  
**Status:** Confirmed

`electron/main.js:617-652` considers any HTTP response from the fixed URL sufficient readiness. Combined with fixed-port collision handling, a different process can be mistaken for Prometheus.

**Fix:** Require `/api/health` with an expected version and per-launch instance nonce.

### LIFE-05 — Gateway logs are truncated on launch

**Severity:** Medium diagnostics/recovery defect  
**Status:** Confirmed

`electron/main.js:381-386` opens `gateway.log` with `flags: 'w'`, erasing the previous run's crash evidence.

**Fix:** Append with size/time rotation, retain a small bounded history, and redact secrets centrally.

### LIFE-06 — Updater listener teardown is inconsistent

**Severity:** Low/Medium lifecycle defect  
**Status:** Confirmed

`electron/preload.js:28-38` exposes update-ready/progress/error callbacks without callback validation or returned unsubscribe functions, unlike `onState`.

**Fix:** Validate all callbacks and return teardown functions consistently.

## Architecture, performance, dependency, and repository findings

### ARCH-01 — Four god modules own too many security and lifecycle responsibilities

**Severity:** High maintainability and defect-amplification risk  
**Status:** Confirmed structural debt

The 18k-41k-line chat/executor modules combine request validation, prompting, streaming, provider calls, tools, approvals, persistence, voice, creative work, reconnection, and UI state. The web UI contains roughly 1,422 `window.*` assignments; the TypeScript tree contains approximately 1,257 `as any`, 4,379 `: any`, and 15 ESLint-disable directives.

This structure explains several audit findings: security policy lives far from final side effects, lifecycle cleanup is hard to own, tests resort to source-text scans, and frontend features share mutable globals.

**Recommended boundaries:**

- Chat: request/auth, turn lock, message preparation, context/compaction, provider loop, tool loop, persistence, SSE/reconnect, finalization.
- Executor: one domain handler per tool family behind a typed execution contract and explicit capability metadata.
- Frontend: route-owned controllers/stores with disposable listeners; separate chat, voice, creative, browser, file, and model-management bundles.
- Persistence: repositories with validated IDs, atomic transactions, migrations, and bounded DTOs.

Do not start a large rewrite before characterization tests. Extract one seam at a time.

### ARCH-02 — Frontend delivery is effectively unbuilt source

**Severity:** High performance and compatibility debt  
**Status:** Confirmed

`package.json:10-14` makes `build:web` a sync/check step. There is no bundling, transpilation target, content hashing, minification, code splitting, browserslist, or compression middleware.

Measured/estimated eager graphs:

- Mobile router: about 16 modules, 1.88 MB, ~40k source lines.
- Chat page graph: about 37 modules, 2.46 MB, ~51.6k lines.
- Mobile still parses the shared desktop-heavy `index.html` and unconditional desktop styles.
- `index.html` itself is roughly 468 KB with extensive inline styles/handlers.

**Fix:** Add a small esbuild/Vite production pipeline with route/feature chunks, target browsers, content hashes, source maps, and Brotli/gzip. Create a dedicated mobile entry shell. Lazy-load voice, creative, browser automation, memory visualization, and model management.

### ARCH-03 — Checked-in generated UI doubles the product surface

**Severity:** Medium/High repository and release debt  
**Status:** Confirmed

`generated/public-web-ui` mirrors the full source UI. The source/generated check is useful and currently passes, but normal changes duplicate multi-megabyte files, magnify diffs/merge conflicts, and invite source-of-truth confusion. The sync script verifies vendor existence but not always vendor byte parity.

**Fix:** Prefer generating public artifacts in CI/release from a pinned lockfile and manifest. If committed generated output is a hard requirement, enforce source-only editing, hash every generated/vendor asset, and reject unexplained generated diffs.

### ARCH-04 — Provider/model truth is duplicated and unknown values fail open

**Severity:** High correctness and product-contract drift  
**Status:** Confirmed

`src/providers/provider-registry.ts` is a sound start, but adapter creation remains a hardcoded switch, descriptors and adapters repeat model catalogs, and UI fallbacks repeat them again (`web-ui/src/pages/SettingsPage.js:857-859,3337-3339,4678-4680`; mobile fallback `web-ui/src/mobile/mobile-settings.js:7-13`). Defaults also disagree across Docker, config, factory, descriptors, and UI.

A current concrete drift example is GPT-5.6: `workspace/self/09-providers-and-models.md:57-58` promises the three preview IDs for both OpenAI API and Codex. The Codex adapter includes them (`src/providers/openai-codex-adapter.ts:33-39`), but the OpenAI descriptor (`src/extensions/bundled/providers/openai/prometheus.extension.json:13`) and desktop/mobile fallback lists (`SettingsPage.js:858-859`; `mobile-settings.js:8-9`) omit them. A user therefore sees different product support depending on which registry/fallback path wins.

**Fix:** Make the provider registry the only source for identity, model list, default, auth requirements, capabilities, context window, and pricing metadata. Expose one versioned endpoint and generate UI options. Reject unknown provider/model IDs.

### ARCH-05 — The tool architecture has overlapping registries and compatibility layers

**Severity:** High policy/maintenance debt  
**Status:** Confirmed architectural duplication

There are at least two tool execution/policy stacks: the legacy `src/tools/registry.ts`/Reactor path and the giant runtime executor. Consolidated wrapper tools normalize into legacy direct handlers, while tests and alternate registries still reason about direct names. MCP and extension tools expand dynamically beyond handwritten policy rules.

**Simplification target:**

1. One `ToolDescriptor` with schema, owner, executor, capability metadata, availability, scope, and observation policy.
2. One dispatcher with immutable execution context.
3. Wrapper aliases compiled into canonical calls at registration, not scattered normalizers.
4. Generated prompt/tool docs and exhaustive contract tests from that descriptor set.
5. A dated migration plan to remove legacy aliases once saved workflows have been upgraded.

### ARCH-06 — Session/task/team/schedule/Brain orchestration overlaps without shared primitives

**Severity:** Medium/High architecture debt  
**Status:** Confirmed

Prometheus has main-chat goals, background tasks, schedules, managed teams, subagents, proposals, internal watch, Brain thought/dream, voice workgroups, and multiple live-runtime registries. This breadth is useful, but each subsystem independently implements lifecycle, cancellation, status, persistence, prompting, and delivery.

**Fix:** Define shared primitives for `WorkItem`, owner/principal, state machine, cancellation, progress, evidence, retry, priority, resource lock, persistence transaction, and delivery. Keep product-specific UX while reducing runtime implementations.

### ARCH-07 — Test and CI coverage are far below the privilege level

**Severity:** Critical process gap  
**Status:** Confirmed

- No root `.github` directory or CI workflow.
- No standard `npm test` script or test framework.
- Only five first-party `test-*` scripts exist at the product root; thousands of apparent tests belong to tracked third-party workspaces.
- ESLint's rules object is empty and the script covers only TypeScript `src`.
- Electron, browser UI, mobile/PWA, accessibility, route authorization, path confinement, concurrency, packaged app, and Docker have no meaningful automated suite.

The correct response is not to celebrate green build/lint. Those checks currently prove far less than their names imply.

### ARCH-08 — Production dependency exposure is material

**Severity:** High supply-chain and reachable-parser risk  
**Status:** Confirmed by dependency audit and source relevance

Current `npm audit --omit=dev` reports 35 production advisories: 16 high and 19 moderate. Relevant direct or reachable families include:

- `ws` (direct; a wanted patch update exists).
- `xlsx` (direct; audit reports no automatic fixed version).
- `mermaid` (user/model-supplied diagram content makes injection/DoS advisories relevant).
- Express/`qs`.
- Remotion/PostCSS.
- Jimp/file parsing.
- HyperFrames transitive parser/runtime packages.

The full audit also reports Electron 33 advisories. Electron is a development dependency in npm terms but is the shipped desktop runtime, so it cannot be dismissed as "dev only."

**Fix order:**

1. Patch `ws`, Express/qs, Mermaid, Remotion, and safe in-range updates with regression tests.
2. Replace or strongly sandbox `xlsx`; never parse untrusted workbooks in the gateway process if avoidable.
3. Upgrade Electron by supported-major steps and rerun Electron security/packaged tests.
4. Upgrade HyperFrames as one pinned family after settling Node runtime.
5. Treat major Jimp/TypeScript/Zod/etc. changes as separate migrations, not `npm audit fix --force`.

### ARCH-09 — Package/runtime manifests are not a reliable closure contract

**Severity:** High release-reproducibility defect  
**Status:** Confirmed

- No `engines`, `private`, package `files`, repository, homepage, or bugs metadata.
- Package declares MIT but no LICENSE file exists.
- `@types/web-push` is in production dependencies.
- `chalk` appears unused in first-party source.
- `npm ls --depth=0` reports extraneous `@emnapi/runtime`.
- The public runtime manifest omits `web-push`, `chalk`, and `@types/web-push`. Only `web-push` is a known runtime import and therefore a closure defect; `chalk` appears unused, and `@types/web-push` is a type package that belongs in development dependencies rather than the shipped runtime.
- `npm pack --dry-run` is pathologically slow because there is no allowlist and the repository is enormous.

**Fix:** Add explicit package/runtime metadata and an allowlist; derive the public runtime manifest from an import/build graph plus explicit native/resource declarations; verify clean-clone packaging in CI.

### ARCH-10 — Repository hygiene makes clones, scans, and releases expensive and irreproducible

**Severity:** Critical operational debt  
**Status:** Confirmed

Git tracks roughly:

- 7,168 entries / ~2.0 GB in the working tree.
- 6,225 entries / ~1.9 GB under `workspace`.
- 1,130 files beneath nested `node_modules`.
- At least 35 FFmpeg/FFprobe binaries, including repeated ~79 MB executables.
- `.DS_Store`, source maps/declarations, the zero-byte `FAIL`, and a 20-byte `src/Write a note in here.txt` placeholder.

Root `_tmp_three.js` and `three.min.js` are byte-identical; a workspace copy is identical too. `web-ui/prometheus_chat_redesign_v2.html`, old ProjectsPage JS under styles, and mobile mock/placeholder imports are further removal candidates after reference verification.

The index contains eight gitlinks while `.gitmodules` defines only `workspace/PromSite`; `git submodule status` fails on an orphan mapping. A clean clone cannot reproduce the current tree.

**Fix safely:**

1. Back up/preserve personal workspace state first.
2. Move personal runtime data, Brain episodes, tool results, experiments, third-party repos, and installed dependencies to a separate private workspace/data repository or external store.
3. Keep only intentional product fixtures and `workspace/self`/templates needed for development.
4. Remove tracked node_modules/binaries from the current index and, after backup/review, rewrite history or migrate large required artifacts to checksummed release assets/LFS.
5. Repair/remove every orphan gitlink.

### Governance documentation is missing

**Severity:** Medium/High operational and adoption gap  
**Status:** Confirmed

There is no root `README.md`, LICENSE file, `CONTRIBUTING.md`, `SECURITY.md`, or `CHANGELOG.md`. `README-DESKTOP.md` is stale and describes older versions, paths, and packaging behavior. This is especially problematic for a privileged desktop/network application that declares an MIT license and has a public release channel.

**Fix:** Add a product README with supported targets and threat model, the actual license text, security-reporting policy, contributor/build/test instructions, release/change history, data-path/backup behavior, and a clearly maintained compatibility matrix.

### ARCH-11 — Public update supply chain is unsigned

**Severity:** High release supply-chain risk  
**Status:** Confirmed from builder configuration

`electron-builder-public.yml:108-118` disables executable signing and update signature verification. This creates SmartScreen friction and weakens update trust even if hashes are correct.

**Fix:** Code-sign the executable/installer, enable update signature verification, protect publishing credentials, use reproducible release jobs, and test downgrade/rollback/revocation on clean VMs.

### ARCH-12 — The creative system has multiple competing timing models

**Severity:** Medium product/maintenance debt  
**Status:** Confirmed architecture overlap

SELF documentation correctly notes separate scene-graph, composition-timeline, HTML-motion/HyperFrames, Remotion, and generated-footage timing models. That flexibility is overbuilt relative to the present golden-output coverage and known frozen/blank-state issues.

**Fix:** Define one canonical composition/clip contract and adapters for each renderer. Promote a lane to stable only after deterministic fixture, golden-frame, short-video, audio-sync, cancellation, recovery, and public-package tests. Keep experimental lanes feature-flagged.

### ARCH-13 — Memory visualization is ahead of retrieval quality

**Severity:** Medium product-priority imbalance  
**Status:** Confirmed product debt

Multiple polished 3D memory modes exist while SELF docs and code limits acknowledge that inventory/search/retrieval does not scale cleanly to large workspaces.

**Fix:** Prioritize trustworthy indexing, incremental updates, source citations, deletion consistency, retrieval evaluation, and scale limits. Treat Galaxy/Sphere/Wave/Tunnel as optional visualization clients over one reliable index.

### ARCH-14 — Least-privilege runtime profiles are documented but not implemented

**Severity:** High privilege and context-cost debt  
**Status:** Confirmed

`workspace/self/22-runtime-prompt-verbatim.md:736-749` describes a better target: distinct full-chat, subagent, team-manager, proposal, and background profiles. Current team managers inherit broad tools because `TEAM_MANAGER_TOOL_FILTER` is undefined (`src/gateway/teams/team-coordinator.ts:43`), and standalone subagent role content is carried in user-message context.

SELF's own measured/documented estimates quantify the cost: a typical main system context is about 3.5k-8k tokens before the user message/history, a browser-enabled team-manager context can reach 10k-14k (`workspace/self/22-runtime-prompt-verbatim.md:31-33`), and the always-on core tool surface is about 45 tools/~13.3k schema tokens (`workspace/self/05-tools.md:70`). Least privilege would improve both security and inference cost/clarity.

**Fix:** Put role/authority in system/developer context, define minimal tool/context profiles per runtime, and test that managers/subagents cannot reach unrelated credentials, desktop, shell, or connectors by default.

### ARCH-15 — Build output does unnecessary application-library work

**Severity:** Medium build-performance debt  
**Status:** Confirmed

TypeScript emits declarations, declaration maps, and source maps for the entire application, while public packaging excludes much of that output. The build took about 87 seconds.

**Fix:** Split `tsconfig.check.json` from `tsconfig.build.json`, enable incremental compilation, emit declarations only for actual library/plugin SDK surfaces, and set build-time budgets in CI.

## SELF and project-documentation analysis

The user specifically requested that `workspace/self` be included. It was reviewed as product evidence, not assumed truth.

### What SELF does exceptionally well

- Captures the intended product as a local multi-provider AI operating layer.
- Documents sharp edges that would be difficult to rediscover: pairing, voice, creative timing, public packaging, prompts, memory, tools, and provider behavior.
- Records honest known gaps and desired target architecture.
- Provides useful release and operational runbooks.
- Makes hidden coupling visible across desktop, mobile, background tasks, Brain, and creative systems.

### What is wrong with the current SELF system

- `workspace/self` contains about 48 entries/~10,261 lines, plus `workspace/SELF.md` and a ~169 KB legacy monolith. There are multiple competing "current" sources.
- `workspace/self/01-identity.md` says version 1.0.4; package version is 1.0.9.
- Index/release docs use `D:\Prometheus`; the actual audited root is `C:\Users\rafel\PromSRC`.
- `workspace/SELF.md` calls itself current but was last verified 2026-04-08.
- `workspace/self/Legacy self.md/SELF.md` is historical but still presents current-sounding material.
- Several source-line anchors have drifted.
- Cron autonomy statements conflict; current prompt context deliberately excludes cron from some autonomous context.
- Some docs say approvals are memory-only, while durable persistence exists.
- MCP text alternates between legacy delegation and native runtime behavior.
- Root `ARCHITECTURE_ANALYSIS.md` is obsolete and contradicts implemented rich blocks.
- SELF embeds ephemeral local environment statements (paths, host/config facts) that should not be durable architecture truth.

### Recommended SELF redesign

1. Keep one canonical `workspace/self/index.md` as the human entry point.
2. Separate hand-written architecture decisions/runbooks from generated inventories.
3. Generate route, tool, provider, model, script, prompt-profile, and package-version tables from source in CI.
4. Move legacy monoliths and old architecture analyses into a clearly non-injected archive.
5. Add `last_verified_commit`, not just a date, and fail CI on package version/path/link drift.
6. Never call environment-specific live config "current architecture"; put it in ignored local diagnostics.
7. Keep the documented target runtime profiles and convert them into an implementation issue/ADR.

## Incomplete, dead, or misleading product surfaces

| Surface | Evidence | Recommendation |
|---|---|---|
| `integration_quick_setup` | Advertised, no executor | Implement immediately or remove everywhere. |
| Rich artifacts `jobs`, `places`, `sports` | Declared without renderers; SELF acknowledges gap | Remove from public contract until implemented and tested. |
| Achievements | `HubPage.js` TODO/always empty | Remove placeholder UI or implement a real data path. |
| Legacy Telegram stub | Dead stub coexists with injected delivery | Delete after targeted test confirms no caller. |
| Experimental extension hook/memory/context APIs | No clear consumers | Put behind experimental versioned API; avoid stability promises. |
| Remotion/premium creative lanes | Underdeveloped vs other lanes | Feature-flag until golden render tests and UX exist. |
| Old prototype/mock files | Redesign HTML, old Projects JS, mobile mock data/placeholder imports | Remove after `rg`/runtime verification. |
| Root duplicate Three files | Exact duplicates, not main-app references | Keep one vendored source only if genuinely required; otherwise remove. |
| README-DESKTOP | Paths/version/packaging claims are stale | Replace with a root product README and generated build instructions. |

## What to keep, simplify, remove, and add

### Keep and strengthen

| Capability | Decision | Why |
|---|---|---|
| Local-first gateway and workspace model | Keep | This is the core differentiation and privacy story. |
| Multi-provider adapters and descriptor registry | Keep, centralize | The abstraction is valuable; duplicated truth is the problem. |
| Browser and desktop automation | Keep, harden | High product value; needs scoped authority, isolation, and exhaustive action tests. |
| Tasks, schedules, and team execution | Keep, unify primitives | These make Prometheus an operator rather than a chatbot. |
| Mobile PWA/pairing | Keep, redesign auth boundary | The product benefit is clear; the current handshake is unsafe. |
| Extension/connector system | Keep | Descriptor/runtime approach is sound once user loading and capability scopes are fixed. |
| Vault and OS sealing | Keep | Strong implementation direction. |
| Approval/action policy | Keep, replace inference | Preserve the UX but drive it from explicit tool metadata. |
| Public dependency verifier | Keep and expand | It caught a real release failure. |
| SELF runbooks and architecture intent | Keep, canonicalize | Valuable institutional memory; remove competing current truths. |

### Simplify

1. **One auth model:** principal + credential + scopes + session/device binding. Stop mixing process-global account state, optional gateway bearer, pairing token, loopback trust, Origin heuristics, and route-specific exemptions.
2. **One safe path API:** validated ID, canonical root, resolved child, symlink policy, atomic file operation.
3. **One tool registry/dispatcher:** explicit side-effect metadata and immutable execution context.
4. **One work-item lifecycle:** tasks, schedules, teams, goals, Brain, and background runs share state/cancellation/evidence/retry primitives.
5. **One provider/model catalog:** backend-generated and versioned.
6. **One creative composition contract:** renderer adapters behind it.
7. **One frontend architecture:** route-owned modules/stores, no inline JS, minimal globals.
8. **One SELF entry point:** generated inventories plus hand-written ADRs/runbooks.
9. **One release path per target:** deterministic desktop public/private and Docker flows, each smoke-tested.

### Remove or archive after preservation/reference checks

- Public exposure and Funnel support until the new pairing/auth model is shipped.
- Incomplete public capabilities (`integration_quick_setup`, empty achievements, renderer-less rich artifact types) unless implemented immediately.
- Root `FAIL`, `src/Write a note in here.txt`, `_tmp_three.js`, and other confirmed placeholders/duplicates.
- Unreferenced redesign prototypes, old duplicated Projects JS, dead mobile mock/placeholder code, and dead delivery stubs.
- Tracked nested `node_modules`, repeated FFmpeg/FFprobe binaries, temp/tool results, logs, screenshots, generated experiments, and third-party working trees from the product source repository.
- Legacy tool aliases after a migration period and saved-workflow conversion.
- Legacy/current-sounding SELF monoliths from runtime context; archive them clearly.
- Docker support entirely if it is not a supported product target. A removed unsupported path is better than a documented broken one.

### Add

- Principal/scoped authorization, exact-origin checks, CSRF defense, rate limits, socket revocation, and secure desktop IPC identity.
- Central request schemas and safe ID/path validation.
- Markdown sanitization, Trusted Types, strict CSP, and a truly isolated preview origin.
- Unit/contract/integration/E2E/security/accessibility/package tests plus CI.
- A real web build with hashes, splitting, targets, compression, and generated service worker manifest.
- Transactional storage/migrations/backups and a session/message store that scales.
- Runtime Health UI: auth mode, listener exposure, provider, extension scan, dependencies, renderer readiness, storage health, queue depth, last backup, and release channel.
- Structured redacted logging, diagnostic IDs, metrics, and bounded log rotation.
- Code signing, verified updates, clean-VM install/update/rollback tests.
- Clear stable/beta/experimental capability tiers and feature flags.

## What is overbuilt

1. Large compatibility surfaces around direct tools and consolidated wrappers.
2. Multiple creative timeline/render models without proportional golden-output coverage.
3. Multiple 3D memory visualizations before retrieval/index quality is mature.
4. Brain/self-improvement autonomy before core auth, persistence, and tests are production-grade.
5. Several orchestration subsystems with separate lifecycle implementations.
6. A universal ~20k-line executor and ~18k-line chat router.
7. A ~41k-line chat page and ~29k-line mobile page bundle built from global state and inline markup.
8. Three competing SELF/architecture truth sets.
9. A product repository used simultaneously as source repository, personal workspace sync, binary store, third-party monorepo, log store, and generated artifact archive.

## What is underbuilt

1. Authentication/authorization modeling and remote threat model.
2. Untrusted content isolation and browser/Electron origin boundaries.
3. Tests, CI, coverage, and adversarial regression suites.
4. Clean-clone, installer, Docker, and updater verification.
5. Accessibility semantics, focus lifecycle, zoom, labels, and reduced motion.
6. Transactional persistence, migrations, backups, corruption recovery, and concurrency control.
7. Frontend build/compatibility/performance pipeline.
8. Runtime observability and actionable failure UX.
9. Large-workspace search/retrieval quality.
10. Least-privilege agent/team/subagent profiles.
11. Dependency and release supply-chain maintenance.
12. Canonical generated product documentation.

## Recommended stabilization roadmap

### Phase 0 — Containment and preservation (same day)

1. Disable remote access/Funnel and bind loopback.
2. Preserve the dirty tree and copy personal workspace data before any cleanup.
3. Create a dedicated stabilization branch from an intentional snapshot; do not commit runtime noise.
4. Mark current installers/updater metadata as unusable.
5. Write a short threat model covering local browser, LAN, Funnel, paired phone, Electron renderer, generated HTML, subagent, MCP, and connector principals.

**Exit criteria:** no non-loopback listener; current source/workspace safely backed up; remediation work isolated from unrelated dirty changes.

### Phase 1 — First four stop-ship security changes (first 24-72 hours)

#### PR 1: Pairing/auth boundary

- Public claim/poll only; privileged desktop administration protected.
- Exact principal and scoped device token.
- No global login takeover from an untrusted network caller.
- Rate limits and revocation-aware sockets.

#### PR 2: Path and filesystem boundary

- Central opaque ID and confined-path helpers.
- Session/project/task routes migrated.
- Symlink/junction rules for all tools and shell.
- Fix `apply_patch` workspace mismatch.

#### PR 3: Untrusted content boundary

- Sanitize markdown.
- Remove inline-handler interpolation.
- Isolate preview/render origin; no scripts + same-origin.
- Remove tokens from URL/global state.
- Add CSP/Trusted Types path.

#### PR 4: Electron boundary

- Exact parsed origin and IPC sender validation.
- External scheme allowlist.
- No arbitrary port-owner kill.
- Secure Teach mode and secret redaction.

**Exit criteria:** adversarial tests for each exploit chain pass; an independent reviewer can no longer reproduce the static chain; remote access remains disabled until a full auth matrix passes.

These are the first bounded repair units, not the entire security release gate. SEC-05 through SEC-17 must also be resolved or explicitly threat-modeled and accepted before Prometheus is exposed remotely.

### Phase 2 — Correctness and release floor (week 1)

1. Fix timeout-as-success and add per-session turn serialization.
2. Fix extension-loader initialization and false-green verification.
3. Implement/remove `integration_quick_setup`.
4. Repair private installer and Docker or explicitly drop unsupported Docker.
5. Align Node/HyperFrames runtime.
6. Regenerate public release artifacts in a clean directory.
7. Add code signing plan and verified updater settings.
8. Add initial CI and make every existing red test valid.
9. Patch high-risk dependencies without blind force upgrades.

**Exit criteria:** clean clone can install, build, test, start, and package; installed desktop and Docker (if supported) return the expected health identity; release verifier passes; no test is knowingly false-red.

### Phase 3 — Persistence, PWA, accessibility, and repository cleanup (weeks 2-4)

1. Atomic storage and session/task schema migration with backups.
2. Generated hashed web build and exact service-worker asset graph.
3. Fix pairing navigation/poll cleanup, hidden dialogs, nav semantics, nested inputs, labels, zoom, focus, and reduced motion.
4. Split product source from personal workspace/third-party/binary material.
5. Repair submodules and clean-clone reproducibility.
6. Add Runtime Health UI and structured redacted diagnostics.

**Exit criteria:** cold/warm offline PWA tests pass; axe/keyboard checks pass at desktop/mobile breakpoints; a large-session benchmark stays within a defined event-loop latency budget; Git clone/build size is intentionally bounded.

### Phase 4 — Simplification without a rewrite (months 2-3)

1. Extract chat pipeline services behind characterization tests.
2. Split executor by tool domain and remove legacy dispatcher/context.
3. Introduce shared work-item lifecycle across tasks/schedules/teams/Brain.
4. Adopt one creative composition contract and feature-tier the renderers.
5. Centralize provider/model catalog.
6. Convert SELF to generated inventories + ADR/runbook set.
7. Remove migrated aliases, dead prototypes, and placeholder capabilities.

**Exit criteria:** no first-party implementation file needs to remain in the 10k+ line range; runtime profiles are least-privilege; generated docs match code in CI.

## Minimum automated test program

### Security and authorization

1. Pairing takeover negative E2E: remote caller cannot create/approve/administer its own device.
2. Route authorization matrix for every account, pairing, Funnel, status, shutdown, voice, and realtime route.
3. Exact Origin tests: `null`, file, wrong localhost port, userinfo URL, alternate scheme/host, CSRF form, and `Sec-Fetch-Site`.
4. Encoded traversal tests on Windows and POSIX for sessions, projects, tasks, transcripts, uploads, and knowledge files.
5. Symlink/junction escape tests for read/write/delete/search/shell/patch.
6. Adversarial markdown/SVG/Mermaid/srcdoc/inline-data tests.
7. Exhaustive registered-tool capability/approval table; unknown tool must fail closed.
8. Electron navigation, IPC sender, external scheme, port ownership, and Teach-secret tests.
9. Secret-redaction snapshot tests for browser, gateway, settings, MCP, and tool logs.

### Correctness and lifecycle

1. Concurrent turns in one session, reconnect, interrupt, and duplicate request IDs.
2. Command success/nonzero/timeout/signal/spawn failure.
3. OAuth rotation races, wrong-account manual flow, MCP expiry/401 retry.
4. Account/device revocation closes live WebSockets.
5. Unknown upgrades close promptly; public body/rate/connection limits.
6. Crash/disk-full/corrupt-record recovery and backup restore.
7. Scheduler priority/preemption and overlapping schedules.
8. Extension scan with valid, invalid, conflicting, and inaccessible user plugins.

### UI, accessibility, and PWA

1. Playwright + axe at 1440x920, tablet, 390x844, and mobile landscape.
2. Keyboard-only route/dialog/settings/chat use.
3. PWA cold offline, warm offline, cache update, active draft, active voice, and purge acknowledgement.
4. Pair cancel/success/back/route cleanup with no orphan polling.
5. Import failure/error boundary and retry behavior.
6. iOS Safari PWA, Android Chrome, Electron Chromium, Firefox, and Safari compatibility matrix.
7. Transfer/parse/memory/idle-animation performance budgets.

### Packaging and CI

Recommended required pipeline:

1. Secret scan and repository-noise policy.
2. Pinned supported Node setup and clean `npm ci`.
3. Type check with no emit.
4. Real ESLint rules across TypeScript, Electron, web UI, and scripts.
5. Unit/contract/integration tests with coverage thresholds focused on privileged boundaries.
6. Deterministic web build and source/generated/hash verification.
7. Dependency audit with reviewed exceptions.
8. Docker build/start/health test if supported.
9. Private and public Electron package builds.
10. Installed/unpacked launch smoke and updater metadata/hash/signature verification.
11. Release asset manifest/SBOM and clean-VM install/update/rollback test.

## Suggested stable/beta/experimental tiers

Feature tiers reduce the cost of pretending every ambitious surface has the same maturity.

| Tier | Suggested contents | Gate |
|---|---|---|
| Stable | Core chat, provider selection, files, basic tasks, core connectors, local browser/desktop actions | Full auth, contract, packaged, and E2E coverage. |
| Beta | Mobile pairing/PWA, schedules, teams/subagents, memory search, voice | Opt-in, diagnostics, rollback, targeted compatibility tests. |
| Experimental | Brain auto-evolution, advanced creative lanes, premium templates, isolated background desktop, unused extension APIs | Feature flag, no stability promise, least-privilege sandbox, explicit data warning. |

## Final recommendation

The next best step is **not** another feature. It is a bounded security-stabilization sprint beginning with SEC-01 through SEC-04, each delivered as a small reviewed change with a regression test. In parallel, preserve and separate the personal workspace so remediation can occur on a reproducible product repository.

Prometheus already has enough breadth to be impressive. Its value will increase more by making the existing system safe, deterministic, testable, and understandable than by adding another provider, agent mode, memory visualization, or creative renderer.

The project should return to remote/mobile release only when all of the following are true:

- Pairing administration cannot be performed by the claimant.
- IDs and filesystem paths are centrally confined, including junctions.
- Untrusted content cannot execute in the app origin or access credentials.
- Electron accepts only exact trusted origins and authenticated IPC senders.
- Command timeouts and concurrent turns are correct.
- Clean desktop and Docker builds start and pass health checks.
- CI enforces auth, path, XSS, Electron, PWA, accessibility, and packaging tests.
- Release artifacts are signed, hash-consistent, smoke-tested, and reproducible.
