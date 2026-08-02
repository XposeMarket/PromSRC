# Prometheus X Posts History

**Purpose**: Track every post made by the `prometheus-x-posts` automated task from @raulinvests to ensure no duplicates. Read this file at the start of every run before crafting a new tweet.

**Format for each entry**:
- **Date/Time**: [ISO or readable]
- **Post Text**: [exact text posted]
- **Tweet ID / Link** (if available): 

---

## Posts Log

*(No posts recorded yet — this file was created on first setup. Future runs will append here.)*

---

**Instructions for the agent**:
- Always read this file first using `read_file("workspace/prometheus-x-posts-history.md")` before generating or posting any new content.
- After successfully posting, append a new entry with the exact text used.
- Keep entries concise. Vary wording naturally each time.
- Goal: Never repeat the same tweet text.