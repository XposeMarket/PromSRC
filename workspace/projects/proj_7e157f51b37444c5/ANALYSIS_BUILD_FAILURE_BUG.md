# Task System Build Failure Bug — Concrete Analysis

**Date:** 2026-03-27  
**Issue:** UI/backend desync when proposal tasks encounter `npm run build` failures with Anthropic models  
**User Preference:** Keep self-healing behavior (agent auto-fixes errors), but sync UI correctly

---

## Root Cause Analysis

### The Problem Flow

1. **Proposal task executes** `npm run build` → fails with TypeScript error
2. **SSE callback** at line 541-551 in `background-task-runner.ts` detects the failure:
   ```typescript
   if (data.error && _isProposalTask) {
     const action = String(data.action || '').toLowerCase();
     const result = String(data.result || '');
     const isBuildFailure =
       (action === 'run_command' && /npm\s+run\s+build|npm\s+run\s+tsc/.test(result) && /exit\s+[1-9]\d*|TIMED OUT/i.test(result)) ||
       (action === 'gateway_restart' && /build\s+failed|Build\s+FAILED/i.test(result));
     if (isBuildFailure) {
       const taskForPause = loadTask(taskId);
       if (taskForPause) this._pauseForAssistance(taskForPause, '...', result.slice(-1500));
       return; // ← Only returns from sendSSE callback
     }
   }
   ```

3. **Backend immediately calls `_pauseForAssistance()`**:
   - Sets task status to `needs_assistance`
   - Broadcasts `task_paused` event
   - **But only returns from the SSE callback function, not from the entire LLM round**

4. **Claude (Anthropic) continues executing**:
   - Same `_runRoundWithRetry()` call is still active
   - LLM has already seen the error in the response and read the prompt's self-healing instructions
   - Claude: "I see a build error. I should fix this and retry build."
   - Executes `find_replace` to fix the error
   - Executes `run_command` to retry `npm run build` → **succeeds** ✅
   - Completes the step with `step_complete()`

5. **UI shows "paused"** but agent keeps working:
   - Frontend loaded task status = `needs_assistance` (paused)
   - Frontend is frozen waiting for user intervention
   - **Meanwhile, backend completes the fix and continues the task**
   - Eventually the task completes successfully in the background
   - Frontend is left showing paused state while task was already finished

---

### Why This Only Happens With Anthropic

**Anthropic models** (Claude):
- Larger context window, better code understanding
- Can reliably parse error messages and auto-fix root causes
- Reads the entire response with error details before completion
- Has enough context to decide "I can fix this myself"

**Smaller models** (Ollama, local):
- May not understand the error context
- Less capable at auto-fixing code
- More likely to genuinely need user assistance
- Would pause correctly because they don't attempt self-healing

**The current code assumes the second scenario** (pause = seek help), but Claude violates that assumption by being too smart.

---

## The Desync Breakdown

| State | Backend | Frontend | Behavior |
|-------|---------|----------|----------|
| **T0: Build fails** | Detected in SSE callback | No update yet | Both synchronized |
| **T1: pauseForAssistance() called** | Status = `needs_assistance` | Receives `task_paused` event | **Diverge:** Backend still running |
| **T2: Claude fixes error** | Continues LLM round | Still showing "paused" | **Worse divergence** |
| **T3: Second build succeeds** | Task continues normally | Still showing "paused" | **Complete desync** |
| **T4: Task completes** | Status = `complete` | Finally updates, but appears as recovery from pause | **User confusion** |

---

## Why Anthropic Specifically?

Claude has been trained on millions of build failures + fixes. When it sees:
```
error TS1234: Cannot find module 'X'
Exit code: 1
```

It **immediately knows the pattern**:
1. Find the import statement referencing 'X'
2. Check if the file exists / is exported correctly
3. Fix it (add export, fix import path, install package)
4. Rerun build

All in the same LLM round, without pausing.

Smaller models don't have this capacity, so they correctly pause and wait.

---

## The Solution: Preserve Self-Healing, Fix UI Sync

Instead of pausing on **every** build failure, implement:

### Option A: Retry Counter (Recommended)
- **First build failure:** Log it, update status to `recovering: npm_build_failed`, let agent continue
- **Second failure in same step:** Log the first retry failure, update status to `needs_recovery_help`
- **Third failure:** Pause with `needs_assistance` and actually wait for user

This allows Claude to self-heal on first try, but stops if it gets stuck in a loop.

### Option B: Model-Aware Behavior (Future)
- Detect if using Anthropic model
- For Anthropic: Only pause on repeated failures
- For smaller models: Pause on first failure
- Requires runtime model detection (can be added later)

### Option C: Disable the Guard for Proposal Tasks
- Remove the automatic pause entirely for proposal tasks
- These are high-stakes edits; we should let the best model attempt recovery
- Only pause if agent explicitly asks for help or hits a real blocker

---

## Implementation Detail: The Fix

**Current code (lines 547-551):**
```typescript
if (isBuildFailure) {
  const taskForPause = loadTask(taskId);
  if (taskForPause) this._pauseForAssistance(taskForPause, 'Build failed — TypeScript did not compile cleanly.', result.slice(-1500));
  return; // Only returns from sendSSE callback
}
```

**Problems:**
1. Calls `_pauseForAssistance()` synchronously in SSE callback
2. Only returns from callback, not from the LLM round
3. No retry counter — treats every failure the same
4. No status update to indicate "recovering" state

**Fix approach:**
1. Add a `buildFailureAttempts` counter in task state
2. On first failure: log + bump counter + do NOT pause + do NOT return
3. On second failure in same step: update status to `recovering` + log + continue
4. On third failure: pause with `needs_assistance`
5. Reset counter when any successful tool call fires

---

## Acceptance Criteria for Fix

✅ Agent can self-heal on first build failure (Anthropic behavior preserved)  
✅ UI shows task as "running" or "recovering", not "paused"  
✅ User can watch progress in real-time  
✅ If agent gets stuck in build loop (e.g., 3+ failures), it pauses for assistance  
✅ No regression: small models still pause correctly (they won't self-heal, so hit limit after 1st)  
✅ Task completes successfully when agent can fix it  

---

## Files to Modify

1. **src/gateway/tasks/background-task-runner.ts**
   - Add `buildFailureRetryCount` to tracking state
   - Modify lines 541-551 to implement retry logic
   - Add status update (e.g., `"recovering"` or keep `"running"`)
   - Reset counter on write/mutate tool calls

2. **src/gateway/tasks/task-store.ts** (if needed)
   - May need to add `buildFailureRetryCount` to TaskRecord if persisting across resumptions
   - Or keep it as local runtime state (preferred)

---

## Risk Assessment

**Low Risk:**
- Only affects proposal tasks + build failures (narrow scope)
- Fallback is still to pause (safe default)
- Retry limit prevents infinite loops
- Existing test coverage should still pass

**Testing Needed:**
- Verify Anthropic model can self-heal successfully
- Verify UI shows "running" (not paused) during recovery
- Verify second/third failures trigger pause correctly
- Verify non-proposal tasks unaffected
