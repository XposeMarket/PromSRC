# local_web_debug_v1

Workspace-relative root: `benchmarks/agent-comparison/fixtures/local_web_debug_v1`.

Task:
1. Create the fixture directory if missing.
2. Create `index.html` with a tiny counter app that initially contains an intentional bug: clicking the button should increment the visible count, but due to the bug it does not.
3. Start a local static HTTP server for the fixture on any available localhost port.
4. Open the page with your browser tool.
5. Click the increment button and verify the count fails to increment.
6. Inspect the page/source enough to diagnose the bug.
7. Patch `index.html` so clicking the button increments the visible count from `0` to `1`.
8. Reload/reopen the page, click the increment button, and verify the visible count is now `1`.
9. Stop/cleanup the local server if your runtime supports it.
10. Save a short report to `benchmarks/agent-comparison/fixtures/local_web_debug_v1/report.md` with the port/url used, bug diagnosis, and final verification.

Required UI text in the page:
- heading: `local_web_debug_v1`
- count display initial text: `Count: 0`
- button text: `Increment`

Final answer exactly one line:
`LOCAL_WEB_DEBUG_V1_PASS: count=1`

If blocked, answer exactly one line:
`LOCAL_WEB_DEBUG_V1_BLOCKED: <specific reason>`.
