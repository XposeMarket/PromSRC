---
name: "change-and-price-watch"
description: "Set up and run recurring watches on external sources that alert only on new or qualifying changes: product, flight, or listing prices and availability against a target, RSS or Atom feeds, GitHub issues, releases, or commits, JSON endpoints, and web pages. Uses a pinned watch contract, a state file with seen-ID watermark and last-good observation, a foreground baseline before scheduling, and silent no-change ticks. Use for alert me when the price drops, watch this feed, notify me on new releases. Do not use for one-off price lookups or shopping comparisons (product-carousel-builder), competitor strategy digests (competitor-signal-monitor), or internal file and task watches (automation-watches-and-timers)."
---

# Change and Price Watch

A watch is a contract plus a state file plus a schedule. Each tick fetches, compares against stored state, and either alerts on a real qualifying change or says nothing. Setup happens once in the foreground; the recurring tick runs as a scheduled job.

## Setup (foreground, once)

### 1. Pin the target

- **Price or availability watch:** source URL or provider, product or listing id, variant (size, color, condition, seller), quantity, location, dates, travelers or guests, membership assumptions, acceptable substitutes. Done when two variants cannot be confused.
- **Feed or change watch:** feed URL, GitHub `owner/repo` plus scope (issues, pulls, releases, commits), JSON endpoint plus the path to the item list and the id field, or page URL plus the region that matters. Done when the dedup key is named.

Use `shopping_search_products` to identify the exact item when the user names a product loosely. Ask missing essentials with `ask_prometheus_questions`.

### 2. Define the alert rule

Price: currency, all-in versus pre-tax, threshold, stock rule, shipping, refundability, class or room type. Feeds: which new items qualify (all, or keyword or label filters). Every watch: cooldown, delivery channel, and whether a periodic all-clear is wanted (default: no). Done when three made-up observations each get a deterministic alert or no-alert decision.

### 3. Baseline before scheduling

Run one real fetch now: `web_fetch` for pages and feeds, `tool_search` for a connected GitHub or app tool, or `browser_automation` only if the page needs interaction. Record retrieval time, price breakdown (base, fees, shipping, tax, total) or the current item ids, and availability. If the fetch fails, fix it before scheduling anything.

### 4. Write the contract and state file

Create `watches/<slug>.json` in the workspace:

```json
{
  "contract": {"type": "price|feed|github|json|page", "target": {}, "rule": {}, "cooldown_hours": 24, "deliver": "origin"},
  "state": {
    "seen_ids": [],
    "last_good": {"at": "", "observation": {}},
    "last_alert": {"at": "", "fingerprint": ""},
    "last_error": null
  }
}
```

The first run is the baseline: seed `seen_ids` with current items so old entries are never replayed. Cap `seen_ids` at about 500, dropping the oldest.

### 5. Schedule the tick

Use `schedule_job` (automations category) with a self-contained prompt, following `scheduler-operations-playbook`:

```text
schedule_job({action:"create", name:"watch-<slug>", confirm:true,
  schedule:{kind:"recurring", cron:"0 */6 * * *"},
  instruction_prompt:"Read skill_read('change-and-price-watch') and run the Tick procedure for workspace/watches/<slug>.json. Alert only on a qualifying change; otherwise finish silently."})
```

Choose a cadence that respects rate limits and site terms: hours for prices, 15 to 60 minutes for busy feeds. Use `trigger_ops` instead when the source can push a webhook (GitHub does). Verify with one `run_now` and confirm the state file updated. Done when the job exists and one scheduled run succeeded.

## Tick (each scheduled run)

1. **Load** the watch file. Missing or unreadable file: report the error, do not guess.
2. **Fetch and normalize.** Prices: separate base, mandatory fees, shipping or tax, total, availability; keep the source currency and convert only with a dated rate. Feeds: extract item id, title, link, date. Ignore volatile page noise (timestamps, ads, session tokens).
3. **Failed fetch** means unknown state: set `last_error`, keep `last_good` untouched, and alert only if errors persist across several ticks. Never write an error page over a good observation.
4. **Compare.** Price: threshold crossed, back in stock, material drop, or the user's rule. Feeds: ids not in `seen_ids` that pass the filter. Build an alert fingerprint (item + price or item ids); skip if it equals `last_alert.fingerprint` or the cooldown has not elapsed.
5. **Deliver or stay silent.** An alert includes exact item and variant, all-in price in source currency, availability and terms, threshold, retrieval time, and the source link; feed alerts list new items as title plus link. Never claim stock is reserved. No change means no message, unless an all-clear was requested.
6. **Save state** atomically: new ids added, `last_good` and `last_alert` updated.

## Managing watches

List with `schedule_job({action:"list"})` and the `watches/` folder. Pause, retarget, or delete through `schedule_job` after reading the job detail. To force a replay, clear `seen_ids` (the next run becomes a fresh baseline).

## Exit criteria

The contract pins the target; a foreground fetch succeeded before scheduling; alert decisions replay deterministically from the state file; duplicates are suppressed; failed fetches never replaced good state; one scheduled run was verified.

Lineage: inspired by NousResearch/hermes-agent product-price-monitor and watchers, rewritten for Prometheus.
