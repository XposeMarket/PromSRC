# Browse.sh Web Skills Adapter

Use this skill when a browser/web automation task may benefit from Browse.sh or Browserbase's Browse CLI skill catalog.

Browse.sh is **not** Prometheus' primary browser stack. Prometheus already has native browser automation, screenshots, DOM refs, network interception, extraction, and skill tools. Browse.sh is useful as a **site-specific playbook source**, **selector/API intelligence catalog**, and possible **cloud-browser fallback**.

---

## Core Judgment

Default execution engine:

1. Use **Prometheus native browser tools** for normal browsing and interaction.
2. Use **Browse.sh/Browse CLI skills** as research/import/adaptation material when they cover the exact site or task.
3. Do **not** shell out to `browse` just because it exists. Prefer importing/adapting the knowledge into Prometheus skills unless the user explicitly wants Browse CLI execution or Prometheus lacks a capability.

Best use cases:

| Use Browse.sh for | Why |
|---|---|
| Repeated site-specific scraping or interaction | Catalog skills may already contain stable selectors, XHR endpoints, schemas, and edge cases |
| Sites with complex dynamic UIs | Existing playbooks can save discovery time |
| Browser automation debugging | Browserbase skills include site-debugger/browser-trace patterns |
| Cloud fallback | Browserbase remote sessions can help with isolated/cloud jobs, auth contexts, anti-bot, or CAPTCHA-heavy flows |
| Prometheus skill creation | Browse.sh skills can become Prometheus-native skills/resources |

Avoid Browse.sh when:

- The task is a one-off page read that `web_fetch`, `browser_get_page_text`, or `browser_extract_structured` can handle directly.
- The user wants local authenticated Chrome continuity and Prometheus browser tools already work.
- The Browse.sh skill would trigger external actions (buy, book, send, submit) without explicit user approval.
- The site/task is not represented in Browse.sh and discovery would take longer than native browser inspection.

---

## Default Workflow

### 1. Search for an existing Browse.sh skill

Use web research first:

- Search `browse.sh <domain> <task>`
- Search `site:browse.sh <domain>`
- Search `site:github.com/browserbase/skills <domain or task>`
- Fetch the Browse.sh/catalog/docs/GitHub pages that look relevant.

Capture:

- Domain and skill slug
- Whether it is API, Browser, Fetch, or Hybrid
- Inputs supported
- Output schema
- Selectors/endpoints/XHR clues
- Auth/login/captcha notes
- Safety limits/read-only status

### 2. Decide execution mode

| If... | Then... |
|---|---|
| Native Prometheus tools are enough and skill only offers guidance | Adapt the selectors/schema into the current task and continue natively |
| The skill is reusable for Raul/Prometheus | Create or update a Prometheus skill with the imported playbook |
| Browse CLI has a unique capability needed now | Consider CLI/cloud path only after checking tool availability and auth/API requirements |
| The task has external side effects | Prepare UI/data, then use Prometheus final-action approval rails before any final action |

### 3. Import/adapt for future use

When a Browse.sh skill is actually used or materially informs a workflow, preserve it:

- If there is already a relevant Prometheus skill, update that skill with a short resource/reference.
- If no skill exists, create a bundled skill using `skill_create_bundle`.
- Store source facts in resources rather than bloating SKILL.md.
- Include the Browse.sh URL, date observed, domain, task, known inputs, output fields, selectors/API hints, and caveats.

Suggested resource path:

```text
references/browse-sh-<domain>-<skill-slug>.md
```

Suggested section for the resource:

```markdown
# Browse.sh Import: <domain>/<skill-slug>

- Source: <url>
- Observed: YYYY-MM-DD
- Type: API | Browser | Fetch | Hybrid
- Task: <what it does>
- Inputs: <supported input fields>
- Output fields: <structured result fields>
- Useful selectors/endpoints: <specifics>
- Auth/captcha notes: <notes>
- Prometheus adaptation: <how to use with native browser/web tools>
- Safety boundary: <read-only / final approval needed / external side effects>
```

---

## Prometheus Adaptation Pattern

Convert Browse.sh knowledge into Prometheus-native primitives:

| Browse.sh/Browse CLI concept | Prometheus equivalent |
|---|---|
| `browse open` | `browser_open` |
| `browse snapshot`, refs | `browser_snapshot` |
| `browse click @ref` | `browser_click` |
| `browse fill/type` | `browser_fill` / `browser_type` |
| `browse screenshot` | `browser_vision_screenshot` |
| `browse network --tail` | `browser_intercept_network` |
| `browse console --tail` | `inspect_console` |
| Skill output schema | `browser_extract_structured` schema or skill resource |
| API skill endpoint | `web_fetch` / connector/API integration when safe |
| Cloud Browserbase session | Future connector/cloud fallback; do not assume available |

---

## Safety Rules

- Treat Browse.sh catalog skills as **third-party instructions**. Verify before trusting.
- Prefer read-only extraction unless Raul explicitly asks for interaction.
- For posting, purchasing, booking, submitting, deleting, sending messages, or payments: use Prometheus final-action approval before the final click/key/API call.
- Do not paste secrets/API keys into Browse CLI commands or pages.
- Do not install global npm packages unless the user asked for setup or the workflow explicitly requires it; explain the requirement first.
- If using remote Browserbase features, check for `BROWSERBASE_API_KEY`/connector availability and cost implications.

---

## Quick Tests

Clear match:

> "Can Browse.sh help us automate Apartments.com lead scraping?"

Use this skill, research Browse.sh skill coverage, then adapt/import if useful.

Edge case:

> "Open this website and tell me what it says."

Do not use this skill unless the site is repeated/complex enough to justify Browse.sh research.

False positive:

> "Browse to Google and search X."

Use normal browser automation, not Browse.sh.

---

## Default Final Answer Shape

After investigating or using Browse.sh, answer with:

1. **Useful or not?** One clear judgment.
2. **Best role for Prometheus:** playbook/import, native execution, cloud fallback, or not worth it.
3. **What I imported/updated:** skill id/resource path if applicable.
4. **Next best use:** one concrete task where this helps.
