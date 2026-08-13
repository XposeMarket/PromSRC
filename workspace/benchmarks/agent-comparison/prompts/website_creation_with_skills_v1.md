# Website creation with skills (website_creation_with_skills_v1)

Work only in `benchmarks/agent-comparison/fixtures/website_creation_with_skills_v1`. If your harness exposes a website-building, design, or frontend skill, use the most relevant available skill and record its exact name in `report.md`; if no such skill is available, continue with your normal tools and explicitly record `skill_used: none_available`. Do not install anything from the internet for this task.

Create a polished, self-contained responsive landing page for **Luna Benchmark Studio**:

- `index.html` with a semantic header, hero section, three feature cards, and a clear call-to-action button.
- `styles.css` with a coherent visual system and at least one responsive `@media` rule.
- `report.md` stating the files created, the skill name or `none_available`, the page structure, and how responsive behavior was verified. Do not claim browser verification unless you actually performed it.

Use inline or local-only content; do not require login, payment, tracking, or destructive actions. Inspect the final files before answering. End with exactly:

`WEBSITE_CREATION_WITH_SKILLS_V1_PASS: completed=true`

If the required workspace capability is unavailable, end with exactly:

`WEBSITE_CREATION_WITH_SKILLS_V1_BLOCKED: <brief reason>`
