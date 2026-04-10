---
name: Self-Repair Protocol
description: Prometheus's dedicated playbook for diagnosing and fixing itself. Use whenever something is broken, a tool is failing, a subagent is misbehaving, the workspace is corrupted, or any workflow fails unexpectedly. Triggers on: broken, not working, fix yourself, repair, debug system, agent failing, tool error, something went wrong, self-repair, diagnose, error loop, stuck. Always read this fully before attempting any self-modification.
emoji: 🔧
version: 1.0.0
triggers: broken, not working, fix yourself, repair, debug, agent failing, tool error, something went wrong, self-repair, diagnose, error loop, stuck, crashing, corrupt, investigate failure
---

# Self-Repair Protocol

Read this fully before making any changes. Don't patch blindly.

---

## Step 1: Triage

Before touching anything, answer:

1. **What exactly failed?** What was expected vs. what happened? What's the exact error?
2. **What's the scope?** Is the failure in:
   - A single tool call?
   - A subagent's behavior?
   - The shared workspace/state?
   - A file, script, or config?
   - Agent-to-agent communication?
3. **Is it transient?** Retry once. Flaky network, rate limits, and temp resource exhaustion often self-resolve.

---

## Step 2: Diagnosis Checklist

Work through these in order. Stop when you find the cause.

### Environment
```bash
pwd && ls -la            # Am I where I think I am?
env | grep -E "API_KEY|TOKEN|SECRET|DATABASE"   # Are env vars set?
df -h                    # Disk space OK?
python3 --version        # Runtime available?
node --version
```

### Files & Config
```bash
ls -la /path/to/expected/file          # Does it exist?
cat config.json | python3 -m json.tool # Valid JSON?
head -50 /workspace/SELF.md            # Check core config
```

### Dependencies
```bash
pip show <package>
pip install -r requirements.txt --quiet
npm list <package>
npm install
```

### Connectivity
```bash
curl -s -o /dev/null -w "%{http_code}" https://api.example.com/health
```

---

## Step 3: Subagent Failures

If a subagent is misbehaving:

| Symptom | Likely Cause | Fix |
|---|---|---|
| Returns empty | Missing required context | Add missing data to the prompt |
| Loops / repeats | No clear termination condition | Add explicit stop condition |
| Uses wrong tool | Ambiguous instructions | Specify which tool and when |
| Fails on file path | Wrong path or permissions | Verify path, fix permissions |
| Times out | Task too large | Break into smaller subtasks |
| Hallucinates data | No grounding context | Provide real data or tool access |

**Diagnosis steps:**
1. Re-read the subagent's system prompt — is it clear and complete?
2. Check its last output — bad response, or no response?
3. Check the input it received — was required data present?
4. Check if any tool it depends on returned an error?

---

## Step 4: Workspace & State Repair

```bash
# Inspect workspace
ls -la /workspace/
cat /workspace/skills/_state.json

# Validate state JSON
python3 -c "import json; print(json.dumps(json.load(open('/workspace/skills/_state.json')), indent=2))"

# Backup before modifying ANYTHING
cp /workspace/skills/_state.json /workspace/skills/_state.backup.json

# Inspect memory
ls -la /workspace/memory/
```

Only modify state files after backup. Never modify SELF.md, SOUL.md, or IDENTITY.md without explicit user instruction.

---

## Step 5: Tool Failures

1. **Reproduce with minimal input** — simplest possible call to confirm the failure
2. **Read the error carefully** — permissions? bad args? wrong format?
3. **Check if the tool is registered** — is it in TOOLS.md?
4. **Try an alternative tool** — can another tool accomplish the same thing?
5. **Log and escalate** — if the tool is fundamentally broken, report clearly to user

---

## Step 6: Recovery Patterns

### Pattern A: Restart with clean state
```bash
# Document current state first
cat /workspace/skills/_state.json > /tmp/state_before_repair.json
# Reset the specific broken component, not everything
```

### Pattern B: Rollback
```bash
# Use backup if available
cp /workspace/skills/_state.backup.json /workspace/skills/_state.json
```

### Pattern C: Partial re-init
Re-initialize only the broken component. Don't restart the entire system for isolated failures.

---

## Step 7: Report

After any repair, document:
- What broke
- Root cause
- What was changed to fix it
- Any follow-up risks or monitoring needed

Write this to `/workspace/memory/` as a repair log entry.

---

## Do Not

- ❌ Modify SELF.md, SOUL.md, or IDENTITY.md without user permission
- ❌ Delete workspace state files without backup
- ❌ Restart everything when only one component is broken
- ❌ Patch symptoms without understanding root cause
- ❌ Make multiple changes simultaneously (change one thing, verify, then next)
