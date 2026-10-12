# Chat stream extraction and independent consumer receipt

## Scope and cause

- Worktree: `C:\Users\rafel\promsrc-pr\crash-windows`, verified clean at
  `17fda754503f56dd6fa02122177b1d41ae61b6d0`; branch renamed safely to
  `refactor/chat-stream-consumer-evidence`.
- Router contained replay storage, retention, WS notification batching, trace
  construction and stream finalization inline. Extracted that cohesive boundary
  into `src/gateway/chat/main-chat-stream-store.ts` with injected WS/runtime
  adapters; router decreases from 22,829 to 22,620 lines (209 net lines).
- Runtime reconciliation, watchdog, turn admission and runAgentTurn remain in
  the router. Removed an unused duplicate direct-event set; classifier remains
  the authoritative unchanged delivery policy. Sequence, retention cap, TTL,
  throttle and orphan abort/terminal behavior remain unchanged.
- Existing embedding example was already a public-import consumer but its test
  linked the source checkout. It now packs/installs a real tarball in a temporary
  project, with offline dependency installation and outbound network denial.

## Evidence

- Before extraction: `npm run test:replay`: 18 passed, 0 gaps, 0 failures.
- After extraction: `npm run test:replay`: 18 passed, 0 gaps, 0 failures.
- `npx tsx src/gateway/chat/main-chat-stream-store.regression.ts`: PASS for
  replay cursor gaps, shallow payload snapshots, progress recovery, ordinary
  tool trace, throttled delivery, local runtime selection, orphan abort,
  terminal idempotence, TTL, 12,000-event cap and replacement identity.
- `npx tsx src/gateway/chat/main-chat-stream.regression.ts`: PASS.
- `npm run test:stream-persistence`: PASS, 5 writes / 21 seconds with terminal
  and pagehide flush. Existing module-type warning is nonfatal.
- `npx tsc --noEmit -p tsconfig.json`: PASS after correcting the extracted prune
  adapter export found by the first typecheck.
- `npm run build`: PASS (backend, web sync/global checks, extension assets).
- Packed consumer result recorded below after completion.

## Limits

This is contract evidence, not an invented architecture score. It does not prove
all 16 dimensions are >=8, real-provider quality, actual device SSE reconnect,
or cross-process durable restart. Replay storage remains in memory; durable trace
construction is unchanged. Desktop/provider dependencies remain in the tarball
(observed approximately 153 MB), so this is not a minimal embedding distribution.
Offline npm installation requires a populated dependency cache and disables all
install scripts/optional packages. Test-generated audit/memory artifacts remain
unstaged. No goal-stop/evals/root package semantics changed. No merge, live
checkout edit, gateway restart, Telegram or peer-thread action performed.

## Independent installation limitation

Default packed verification actually ran `npm pack` and attempted an offline
install in a temporary consumer. It failed explicitly with `ENOTCACHED` for
`https://registry.npmjs.org/acorn-walk`; no network fallback was performed.
This host therefore does not yet provide a successful independent npm install
receipt. An explicit `--shared-dependencies` diagnostic is being run against
extracted real tarball bytes with existing external dependencies via NODE_PATH;
that mode must not be reported as independent installation evidence.

Packed-byte diagnostic uncovered a genuine packaging defect: absent .npmignore,
npm inherited .gitignore's `/dist/` exclusion, so the existing public embed
export pointed at a file missing from the tarball. Added `.npmignore` based on
the existing exclusions with explicit dist inclusion and runtime-artifact
exclusion. Root package.json remains unchanged. Registry-assisted dependency
installation is an explicit `--online-install` option, not implicit fallback;
runtime execution still forbids networking.

Explicit registry-assisted packed install was also attempted and failed with
`ETARGET: No matching version found for qs@~6.16.0`. This is a dependency-resolution
blocker, not a passing independent-consumer receipt. It is outside this tight
refactor's scope; package manifest/dependency versions were not changed.

Final `node scripts/test-embed-consumer.mjs --shared-dependencies`: PASS from
actual packed/extracted `prometheus-1.0.17.tgz`, public `prometheus/embed`, no
Prometheus source link, outbound runtime networking denied. Exact output:
`embed-consumer: ok (answer="Order status: order 42 shipped on Oct 9", 2 model calls, cancel in 321ms)`.
This uses existing host external dependencies via NODE_PATH; independent install
remains blocked as above. A post-pack assertion now checks the export file is
present before installation. Syntax checks and git diff --check passed.
