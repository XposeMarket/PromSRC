# Linked memory topics

MEMORY.md remains authoritative. Add explicit `[[Topic Name]]` labels to facts to connect them without relying on shared wording. Topic names are case-insensitive, whitespace-normalized, 1–80 characters, and accept letters, numbers, spaces, dots, underscores, apostrophes and hyphens. There are at most 16 topics per fact.

Both deterministic fallback and hybrid retrieval expand one hop from up to six strong direct matches, adding at most two linked candidates inside existing selection budgets. It does not recursively traverse related facts or make another model call. Selected topics can produce up to four `N more related facts` pointers.

Use `memory(action:"related", query:"Topic Name", limit:20)` for explicit backlinks. The result is capped at 50 facts and approximately 12,000 characters. Agent/manager reads resolve to their personal MEMORY.md, not the main user's memory. Inactive/untrusted/instruction-like records are filtered with the existing recall sanitizer.

The rebuildable `.memory-index/topics.sqlite` backlink projection is workspace-local and refreshed by explicit related reads, never synchronously during per-turn retrieval. Markdown is always reread by the explicit related action; retrieval follows the existing snapshot refresh. SQLite failures fall back to in-memory links. Remove a label or fact in MEMORY.md to remove its link on refresh. No new graph UI, topic-page migration or scheduled Brain job is introduced.

Writes to MEMORY.md conservatively append at most three already-known multiword topic labels when the new fact contains those exact topic words. They do not infer relationships or create new topic names. Existing explicit labels are not duplicated.

Validation: `node --import tsx scripts/test-memory-topics.mjs`, existing hybrid-memory regressions, and TypeScript checking. This is a shared backend feature, independent of desktop/mobile rendering and provider model.
