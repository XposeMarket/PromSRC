# Browse.sh / Browserbase Browse CLI Overview

Observed: 2026-05-22

## What it is

Browse.sh is an open web catalog plus CLI ecosystem for browser-agent skills. It is built around the Browserbase `browse` CLI and related skills.

Key source pages inspected:

- https://browse.sh/
- https://docs.browserbase.com/integrations/skills/browse-cli
- https://github.com/browserbase/skills

## Browse.sh positioning

Browse.sh describes itself as an open web catalog and browser CLI for AI agents. It exposes site/task skills such as Amazon product search, Airbnb listing search, AllTrails trail search, Craigslist listing search, NASA APOD, Apartments.com rentals, Algolia docs search, and many more.

The catalog entries identify:

- domain
- skill slug / task
- method type: API, Browser, Fetch, or Hybrid
- structured task description
- often read-only boundaries

## Browse CLI command surface

Browser automation commands from Browserbase docs include:

- Navigation: `browse open`, `back`, `forward`, `reload`, `wait`
- Inspection: `snapshot`, `refs`, `highlight`, `screenshot`, `cursor`
- Interaction: `click`, `fill`, `type`, `upload`, `select`, `key`, `press`
- Debugging: `network`, `console`, `get`, `is`, `eval`, `viewport`, `status`, `stop`, `cdp`
- Session/tab controls: `tab`, `mouse`
- Cloud APIs: `browse cloud ...`
- Functions/templates/skills: `browse functions`, `browse templates`, `browse skills`

Installation shown in docs:

```bash
npm install -g browse
browse skills install
```

Remote Browserbase commands require:

```bash
export BROWSERBASE_API_KEY="your_api_key"
```

## Browserbase skills repo

The `browserbase/skills` repo includes skills for coding agents:

- `browser` — browser automation via CLI; supports remote Browserbase sessions, Identity, verified browsers, CAPTCHA solving, residential proxies
- `browserbase-cli` — platform/session/project/context/fetch workflows
- `functions` — deploy serverless browser automation to Browserbase cloud
- `site-debugger` — diagnose failing automations: bot detection, selectors, timing, auth, captchas
- `browser-trace` — CDP firehose, screenshots, DOM dumps, searchable trace buckets
- `safe-browser` — local Claude Agent SDK browser agents constrained by a CDP-gated safe browser tool with domain allowlist enforcement
- `bb-usage` — usage/cost dashboard
- `cookie-sync` — sync local Chrome cookies to Browserbase persistent context
- `fetch` — HTML/JSON fetch without a browser session
- `search` — structured web search without browser session
- `ui-test` — adversarial UI testing

## Prometheus judgment

Useful, but not a replacement for Prometheus native browser automation.

Best Prometheus roles:

1. Site-specific automation intelligence: selectors, XHR/API endpoints, structured output fields, edge cases.
2. Skill importer/source material: convert Browse.sh catalog tasks into Prometheus skills/resources.
3. Debugging inspiration: browser-trace, site-debugger, safe-browser, cookie-sync, and ui-test are relevant patterns.
4. Cloud fallback option: Browserbase remote sessions may be useful later for isolated/headless/cloud jobs, anti-bot/captcha-heavy tasks, or non-local jobs.

Default: keep using Prometheus native browser tools and import/adapt Browse.sh knowledge only when it adds leverage.