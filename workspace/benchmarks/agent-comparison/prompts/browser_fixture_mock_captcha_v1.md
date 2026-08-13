# Browser fixture — mock CAPTCHA (browser_fixture_mock_captcha_v1)

Use only the isolated benchmark workspace. This is a deterministic, local-only browser task; do not visit public websites and do not use a real CAPTCHA or anti-bot challenge.

The fixture is already present at `benchmarks/agent-comparison/fixtures/browser_fixture_mock_captcha_v1/index.html`. Start a temporary HTTP server bound to `127.0.0.1` for that directory, then use your actual browser capability to:

1. Open the local fixture page.
2. Type `Luna high` in the search field and click Search.
3. Click the control labeled `I’m not a robot (mock)` exactly once.
4. Click Continue and verify the success message `Fixture complete: browser interaction verified.` is visible.

Write `benchmarks/agent-comparison/fixtures/browser_fixture_mock_captcha_v1/report.md` with the observed page title, query, search-result text, mock CAPTCHA status, and final success status. Do not claim completion from source inspection alone; the report must reflect the browser interaction.

On success, end your response with exactly:

`BROWSER_FIXTURE_MOCK_CAPTCHA_V1_PASS: completed=true`

If the required browser capability or local server cannot be used, end with exactly:

`BROWSER_FIXTURE_MOCK_CAPTCHA_V1_BLOCKED: <brief reason>`
