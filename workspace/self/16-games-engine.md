# 16 — Games Engine

> **Last verified:** 2026-10-07 against PromSRC `a48712ccc` · **Owner area:** `src/games-engine/`, `src/gateway/tools/defs/`, workspace `game-projects/` and `games/`
> **Read this when:** Creating, extending, previewing, publishing, or debugging a playable browser game through the `game_project` workflow.

## TL;DR
- Games mode is a guided browser-game builder behind the `game_project` tool. It manages a server-owned game project, generated visual assets, procedural audio, starter scaffold, preview URL and publish action.
- Game project data is stored separately at `<workspace>/game-projects/<gp_id>/game.json`, with `assets/`, `audio/` and `build/` subdirectories. The workspace also has an existing `games/` directory of game work/content; do not confuse it with engine project storage.
- Ask the design questions, record the design/core loop/controls/win-loss plan, then plan assets and estimate before generating any art.
- Paid actions are `generate_assets` and `reroll_asset`; cost must be estimated first, and generation above `budget.autoApproveUsd` requires user approval/retry. `capUsd` is a hard stop.
- Generated art is staged: individually approve/reject/reroll each asset before building audio/gameplay around it. Sound effects and music beds are procedural/free.
- `scaffold` creates a running HTML/canvas2D or Three.js/Voxel starter and asset manifest. The agent writes the actual game code in `build/game.js` using normal file tools; scaffold is not the complete game.
- Multiplayer scaffolding provides a gateway room relay helper (`MP.connect`, `send`, state/join/leave callbacks), but the gameplay and synchronization logic remain part of the authored game.
- Use the project chat card for staged asset approval and embedded preview; verify the actual game via `play_url` before publish.
- Keep paid generation and publish separate: asset approval does not imply authority to publish externally.

## Map
| Concern | Where (file → symbol) | Notes |
|---|---|---|
| Game tool/action schema | `src/games-engine/tool.ts` → `GAME_PROJECT_ACTIONS`, `getGameProjectToolDef()` | `game_project` entry and full staged-flow guidance. |
| Tool execution | `src/games-engine/tool.ts` → `executeGameProject()` | Dispatches project, asset, scaffold, preview, publish operations. |
| Game project model | `src/games-engine/project.ts` → `GameProject`, `createGame()`, `loadGame()` | Persisted server-owned project state. |
| Project path | `src/games-engine/project.ts` → `gameDir()` | `<workspace>/game-projects/<id>/`. |
| Design normalization | `src/games-engine/project.ts` → `normalizeDesign()` | Captures genre/style, setting, controls, loop and win/lose. |
| Design questions | `src/games-engine/assets.ts` → `designQuestions()` | Ask before asset planning. |
| Art planning/cost | `src/games-engine/assets.ts` → `planAssets()`, `estimateAssets()` | Planned visuals and preflight cost. |
| Paid asset generation | `src/games-engine/assets.ts` → `generateAssets()` | Respects approval and cap; stages each result. |
| Asset approval state | `src/games-engine/assets.ts` → `setAssetStatus()` | Approve/reject and reroll each visual separately. |
| Audio generation | `src/games-engine/assets.ts` → `makeSfx()`, `makeMusic()` | Procedural sound/audio recipes. |
| Starter scaffold | `src/games-engine/scaffold.ts` → `writeScaffold()` | Writes working shell/manifest in `build/`. |
| Preview and publish | `src/games-engine/publish.ts` → `playPath()`, `publishGame()` | Preview route and publishing surface. |
| Workspace asset directory | `<workspace>/games/` | Existing workspace game assets/projects; separate from `game-projects/` engine store. |
| Tool inventory | [`generated/tools.md`](generated/tools.md); changelog [`generated/changelog.md`](generated/changelog.md) | Use generated source for current action/schema details. |

## How it works

### Project and design
1. Start with `game_project(create)` and select an appropriate genre/style/setting, title and initial pitch. The server creates a project ID and stores it independently of the chat turn.
2. Ask the supplied design questions before planning assets. Record player controls, core loop, win/lose conditions, and necessary project notes; the tool's `design` action normalizes and saves these choices.
3. Keep the game scope playable and coherent: identify input, objective, feedback, progression, and failure/restart behavior before art is generated.
4. `get`, `list`, and `questions` inspect current project state/design. Use the correct project ID for follow-up actions rather than creating a duplicate game after every turn.

### Plan, estimate, and stage art
- `plan_assets` creates asset definitions/prompts from the project design. Inspect each name/kind/prompt for relevance and required views/variants before generation.
- Call `estimate` before every paid art run. The result is project-specific, based on planned assets and current model pricing; share a cost summary before crossing the auto-approval limit.
- `generate_assets` is paid and takes an approval flag after the user's approval when required. The project budget has `autoApproveUsd` and a hard `capUsd`; the default auto-approve threshold described by the tool is $1.
- Generated sprites/visuals are staged, not automatically approved. Use `approve_asset` or `reject_asset` for each generated image. `reroll_asset` is also paid; estimate/re-check and obtain approval as required before rerolling.
- The system expects sprites with transparent backgrounds; current tool description documents magenta chroma key handling. Inspect the actual image for edges/background artifacts before approving it.
- Do not generate assets for features that were not agreed in the design. It is cheap to repair a prompt before a paid run and expensive to discover a mismatch afterward.

### Audio, scaffold, and real gameplay
- Audio tools use procedural ffmpeg recipes for SFX and music beds, so the engine marks them free. Audio stage normally requires every visual asset to have been approved or rejected; `force:true` is an explicit exceptional override, not the normal path.
- `scaffold` writes a minimal runnable browser game starter into `<project>/build/`: HTML, starter `game.js`, approved-asset loader/manifest (`assets.js`), and optional multiplayer helper (`mp.js`). The default engine is canvas2D; 3D/voxel can select Three.js.
- After the scaffold, write the actual game in `build/game.js` with normal workspace file tools. Use `loadAssets()` / `play(assets, name)` and `MANIFEST` for staged assets, and the generated helper/API for sound.
- For multiplayer, `MP.connect(room)`, `MP.send(state)`, and `MP.on('state'|'join'|'leave', fn)` use the gateway room relay. The scaffold is a transport helper, not the complete authoritative game rules or cheat prevention.
- Re-running scaffold refreshes generated asset/helper files and preserves the authored `game.js` unless `overwrite:true`. Avoid overwriting gameplay code by default.
- Use `play_url` to load/preview the server-hosted build. Test keyboard/mouse/touch behavior, resizing, restart, audio, asset loading and multiplayer joins where applicable.

### Preview, publish, and chat card
- Include the project chat card fence (`game-project` with its `projectId`) once per project when responding; it exposes stage, asset approve/reject/reroll, cost approval, audio controls and embedded preview.
- Keep `play_url` as the proof point while iterating. Confirm the actual game loads from `build/` and asset references resolve; do not trust the scaffold response alone.
- `publish` is a distinct action after gameplay QA. In source it always records a local play URL; when `VERCEL_API_TOKEN` is set, it uploads the static build to a Vercel deployment and records the published URL. Confirm the target/project and user authorization before deploy, then verify the result.
- `delete` is destructive to project files; target only the requested project and verify its ID before deleting.

## Config & knobs
- `projectId` (engine ID form `gp_...`) selects the game. All mutating actions except `help`, `list`, and `create` need the right project.
- Design knobs include `title`, `pitch`, `genre`, `style`, `setting`, `multiplayer`, `engine`, `controls`, `coreLoop`, `winLose`, and notes. The supported genre/style/engine values are returned by `help`; check current action schema.
- The paid budget is project-scoped: `budget.autoApproveUsd` allows small charges without a separate approval, while `capUsd` blocks spend beyond the hard ceiling. Estimates should precede generation/rerolls.
- The scaffold engine supports `canvas2d` and `three`; defaults are genre/design-sensitive (Three.js for 3D/voxel and canvas2D otherwise).
- Game assets/audio/build are project-owned under `game-projects/<gp_id>/`. `games/` is an independent workspace directory, not a second view of those per-project paths.
- Procedural audio recipes are selected from the engine's supported SFX list; inspect `help` for current recipe names rather than inventing one.

## Gotchas / sharp edges
- **A scaffold is not the finished game:** it is a running starter that loads assets. The authored gameplay belongs in `build/game.js` (and sometimes `index.html`); verify a real loop/objective exists before calling it done.
- **Do not bypass quote/approval:** both asset generation and rerolls may spend. Estimate exact planned work, show the quote, get user approval when required, then retry with `approved:true`. `capUsd` remains a hard stop.
- **Approval granularity:** generated images are staged individually. Review and mark each; do not treat “generate succeeded” as blanket approval for all art.
- **Asset/audio ordering:** audio stage checks that visual assets are approved or rejected, unless forced. Resolve the staged assets first so sound/music and game code match the accepted art.
- **Transparent sprite artifacts:** inspect transparency/magenta chroma-key result against the game background; bad edges can ruin a sprite even when the source image looks plausible.
- **Scaffold overwrite:** rerunning `scaffold` refreshes generated helpers and manifest; it preserves `game.js` unless `overwrite:true`. Never turn overwrite on casually.
- **Wrong directory:** engine project data is in `game-projects/`; the workspace `games/` collection contains separate game work/content. Do not hardcode relative paths from one into the other.
- **Multiplayer isn't automatic:** the room relay passes state/events, but game code still needs ownership, reconnection, conflict handling and validation. Test with two sessions.
- **Preview vs publish:** previewing a local project does not mean it's published. Publishing is separate and must be verified after completion.
- **Asset cost drift:** image model prices and planned counts can change. Re-run `estimate` when plan, model, quantity or prompt set changes.
- **Gameplay regressions:** changing canvas size, asset dimensions or input mapping can break movement/collision and mobile controls. Test at more than one viewport after code edits.

## How to change it safely
- Search [`generated/tests.md`](generated/tests.md) for games-engine, `game_project`, asset estimate/approval, scaffold, publish and room-relay regressions.
- Run the focused `src/games-engine` regressions in the PR worktree; exercise create/design/plan/estimate, cap block, approval retry, individual asset decisions, free audio, scaffold preserve/overwrite semantics, preview and publish behavior.
- Test on a disposable project. Estimate before generation; use a very small quote or stubbed provider for regression coverage instead of real paid smoke runs.
- For gameplay changes, inspect the actual `build/game.js` and `index.html`, launch `play_url`, check console/loading/errors, use keyboard/touch, resize, verify restart and check sound/approved asset loading.
- For multiplayer, run two peers and verify connect/join/leave/state flow; test reconnect and simultaneous updates, not only the happy path.
- Before publishing or deleting, verify project ID/title/build contents and the exact target. Capture a working preview first.
- Keep edits and build/test output in a PR worktree. Don't rewrite unrelated content under workspace `games/` during an engine change.

## Related
[13 Browser, desktop & media assets](13-browser-desktop.md) · [14 Creative & HyperFrames](14-creative-hyperframes-remotion.md) · [15 Media engine & video](15-media-engine-video.md) · [21 Security & approvals](21-security-approvals-permissions.md) · [`generated/tools.md`](generated/tools.md) · [`generated/changelog.md`](generated/changelog.md) · [`generated/tests.md`](generated/tests.md)


## Action-family field guide
| Stage | Actions | Evidence before advancing |
|---|---|---|
| Discover/control | `help`, `list`, `create`, `get`, `delete` | Valid engine project ID, supported design options, intended target project. |
| Define the game | `questions`, `design` | Controls, core loop, win/lose and genre/style are recorded and coherent. |
| Plan/cost assets | `plan_assets`, `estimate` | Each asset prompt fits the design; quote and remaining budget are understood. |
| Stage/review art | `generate_assets`, `approve_asset`, `reject_asset`, `reroll_asset` | Each image has been inspected and explicitly accepted/rejected; rerolls are re-quoted. |
| Create audio | `sfx`, `music` | Visual staging resolved; sound recipes match game feedback and are usable. |
| Build/preview | `scaffold`, file tools, `play_url` | Actual `game.js` exists and gameplay works; manifest loads accepted assets. |
| Publish | `publish` | User-approved destination and inspected build; successful publish result verified. |

## Smallest viable playtest
Run this checklist on a disposable project before declaring a build playable:
1. Project initializes and its page loads without missing files or script errors.
2. Player input works using the intended control scheme. Test keyboard, touch, or pointer as applicable.
3. The core loop gives the player feedback and has a clear success and failure/restart path.
4. Character/scene art uses approved assets and is not stretched, chroma-keyed incorrectly, or missing.
5. Audio starts at the correct interaction/state, stays in sync, and can be stopped/restarted.
6. Resizing and a narrow mobile viewport do not hide controls, clip the playfield, or make the game impossible.
7. If multiplayer is configured, two clients can join the intended room, observe each other's state, and handle leave/rejoin.
8. `play_url` points to the right `gp_...` project and the preview reflects the latest authored `game.js`.

## Asset lifecycle invariants
- Asset planning describes what the game needs; generation creates candidates; approval is a distinct status transition; `assets.js`/`MANIFEST` exposes usable output to code. Keep these states distinct.
- Prefer a small set of reusable assets with clear dimensions/roles (player sprite, opponent, obstacle, UI icon, background) rather than a costly ambiguous “whole game sheet.”
- Keep asset IDs/stable names intact when writing `game.js`; filenames/path may be generated, so read the manifest instead of hardcoding a guess.
- A rejected asset should not be loaded as an approved gameplay dependency. Use the engine's approved asset loader and fallback behavior, not ad hoc traversal outside project storage.
- Before reroll, decide whether the prompt, style, or source reference is the problem. Fix that cause before paying to repeat the same request.
- Procedural audio is still game content: choose recipes appropriate to on-screen events and check levels/clipping. “Free” means no model charge, not exempt from playtesting.

## Multiplayer implementation boundary
- The gateway relay gives a room-scoped state/event path, but it is not a host-authoritative server simulation. Treat client state as untrusted.
- Design a minimal shared state schema (player IDs/positions/score/current round) and send only necessary deltas/events. Do not broadcast secrets, filesystem paths, or trusted admin state.
- Decide which peer owns progression and how simultaneous actions reconcile before implementing. Include a disconnect/leave path so abandoned players do not block a room.
- Never assume state is durable across process restart unless the implementation explicitly persists it. A room relay should not be presented as saved user progress.
- Exercise at least two separate browser sessions; a single local client cannot prove the join/state/leave path.

## Change-review checklist
- [ ] Correct `gp_...` project and design state are loaded before mutation.
- [ ] Art prompt/asset plan is reviewed and cost is estimated before paid generation.
- [ ] `approved:true` is used only after user approval for the current quote; cap remains respected.
- [ ] Every generated visual has a decision before scaffolding/loading assets.
- [ ] Rerolls receive a fresh quote when their number/prompt/model changes.
- [ ] Scaffold did not replace authored `game.js` unintentionally.
- [ ] Actual playable loop and preview are tested after source changes.
- [ ] Audio, mobile input, viewport resize, and multiplayer (if any) are verified.
- [ ] Publish target and content are reviewed separately from preview.

## Storage and source ownership
- Engine-owned per-game records are under `game-projects/<gp_id>/`; game media and build outputs belong inside the specific project directory.
- The workspace-level `games/` directory is an existing library/content area. Inventory it before reusing assets; do not assume it follows the game engine's schema or overwrite it as generated build output.
- Project writes are serialized per project. Keep operations scoped to one `gp_id`; do not concurrently modify the same `game.json` from multiple routes.
- `scaffold()` owns generated HTML/helper/manifest files but leaves authored gameplay alone by default. Keep custom UI separate from generated files when possible so re-scaffolding does not erase it.
- `publishGame()` is the publish boundary: local preview is always recorded, while external static deployment is performed only when `VERCEL_API_TOKEN` is configured. Inspect it before adding a host or URL behavior and preserve explicit user approval for publishing.
- The game-project chat card reflects live project state. If UI controls and a tool result disagree, reload the project with `get` and inspect its current stage before proceeding.


## Failure triage
| Symptom | Likely issue | First check |
|---|---|---|
| `game_project` cannot load project | Wrong or stale `gp_...` ID | `list`, then `get` exact ID; don't substitute a video project ID. |
| Art generation blocked | Approval threshold or hard `capUsd` reached | `estimate` the current plan and compare against project remaining cap. |
| Cost estimate is unexpectedly high | Too many planned assets/variants or model default changed | Inspect asset plan and count; reduce or regroup before approving. |
| Generated image appears unusable | Prompt/reference mismatch or poor transparency | Reject; fix prompt or reference before reroll. |
| Scaffold page opens but is blank | Authored `game.js` still starter code, runtime error, or bad manifest path | Inspect page/console and `assets.js` MANIFEST; implement the real loop. |
| Re-scaffold overwrote helpers | Scaffold regenerates generated assets/audio/HTML files | Restore intentional custom work; keep gameplay separate in `game.js`. |
| Approved art fails to load | Asset is pending/rejected or filename was guessed | Read project asset states/manifest and use loader-provided name/path. |
| Audio missing | SFX/music stage not run or playback starts before user interaction | Check audio files/recipes and browser autoplay rules; test a gesture. |
| Multiplayer client never sees state | Different room key, callback mismatch or relay/state logic incomplete | Join two peers in same room and trace connect/join/state events. |
| Publish seems successful but link fails | Publish target/output was not checked | Re-open the resulting publish URL and verify the actual hosted build. |

## Data and maintenance invariants
- `GameProject` is server-owned JSON. Mutate through project helpers/action APIs so writes serialize and stage transitions remain valid.
- Do not edit `game.json` to “fix” asset state while the engine may be active; use status transitions and ensure referenced files match.
- A project chat card is a view/control surface. Its presence is not evidence that preview has loaded or publish has completed.
- All code/asset paths for a game should resolve inside its own `game-projects/<gp_id>/` directory unless the engine explicitly imports/links another workspace asset.
- Keep the asset manifest as the authoritative mapping from approved asset IDs/names to built files. Avoid duplicating a second file registry inside game code.
- For migration changes, preserve project IDs and data needed by the chat card/preview route; test old persisted projects as well as newly created projects.
- The workspace `games/` folder predates/exists outside the engine's per-project storage. Inspect ownership and contents before bulk organizing or deleting anything there.
