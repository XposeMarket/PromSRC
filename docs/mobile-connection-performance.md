# Mobile connection performance guardrails

The gateway's Needs You poll must consume task summaries, not deserialize every historical task. `listTasks({status})` filters only after loading every task, so it is not safe in a periodic request-serving process. Use `listTaskSummaries({status})`; the existing summary contains identity, status, pause reason, original session, and clarification fields. The summary index may rebuild once when missing/outdated; steady-state polls must not load historical task files.

Websocket retry delays must distinguish omitted/null delay from explicit zero. A recovery connection may be initiated immediately, but subsequent failures must use exponential backoff. On mobile resume a healthy socket needs at least the server's ten-second application heartbeat interval, plus jitter, before replacement. This applies to the shared desktop/mobile websocket module.

A mobile request timeout covers fetch headers, body consumption, and any retries combined. Never replay mutations. Generic network failures get at most one retry; a timed-out read does not retry automatically. Explicit GATEWAY_RESTARTING reads may retry under the original deadline. History loading failures must not label an OPEN websocket as disconnected.

Verification:
- `npm run test:mobile-connection-budget`
- `npm run test:needs-you-hotpath`
- `npx tsx src/gateway/needs-you.regression.ts`
- `npx tsc --noEmit -p tsconfig.json`
- `npm run sync:web-ui && npm run check:web-ui && npm run build`

Live verification after approved merge/restart: watch loopback `/api/health` for at least 30 seconds; sample public Funnel `/mobile`; exercise a paired phone's foreground/background resume. Do not substitute a desktop-width root page for `/mobile`, or report synthetic collector timing as live phone latency. No added dependencies, credentials, account-specific paths, or platform-specific product code.
