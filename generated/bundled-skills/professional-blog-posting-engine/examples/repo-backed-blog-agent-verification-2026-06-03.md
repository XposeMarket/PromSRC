# Repo-backed blog agent verification example (2026-06-03)

Use this pattern when a user asks for an ongoing blog-poster/blog-maintenance agent or asks Prometheus to post to an existing website blog.

## Observed workflow

1. Load this blog-writing skill and `file-surgery` before substantial workspace inspection or file mutation.
2. Locate the real website repo from the workspace instead of assuming a CMS/Markdown/MDX setup.
3. Inspect the actual blog source files, route/rendering files, sitemap/imports, package scripts, and relevant README/AGENTS guidance before claiming the agent knows how to publish.
4. Record the exact content model and required fields. In the observed Prometheus website case, posts were typed `BlogPost` objects in `PromSite/src/content/blog/posts.ts`, rendered by `src/app/(marketing)/blog/page.tsx` and `[slug]/page.tsx`, and auto-included by `src/app/sitemap.ts`.
5. If making website edits later, append one post using the existing structure, re-read the changed area, preserve unrelated dirty work, and run the safest available repo validation/build.
6. If validation fails on unrelated pre-existing files, report that clearly as a validation blocker rather than treating the blog workflow as failed.
7. Never push, deploy, publish externally, or invent product claims without explicit authorization/evidence.

## Guardrail

For recurring blog agents, keep claims source-grounded: use workspace notes, audit summaries, product docs, completed tasks, site copy, or user-provided facts. Avoid generic AI/SaaS marketing filler and clearly separate local draft staging from external publishing.