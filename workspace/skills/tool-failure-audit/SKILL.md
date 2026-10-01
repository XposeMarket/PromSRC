---
name: "tool-failure-audit"
description: "Audit repeated Prometheus tool failures over a bounded period and classify defects versus misuse. Use for batch audit passes; not for one live failure (prometheus-runtime-forensics)."
---

# Tool Failure Audit

Source of truth: the configured workspace `tool_audit.log` has one line per tool call, `[ISO] OK|FAIL tool(args) => result`, and FAIL lines carry the exit code and error tail. It can be large, so never read it with read_file.

## 1. Run the script (about 3s)

```powershell
# cwd = workspace root (configured workspace root)
powershell -NoProfile -ExecutionPolicy Bypass -File skills\tool-failure-audit\scripts\tool-failure-audit.ps1 -Days 7 -Top 30
# inspect output and any report artifact returned by the script
```
It groups by `tool/action` (tool_call is attributed to the inner connector tool) plus a normalized error signature, and gives count, first and last seen.

## 2. Classify every signature above ~3 hits

| Class | Examples (9/18-9/25) | Action |
|---|---|---|
| **Runtime bug**: the tool should have accepted it or handled it | `pull_number` via tool_call, patchset `edits` as a string, batch_read `paths`, false exit -1, connector "not enabled", `brain_thought_submit` schema drift | Fix PR via `promsrc-pr-worktree` with a regression built from the sample line |
| **Agent misuse**: I called it wrong and the error was correct | `search` on a file path ("not a directory"), grep on a missing file, `kill` on a finished run, shell file-edits blocked by policy | Update the relevant skill (usually `windows-shell-playbook`) with the right pattern. Don't change the tool unless the error message is unhelpful. |
| **Expected/benign** | `rg` exit 1 = no matches, `git diff --exit-code`, test scripts failing on purpose | Ignore. If it's noisy, note it in the shell playbook. |
| **External/transient** | GitHub 5xx, provider 429, network | Only act if it recurs across days or has no fallback (e.g. spawn 429 with no fallback = runtime bug) |

## 3. Check fix status for each runtime bug

- `Last` seen before the fix's merge time plus no hits since means **fixed**. Check the merge time with `git -C <PromSRC-repo-path> log --format='%h %cI %s' -20`.
- Still hitting after the fix merged means **regression or incomplete fix**. Example: #434 fixed `pull_number` on the direct tool but not the tool_call path, so it kept failing.
- A fix merged but the gateway hasn't restarted since means **pending restart**. Compare PID age vs build (see `prometheus-runtime-forensics` §4).

## 4. Deliver

1. One fix PR per coherent group of runtime bugs, each with a regression test. Do not merge without the owner's authorization.
2. Skill patches for misuse patterns: edit the skill directly, since these are workspace files.
3. A short report to the requester: totals, fixed vs still live (with last-seen timestamps), PRs opened, skills changed.
4. `write_note` with the still-open list so the next audit can diff against it.

## Scheduling

Weekly is the right cadence. If the requester wants it automated, create a Sunday schedule that runs this skill and reports. Don't create the schedule unasked.

## Notes

- Deep dives on a single failure: `rg -n 'FAIL <tool>' tool_audit.log | Select -Last 10`, then open the source with `rg -n "<error text>" <PromSRC-repo-path>\src`.
- Don't spawn 4 background digesters for this. The script plus rg is faster, and the spawns all 429'd on 9/25.
