# Update and Delete Patterns - Best Practices

Safe patterns for modifying and removing scheduled jobs.

## Update Patterns

### Pattern 1: Safe Prompt Updates via Patch
```javascript
// 1. Inspect current state first
schedule_job_detail({
  "job_id": "prometheus-x-posts"
})

// 2. Preview the change
schedule_job_patch({
  "action": "preview",
  "job_id": "prometheus-x-posts", 
  "instruction_prompt": "NEW PROMPT CONTENT HERE..."
})

// 3. Apply if diff looks correct
schedule_job_patch({
  "action": "apply",
  "job_id": "prometheus-x-posts",
  "instruction_prompt": "NEW PROMPT CONTENT HERE...",
  "confirm": true
})
```

### Pattern 2: Schedule/Timing Updates
```javascript
// Use full update for schedule changes
schedule_job({
  "action": "update",
  "job_id": "prometheus-x-posts",
  "confirm": true,
  "schedule": {
    "kind": "recurring", 
    "cron": "0 */6 * * *"  // Changed from every 3 hours to every 6
  }
  // Preserve other fields - read detail first!
})
```



## Delete Patterns

### Pattern 1: Safe Deletion
```javascript
// 1. List to confirm job exists and get exact ID
schedule_job({"action": "list"})

// 2. Get detail to understand what you're deleting  
schedule_job_detail({"job_id": "target_job_id"})

// 3. Delete with exact ID (not name)
schedule_job({
  "action": "delete",
  "job_id": "job_1234567890_abcde", // Use exact ID, not name
  "confirm": true
})
```

### Pattern 2: Delete by Name (if ID unknown)
```javascript
schedule_job({
  "action": "delete",
  "job_id": "prometheus-x-posts", // Name works too
  "confirm": true  
})
```

### Pattern 3: Bulk Cleanup
```javascript
// List all first
const jobs = schedule_job({"action": "list", "limit": 50})

// Delete multiple with individual calls
for (const job of problematicJobs) {
  schedule_job({
    "action": "delete", 
    "job_id": job.id,
    "confirm": true
  })
}
```

## Update Safety Rules

### Always Read First
```javascript
// BAD - Blind update
schedule_job({
  "action": "update",
  "job_id": "some_job", 
  "instruction_prompt": "new prompt"
})

// GOOD - Inspect current state
const detail = schedule_job_detail({"job_id": "some_job"})
// Read current prompt, schedule, ownership, delivery
// Then update only what needs changing
```

### Preserve Critical Fields
```javascript
// When updating, preserve:
// - schedule (unless changing timing)
// - delivery settings  
// - enabled state
// - expected outputs
// - timezone

// Copy from detail response, modify target fields only
```

### Use Patch for Prompt-Only Changes
```javascript
// PREFER for instruction_prompt changes only
schedule_job_patch({
  "action": "apply",
  "job_id": "target",
  "instruction_prompt": "updated prompt...",
  "confirm": true
})

// AVOID for prompt-only changes  
schedule_job({
  "action": "update", 
  // Must specify ALL fields to preserve them
})
```

## Common Update Mistakes

### Mistake 1: Losing Assignment
```javascript
// WRONG - May change ownership unexpectedly
{
  "action": "update",
  "instruction_prompt": "new prompt"
  // Missing: subagent_id, delivery, other fields from original
}

// RIGHT - Preserve assignment explicitly  
{
  "action": "update",
  "instruction_prompt": "new prompt",
  "delivery": {"channel": "web"}, // Preserve delivery
  // Copy other critical fields from detail
}
```

### Mistake 2: Breaking Schedule Format
```javascript
// WRONG - Malformed schedule 
{
  "schedule": "every 3 hours" // String not object
}

// RIGHT - Proper schedule object
{
  "schedule": {
    "kind": "recurring", 
    "cron": "0 */3 * * *"
  }
}
```

### Mistake 3: Not Verifying After Update
```javascript
// After any update/patch:
// 1. Reopen detail to verify config
schedule_job_detail({"job_id": "updated_job"})

// 2. Run now to test behavior  
schedule_job({"action": "run_now", "job_id": "updated_job"})

// 3. Check recent run result
schedule_job_history({"job_id": "updated_job", "limit": 3})
```

## Delete Safety Rules

### Get ID Before Deleting
```javascript
// Jobs can have: id, name, both
// Use exact ID for safety when available
const jobs = schedule_job({"action": "list"})
const targetId = jobs.find(j => j.name === "target_name").id
schedule_job({"action": "delete", "job_id": targetId, "confirm": true})
```

### Verify Deletion
```javascript
// After delete, confirm it's gone
schedule_job({"action": "list"})
// Should not show the deleted job
```

### Handle Delete Failures
```javascript
// Common: "Job not found" 
// May indicate: already deleted, wrong ID/name, timing race

// Double-check with fresh list before reporting failure
schedule_job({"action": "list"})
```