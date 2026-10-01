---
name: "fast-coding-loop"
description: "Default coding workflow for Prometheus main chat and every coding agent: locate with one multi-pattern search, read big windows in batches, edit in batches, verify once. Use for any bug fix, feature edit, refactor, or read-only code investigation in PromSRC or any repo. Not for UI/desktop automation or non-code research."
---

# Fast Coding Loop (default coding workflow)

Every tool call is a full model round trip that re-sends the whole prompt (often 5-15 s each). A 120-call investigation is 10-20 minutes no matter how small each read is. Optimize for **fewest calls**, not fewest tokens per call.

## Budget
- Typical bug: <= 12 calls before the first edit, <= 25 total. Multi-area work (3+ subsystems): ~10 per area.
- At ~20 calls with no edit: stop, write down exactly what is unknown, then do one targeted probe or ask.
- Investigation agents: return a concise findings list (file:line + one-line cause + proposed fix). No exhaustive citation reports.

## 0. Before searching
- If the task continues earlier work, use the RECENT_EDIT_LOG / notes first: it gives exact file:line sites. Go straight there.
- Write the list of questions you need answered. Each search call should answer several of them.

## 1. Locate (1-2 calls)
One shell search with several alternated patterns and line numbers across the likely dirs:
```
rg -n "fnA|fnB|'event\.name'|CONST_X" src web-ui/src -g "*.ts" -g "*.js" | Select-Object -First 60
```
- Include definitions AND call sites in the same pattern.
- Cap output instead of running narrower searches later.
- Use `rg -c` first when a pattern may have hundreds of hits, to learn which file matters.

## 2. Read big, in parallel (1-3 calls)
- read_files_batch with several `{filename,start_line,num_lines}` windows in ONE call, `max_lines_per_file` up to 240, `inline:true`, `max_result_tokens` high enough (e.g. 12000-24000) so the batch is not cut after file 1.
- Or one shell call printing several exact ranges with line numbers (see PowerShell helper below).
- Never re-read the same region in 40-80 line slices.
- Old tool results get elided later in long turns. Before moving on from a read, note the exact anchor lines you will edit (in your reasoning) so you never need to fetch them again.
- Huge files (10k+ lines): find function boundaries first, then read the whole function at once.

## 3. Edit (1-3 calls)
- Put every independent edit in the same assistant turn (parallel workspace_edit calls), or use one patchset call.
- find_replace: parameters are `find` / `replace` (single edit). Anchors: 2-4 distinctive lines copied exactly. The tool returns post-edit context: trust it, do not re-read.
- CSS in huge cascades (mobile.css): add one final-authority block at the end with the needed specificity (match any `#id` selectors that win today) rather than hunting every older override.
- Add a regression test in the same batch when a test file exists.

## 4. Verify once (1-2 calls)
One combined command; start it in the background if slow and do docs/notes/skills while it runs:
```
node --check changed.js; npx tsc --noEmit | Select-Object -Last 10; node scripts/test-x.mjs; npm run sync:web-ui; npm run check:web-ui; npm run build
```
Wait once. Restart the gateway only after the build step prints exit 0.

## Delegating (background agents)
Spawn only when the work is genuinely parallel or long. A brief must contain: exact files/dirs, the concrete questions, the budget ("<= 20 tool calls"), the output shape ("<= 15 bullets, file:line + cause + fix"), and read-only vs edit scope. Never ask for a "full report with citations". Do useful foreground work while it runs instead of waiting in long blocks. For multi-lane implementation with worktrees see `background-coding-agent-lanes`.

## Anti-patterns that cause 5+ minute turns
- One pattern per grep, then another, then another.
- Reading 80 lines, then the next 80, then 40 around a line you just saw.
- Running tsc/build after every hunk.
- Background agent spawned for a question one rg can answer.
- Waiting on background agents in 5-minute blocks while doing nothing in parallel.
- Re-running a command because of a shell syntax error you could have avoided (see below).

## PowerShell notes (Windows host)
- Numbered range helper, safe to reuse in one call:
  `$f=Get-Content x.js; function p($a,$b){ for($i=$a;$i -le $b;$i++){ "$i`t$($f[$i-1])" } }; p 120 200; p 900 960`
- Do not pipe a `for`/`foreach(){}` statement into `|` (EmptyPipeElement parser error). Wrap it: `& { ... } | Select-String x`.
- `rg pattern *.js` fails (no shell glob expansion): use `rg pattern dir -g "*.js"`.
- Avoid `"` inside rg patterns in a double-quoted PowerShell string (TerminatorExpected): use `'` or `\x22`.
- `$f[a..b]` is 0-based: line N is `$f[N-1]`.
