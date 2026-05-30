# Resource Triggering Design Note

Observed: 2026-05-22

## Recommendation

Yes: resources/templates/examples should support their own trigger metadata, and Prometheus should be able to auto-inject the matching resource when a user request hits a resource-specific trigger.

Skill-level triggers are still necessary because they route to the broad playbook. Resource-level triggers solve the next layer: a task like `search Amazon for toothbrushes` should surface the Amazon product-search resource directly, not just the generic Browse.sh adapter.

## Desired behavior

1. User asks a web/browser automation task.
2. Skill matcher checks both skill triggers and resource/template/example triggers.
3. Matching skill is shown as usual.
4. High-confidence matching resources are injected under that skill, with path, type, description, trigger match, and compact content or a summary.
5. If a resource is injected, Prometheus should use it immediately without an extra skill_resource_read call unless the full resource content is needed.

## Why this helps

- Reduces tool calls and context thrash.
- Makes imported Browse.sh/site-specific knowledge discoverable by normal task words like `Amazon`, `Apartments.com`, `Craigslist`, `product search`, or `listing extraction`.
- Lets one broad skill own many focused site playbooks without stuffing all details into SKILL.md.
- Makes resources/templates/examples first-class retrieval units while preserving a clean skill hierarchy.

## Suggested resource manifest fields

```json
{
  "path": "references/browse-sh-amazon-search-products.md",
  "type": "reference",
  "description": "Amazon product search/extraction playbook adapted to Prometheus-native tools.",
  "triggers": [
    "amazon",
    "amazon product search",
    "search Amazon",
    "Amazon toothbrush",
    "Amazon products",
    "product card extraction",
    "shopping search"
  ],
  "autoInject": true,
  "injectMode": "summary_then_content",
  "maxInjectChars": 4000
}
```

## Matching rules

- Resource triggers should not replace skill triggers; they should refine them.
- A resource match should pull in the owning skill enough to supply operating rules/safety boundaries.
- Use compact injection by default; full resource injection only for short resources or high-confidence exact matches.
- Prefer source-backed resources over vague semantic matches.
- If several resources match, inject the top 1-3 and list the others as available.

## Current workaround

Until core resource-trigger retrieval exists, put resource trigger hints in:

1. the resource content near the top,
2. the resource description,
3. the skill manifest `resources[].triggers` field when accepted by manifest overlay,
4. broader skill-level triggers for especially important site workflows like Amazon product search.
