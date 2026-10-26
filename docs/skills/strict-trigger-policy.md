# Strict skill trigger policies (v2)

Skill **discovery** and automatic skill **eligibility** serve different purposes. A search can find a useful skill even when the current message does not qualify for automatic routing. Neither discovery nor routing authorizes tool actions.

## Contract

A manifest can opt into Boolean eligibility with `triggerPolicy`:

```json
{
  "triggerPolicy": {
    "version": 2,
    "rules": [
      {
        "allOf": ["render", "portrait"],
        "anyOf": ["photo", "painting"],
        "noneOf": ["trigger audit"]
      }
    ]
  }
}
```

Each rule requires **every** `allOf` term, **at least one** `anyOf` term when that field is present, and **no** `noneOf` terms. Complete rules are alternatives (OR). Terms can be words or phrases. Matching normalizes case and punctuation and respects token boundaries: `AI` is not a substring match inside `painting`.

- `render a portrait photo`: eligible.
- `render portrait`: not eligible, because an `anyOf` term is missing.
- `portrait photo`: not eligible, because `render` is missing.
- `trigger audit: render a portrait photo`: excluded.

A nonempty `allOf` is required. Present-but-empty `anyOf`, malformed rules, unsupported versions and empty rule lists are invalid. Invalid policy presence must remain fail-closed at read time; it must not silently turn into legacy routing. Authoring operations return validation errors instead of dropping required terms.

For a skill intended only for deliberate selection:

```json
{ "triggerPolicy": { "version": 2, "mode": "explicit" } }
```

This keeps the skill discoverable/readable without automatic admission. An explicit policy is not an empty automatic rule.

## Admission before ranking

Automatic candidates must first pass their v2 policy. Ranking can sort eligible candidates; it cannot rescue an ineligible one through a matching legacy trigger, name, slug, description or metadata. Merely mentioning a skill in a complaint, quotation or audit is not a manual selection.

`skill_list` is broad discovery. `skill_read(id)` and supported manual selections remain deliberate ways to read a skill. These operations do not bypass execution permissions, tool approvals, required integrations or blocked-skill safety rules.

## Legacy compatibility

Without a v2 policy, existing `promptSignals` retain weighted-v1 semantics. Their `phrases`, `allOf`, `anyOf` and `minScore` fields are not silently reinterpreted as Boolean requirements. Legacy triggers remain useful discovery metadata. Catalog migration explicitly adds reviewed v2 policies rather than guessing a new meaning for old fields.

## Catalog review and upgrades

A policy should be accompanied by realistic positive requests and plausible near-misses. Exact copies of trigger phrases alone are insufficient evidence. Check partial conditions, exclusions, quoted/meta mentions, short tokens and the actual routing callers—not only the evaluator.

Public bundles are generated from canonical `workspace/skills` metadata through the existing visibility-filtered bundling pipeline. Personal/dev instructions must not become public merely because their routing rules were reviewed. Installed skill roots, source roots and bundled roots may contain different ID sets; report their reconciliation explicitly.

Existing-install updates must preserve customized policies, overlays, frontmatter, instructions and resources. Upgrade only an unchanged recognized baseline; preserve and report ambiguous/customized entries for manual migration. A repeated migration must be idempotent, and a backup must exist before changing an installed manifest. Never use this policy migration as a reason to overwrite the entire skill directory.

## Migration commands

Canonical source changes are reviewed separately from installed customizations:

```sh
node --import tsx scripts/apply-reviewed-skill-catalog.mjs --root . --rows src/gateway/skills-runtime/fixtures/strict-skill-catalog.json
# Review dry-run, then repeat with --apply.
npm run bundle:public-skills
npm run test:strict-skills
```

On packaged startup, the existing seeder derives a baseline from the bundled manifest with `triggerPolicy` removed. It upgrades only an identical installed manifest, without a routing overlay. Customized or ambiguous entries are preserved and reported. The baseline derivation is deliberately conservative: unrelated upstream manifest changes also require manual review. New skills seed normally.

For a locally managed catalog, explicitly capture and review a migration plan, then apply it only when ready:

```sh
node --import tsx scripts/plan-installed-skill-triggers.mjs --capture --skills-dir <installed-skills> --plan <review-plan.json>
node --import tsx scripts/plan-installed-skill-triggers.mjs --apply --skills-dir <installed-skills> --plan <review-plan.json>
```

Capture does not change skills. The plan records hashes of native manifests and overlays, plus reviewed policies—not instruction text. Apply refuses the entire plan if a captured file changed, backs up original bytes, and sets the reviewed policy in both manifest layers without changing other fields. This explicit procedure intentionally differs from automatic bundled upgrades: it authorizes replacement of the captured local policy only after review. A repeated old plan fails safely; it is not a blind force-upgrade. The plan contains a local root path and belongs in local working data, not a public repository.

The reviewed inventory contains 206 IDs: 190 canonical workspace skills (186 public, four development-only), 13 runtime-only entries, and three connector-provided skills. Runtime-only policy fixtures do not ship their private instructions. Connector policies update with their packaged connector source, not the workspace seeder.
