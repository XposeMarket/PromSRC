---
name: "contribute-catalog"
description: "Author and prepare an upstream HyperFrames registry block or component when the user explicitly wants to contribute it to the public HyperFrames catalog. Do not use for installing catalog items or for ordinary in-project video authoring."
---

# Contribute a HyperFrames Catalog Item

Work inside a disposable fork or checkout of the current HyperFrames upstream repository. Never assume a Prometheus or video-project checkout contains the registry contribution infrastructure.

## Build

1. Confirm whether the contribution is a full `hyperframes:block` or reusable `hyperframes:component`.
2. Inspect the current upstream registry schema, neighboring items, contribution guide, and generation scripts before scaffolding. Upstream files are authoritative; do not rely on dated copied schemas.
3. Use a unique kebab-case name and a short element-ID prefix. Keep every ID collision-safe.
4. Author deterministic, seek-safe HTML. Use a paused timeline, seeded randomness, framework-owned time, and no uncontrolled animation loop.
5. Add the registry metadata, files, catalog index entry, and generated documentation required by the current checkout.

Read [templates.md](templates.md) only when a starter is helpful, then reconcile it against the current upstream schema and neighboring entries.

## Validate locally

Run the commands supported by the installed CLI and repository:

```bash
npx hyperframes lint
npx hyperframes inspect
npx hyperframes snapshot --at "1,3,5"
npx hyperframes render -o preview.mp4
```

Also run the repository's formatting, schema, unit, and catalog-generation checks. Require zero lint errors and visually inspect the snapshots and preview. `validate` is not a current HyperFrames v0.6.20 command; use `inspect` and the repository's own checks.

## Publish and propose

Publishing and opening a pull request are external side effects. Do them only when the user explicitly authorizes publication:

1. Review the complete diff and generated files.
2. Publish a preview only if authentication and the intended destination are confirmed.
3. Commit on a dedicated branch, push to the user's fork, and open a PR against the verified upstream repository.
4. Attach the preview and state the exact local checks that passed.

If upstream access, credentials, schema tooling, or PR authorization is absent, stop after producing a locally validated contribution and report the remaining requirement. Do not call an unsubmitted local item “published.”
