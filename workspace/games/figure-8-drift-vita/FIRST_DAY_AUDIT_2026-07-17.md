# Figure 8 Drift — First-Day PS Vita Audit

**Scope:** static review of the native Vita implementation and PC bridge, plus safe local checks on 2026-07-17. No game code was changed.

## Evidence collected

| Check | Result |
|---|---|
| Documented MSYS2/VitaSDK incremental build | **PASS** — `figure8_vita`, `.velf`, `.self`, and `.vpk` all built successfully (2026-07-17). |
| PC bridge protocol tests | **PASS** — `node --test pc-bridge/protocol.test.mjs`: 3/3 passed. |
| City structural check | **PASS** — 65 buildings and 10 industrial obstacles clear every sampled ground road. |
| Local city preview smoke | **PASS** — generated `build-v04/audit-underpass.png` and `build-v04/audit-roads.png`. |
| Real-hardware smoke | **NOT RUN** — `http://127.0.0.1:8790/health` was unavailable, so frame pacing, Vita input, install, and live rendering remain unverified. |

**Build note:** invoking CMake directly from Windows failed because `build-v04/CMakeCache.txt` was generated under `/c/...` and expects MSYS `make`; the documented MSYS2 command succeeds. This is a reproducibility/onboarding risk, not a source compilation failure.

## Verified defects / incomplete functionality

### P1 — Remote test UI cannot trigger Select/camera switching
- **Evidence:** `pc-bridge/protocol.mjs:6` defines `select`, and `src/main.cpp:2801` maps Select to camera cycling. But the rendered bridge button array in `pc-bridge/server.mjs:64` omits `select`.
- **Impact:** a tester using only the Wi-Fi bridge cannot exercise the five camera modes. This makes a documented gameplay feature inaccessible in the official remote test surface.
- **Fix:** add `select` to the web button list and add a small bridge integration assertion that every `BUTTONS` entry intended for UI control is rendered.

### P1 — Track-builder radius selection is declared but unreachable
- **Evidence:** `src/main.cpp:85` declares `turnRadiusChoice`; `addSegment()` consumes it at `src/main.cpp:515-521`. However `updateBuilder()` changes only `straightChoice`, `turnAngleChoice`, and save slot on Left/Right (`src/main.cpp:2570-2579`); no input changes `turnRadiusChoice`.
- **Impact:** all custom turns use the default radius (`radii[1]`, 16 m). The builder has incomplete advertised configurability and reduced track variety.
- **Fix:** expose radius in the builder option rail (or cycle it with a documented modifier), render the current length/angle/radius values, and add a save/load round-trip smoke case covering each radius.

### P1 — Any LAN peer can take over the bridge and receive frame streaming
- **Evidence:** `src/main.cpp:365-380` accepts the most recent valid UDP packet as `remotePeer`; validation at `:372-374` is only magic/version/size/FNV integrity. `maybeStreamFrame()` then streams rendered JPEGs to that peer (`:392-443`). The bridge defaults to a fixed LAN IP (`pc-bridge/server.mjs:9`) and has no pairing secret or peer allowlist.
- **Impact:** on an untrusted/shared LAN, a peer that knows the simple packet format can inject controls and receive game frames. The README says not to router-forward ports, but that does not protect the LAN.
- **Fix:** require a random per-session token/HMAC or a temporary pairing handshake, pin the first paired peer, and show the peer IP + connected state in-game. Keep the bridge opt-in.

### P2 — Build invocation is host-path-sensitive
- **Evidence:** `build-vita.sh:5-8` hard-codes `/c/Users/rafel/...`, deletes `build-v04`, and uses MSYS paths. A native Windows `cmake --build build-v04` failed with a cache-directory mismatch; the MSYS2 command in `AGENTS.md:119-121` passed.
- **Impact:** a new workstation/user can fail to build or accidentally lose existing build artifacts when using the script.
- **Fix:** derive the project directory from the script location, accept a build directory argument, and avoid deleting the active artifact directory unless explicitly requested.

## Vita-specific risks (not yet hardware-verified)

### P1 — Wi-Fi video capture is a likely frame-time spike
- **Evidence:** every 250 ms (`src/main.cpp:28`, `:392-443`) the game performs a full 960×544 `glReadPixels` (`:398`, ~2.0 MiB RGBA), downsamples it on CPU in nested loops (`:399-406`), JPEG-compresses it (`:408-426`), then sends multiple UDP datagrams (`:428-440`). It runs in the normal render path immediately before swap (`:2719-2720`).
- **Risk:** synchronous readback plus JPEG work can stutter driving, especially in City Drive. This is an engineering risk, not a measured Vita regression.
- **Recommendation:** make streaming explicitly disabled by default, cap it at a lower capture resolution/rate, track encode/readback time in telemetry, and skip a frame if the prior frame missed budget.

### P1 — City renderer has no visible culling/batching boundary
- **Evidence:** `drawCity()` (`src/main.cpp:2006+`) draws the full 1000×640 ground, all roads, highway, 65 buildings, props, trees/bushes, and line markings every frame. `texturedRect()` itself subdivides rectangles in nested loops (`:1710-1718`), and the code uses immediate-mode `glBegin` rendering throughout.
- **Risk:** CPU draw-call/vertex submission and fill rate are likely the City Drive bottleneck on VitaGL, with worst cases around the detailed highway/industrial area. No frame-time instrumentation or hardware FPS evidence was found.
- **Recommendation:** first measure on hardware; then add coarse distance/frustum culling, LOD/cheap far props, and static display lists/VBO-like batching where VitaGL supports it. Set a target (e.g., stable 30 fps minimum; 60 only if proven).

### P2 — Fixed-size systems are good for memory stability, but need capacity telemetry
- **Evidence:** bounded arrays cover track samples (`src/main.cpp:22,52`), projectiles/effects (`:168-175`), and city props (`:203-221`). This avoids runtime allocator churn.
- **Risk:** cursors overwrite old rockets/bullets/effects under load; that is acceptable only if communicated and observed. There is no visible capacity/drop telemetry.
- **Recommendation:** report active/capped particles/projectiles in the test telemetry and prioritize gameplay-critical effects over cosmetic smoke.

### P2 — Input accessibility/remote test coverage is incomplete
- **Evidence:** local analog dead zones are hard-coded at 0.12/0.14 (`src/main.cpp:1108-1109`, `:1334-1337`); settings expose only steering angle (`:2524-2530`). The system control bridge cannot inject touchscreen input (`AGENTS.md:87`), so HUD/minimap touch behavior requires physical testing.
- **Recommendation:** add configurable steering and camera dead zones, invert-Y option, controller remap/preset support, and a visible on-screen control reference. Hardware-test the touch HUD specifically.

### P2 — Texture loading has little diagnostic/fallback information
- **Evidence:** JPEG load failures return `false` silently (`src/main.cpp:1691-1708`); initialization ignores return values (`:2734-2735`). Rendering falls back to flat geometry for `environmentTexture` (`:1710-1712`), while cockpit overlay behavior is not surfaced to the player.
- **Recommendation:** log/telemetry texture load failures and show a compact developer warning in the Wi-Fi bridge state; validate packaged asset dimensions and format during the build.

## Gameplay / UX wins (suggestions, not defects)

### P1 first polish win — Make the first 30 seconds teachable
- Add a one-screen, skippable control card when entering each mode: R accelerate, L brake/reverse, Circle drift, Select camera, Square exit vehicle, Triangle reset/weapon switch.
- Include the current mode, camera name, and a one-line objective (e.g., “link drifts to grow combo”). This directly addresses the dense controls documented in `README.md:10-28` and makes City/on-foot features discoverable.

### P1 first polish win — Give driving a clear short-loop goal
- The existing score/combo mechanics are in `src/main.cpp:1315-1322`, but static review found no lap/target/timer progression system or audio layer. Add three lightweight challenge gates: score target, drift-zone checkpoint, and city stunt target. Preserve sandbox mode.

### P2 — Add audio/haptics feedback
- Static search found no audio module/includes. Engine pitch, tire squeal, collision, combo-bank, weapon, and menu feedback would sharply improve driving readability. Keep effects low-memory and add a master/individual volume setting.

### P2 — Improve reset and failure recovery
- Triangle resets, but add a brief “Hold Triangle to reset” prompt when stuck/zero-speed near a collision, plus an optional last-safe-road reset. It reduces friction without altering physics.

## Larger improvement candidates

1. **Performance observability pass:** frame time, render time, stream encode time, active effect counts, and current camera mode in bridge telemetry; capture a scripted City Drive hardware trace.
2. **Content/game loop pass:** events/challenges, unlockable customization, best-score persistence, replay ghost based on sparse fixed samples.
3. **Rendering pass:** cull/LOD distant City Drive geometry, precompute static road/building meshes, atlas validation, lower-cost smoke/explosion tiers.
4. **Robustness pass:** versioned save records with CRC and atomic temp-file rename; asset preflight in build; explicit `app0` resource error reporting.
5. **Bridge hardening pass:** pairing/authentication, select/touch test coverage, packet-loss metrics, and an explicit local-only safety status.

## Recommended first implementation batch

**Batch A — Remote test completeness + builder completion + observability (P1):**
1. Add Select to the PC bridge UI and test it end-to-end against the packet map.
2. Make `turnRadiusChoice` selectable and visible in Build Track; add a local save/load radius round-trip test.
3. Add lightweight in-game/bridge timing telemetry: frame delta, stream readback+JPEG duration, active effect counts, and camera mode.
4. Hardware smoke this batch: Figure 8, City ground/ramps/highway, all five cameras, Build Track at each radius, touch minimap physically, then compare City frame pacing with stream off vs. on.

Do **not** start rendering optimization before this instrumentation produces a Vita trace. It keeps the first batch low-risk, fixes two concrete gaps, and gives the next performance work objective evidence.
