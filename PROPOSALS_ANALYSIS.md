# Prometheus Proposals System Analysis & Plan

## Executive Summary

**Current State**: Proposals are **read-only by default** with tool-level approval blocking. After approval, executor agents run but still face **blanket file-write restrictions** — there's **no conditional access** based on proposal approval.

**Gap**: When a proposal is approved (e.g., "edit src/config.ts"), the executor task doesn't receive permission to edit those specific approved files. The executor must still request a new proposal or bypass the system.

**Solution Needed**: **Approval-gated file access** — After proposal approval, only the executor task gets special permissions to edit files listed in `affectedFiles[]`.

---

## Current Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent / Task                          │
└────────────────────────┬────────────────────────────────────┘
                         │ (tool calls)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           Tool Registry (src/tools/registry.ts)              │
│                                                               │
│  Tier Router:                                                │
│  - READ: web_search, read_file, list_dir → EXECUTE NOW     │
│  - PROPOSE: write, edit, delete → CREATE DRAFT              │
│  - COMMIT: shell, deploy → WAIT FOR APPROVAL                │
│                                                               │
│  execute(toolName, args) → {draft: proposal} OR result      │
│  executeBypass(toolName, args) → force execution            │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                  ▼
┌──────────────────────────┐       ┌─────────────────────────┐
│   Policy Tier PROPOSE    │       │  Policy Tier COMMIT     │
│  (Multi-agent, Staged)   │       │  (Single tool, Urgent)  │
│                          │       │                         │
│ → proposal-store.ts save │       │ → verification-flow.ts  │
│ → WebSocket broadcast    │       │ → in-memory queue       │
│ → Disk persistence       │       │ → 24h TTL cleanup       │
│ → 7-day archive          │       │ → await(/api/approval) │
└──────────────────────────┘       └─────────────────────────┘
        ▲                                  ▲
        │                                  │
   Need Approval                      Need Approval
        │                                  │
   proposals.router.ts               approvals.router.ts
   POST /approve                     POST /approvals/:id
        │                                  │
        └────────────────┬─────────────────┘
                         │ (executeBypass)
                         ▼
                   EXECUTION HAPPENS
```

### Two Parallel Approval Systems

| Aspect | Proposal Store | Approval Queue |
|--------|---|---|
| **Purpose** | Multi-agent feature ideas, refactoring, skill evolution | Single tool call approvals (shell, deploy, integration calls) |
| **Storage** | Disk: `pending/`, `approved/`, `denied/`, `archive/` | In-memory, 24h TTL |
| **Tier** | PROPOSE (most file writes) | COMMIT (shell, dangerous ops) |
| **Execution** | Executor task spawned post-approval | Immediate `executeBypass()` |
| **UI** | Full proposal board dashboard | Inline approval notification |
| **Files** | [proposal-store.ts](src/gateway/proposals/proposal-store.ts), [proposals.router.ts](src/gateway/routes/proposals.router.ts) | [verification-flow.ts](src/gateway/verification-flow.ts), [approvals.router.ts](src/gateway/routes/approvals.router.ts) |

---

## Current Read-Only Enforcement

### Layer 1: Policy Tier Blocking (Tool Registry)

**File**: [src/tools/registry.ts](src/tools/registry.ts#L330-L450)

```typescript
// Current flow for file write tools:
execute(toolName: 'edit' | 'write' | 'delete', args) {
  const tier = policy.evaluateAction(toolName);
  
  if (tier === 'PROPOSE') {
    // Create draft, return to user, NO execution
    const proposal = {
      type: 'src_edit',
      affectedFiles: [{ path: args.filePath, changes: 'edit' }],
      status: 'pending',
      // ...
    };
    return { draft: proposal };  // ❌ NO FILE EDITED YET
  }
}
```

**Result**: File writes blocked at tool level. User sees draft, must approve before execution.

### Layer 2: src/ Directory Isolation

**File**: [src/tools/source-access.ts](src/tools/source-access.ts)

```typescript
// ONLY these tools exist for src/:
export const readSourceTool = {
  name: 'read_source',
  execute: (path) => {
    if (!path.startsWith('src/')) throw Error('Out of bounds');
    return readFileSync(path);  // ✅ READ ONLY
  }
};

export const listSourceTool = {
  name: 'list_source',
  execute: (path) => {
    if (!path.startsWith('src/')) throw Error('Out of bounds');
    return readdirSync(path);  // ✅ READ ONLY
  }
};

// ❌ NO write_source, edit_source, delete_source tools exist
```

**Result**: src/ cannot be modified except through general `write`/`edit` tools which require approval.

### Layer 3: Blanket Restrictions (Policy Rules)

**File**: [src/gateway/policy.ts](src/gateway/policy.ts#L33-L45)

```typescript
const rules: PolicyRule[] = [
  {
    pattern: /^read_|^list_|^web_search/,
    tier: 'READ',
    risk: 0,
  },
  {
    pattern: /^(write|edit|delete|rename|mkdir|append|apply_patch)/,
    tier: 'PROPOSE',
    risk: 5,
  },
  {
    pattern: /^(shell|deploy|desktop_)/,
    tier: 'COMMIT',
    risk: 8,
  },
];

evaluateAction(toolName: string): 'READ' | 'PROPOSE' | 'COMMIT' {
  // Matches toolName against rules → returns tier
  // ALL file writes → PROPOSE tier always
  // ❌ NO per-file or per-proposal exceptions
}
```

**Result**: ALL file writes require approval, regardless of context.

---

## The Problem: Missing Approval Context in Task Execution

When a proposal is approved and executor task spawns, **there is NO feedback loop** giving the executor special permissions.

### Current (Broken) Flow

```
┌──────────────────────────────────────┐
│ Agent creates proposal:              │
│  {                                   │
│    type: 'src_edit',                │
│    affectedFiles: [                 │
│      { path: 'src/config.ts' }      │
│    ]                                │
│  }                                   │
│ Returns draft to user                │
└────────────┬─────────────────────────┘
             │ (BLOCKED by PROPOSE tier)
             ▼
┌──────────────────────────────────────┐
│ User approves in UI:                 │
│ POST /api/proposals/:id/approve      │
│ WITH executorPrompt:                 │
│   "Apply the edits to src/config.ts" │
└────────────┬─────────────────────────┘
             │ (proposal.status → 'approved')
             ▼
┌──────────────────────────────────────┐
│ Executor task spawned with:          │
│ {                                    │
│   sourceProposalId: 'prop_xyz...',  │
│   executorPrompt: "Apply edits..."   │
│ }                                    │
│                                      │
│ Agent re-attempts:                   │
│   edit('src/config.ts', newCode)     │
└────────────┬─────────────────────────┘
             │
             ▼ Policy.evaluateAction('edit')
┌──────────────────────────────────────┐
│ ❌ PROBLEM:                            │
│ evaluateAction() doesn't know:        │
│  - this edit is for approved proposal│
│  - src/config.ts is in approvedFiles │
│  - proposal is already approved      │
│                                      │
│ Returns PROPOSE tier again            │
│ → Creates another draft              │
│ → Task never actually edits the file │
└──────────────────────────────────────┘
```

**Why This Happens**:
- [policy.ts](src/gateway/policy.ts) has no context about active proposals
- [registry.ts](src/tools/registry.ts) doesn't pass proposal ID to policy
- No task context tracking ("this task is executor for proposal X")
- Policy rules are **stateless** — same rule applies to all agents

---

## Needed Changes: Approval-Gated File Access

### Architecture Change

```
┌─────────────────────────────────────────────────────────────┐
│                     Executor Task                            │
│              (for approved proposal)                         │
│                                                               │
│  Context: {                                                  │
│    sourceProposalId: 'prop_xyz...',                         │
│    approvedFiles: ['src/config.ts', 'src/types.ts'],       │
│    taskId: 'task_abc...'                                    │
│  }                                                            │
└────────────────────────┬────────────────────────────────────┘
                         │ edit('src/config.ts')
                         ▼
┌─────────────────────────────────────────────────────────────┐
│        Policy.evaluateAction(toolName, context)             │
│           (NOW TAKES TASK CONTEXT)                          │
│                                                               │
│ New logic:                                                   │
│  if (context.sourceProposalId && 'src/config.ts' in         │
│      approvedFiles) {                                       │
│    return 'APPROVED_EXECUTOR'  // Special tier              │
│  }                                                            │
│  else return 'PROPOSE'          // Default blocking          │
└─────────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                  ▼
┌──────────────────────────┐       ┌──────────────────────────┐
│ APPROVED_EXECUTOR tier   │       │   PROPOSE tier (normal)  │
│                          │       │                          │
│ → EXECUTE file edit      │       │ → Create draft proposal  │
│ → Track as proposal work │       │ → Return to user         │
│ → Link to sourceProposal │       │ → Await approval         │
│   in audit log           │       │                          │
└──────────────────────────┘       └──────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Pass Proposal Context to Policy & Registry

**Files to modify:**
1. **[src/gateway/session.ts](src/gateway/session.ts)** — Add context to task
   ```typescript
   interface TaskContext {
     taskId: string;
     sourceProposalId?: string;        // ← NEW
     approvedFilePaths?: Set<string>; // ← NEW
   }
   ```

2. **[src/tools/registry.ts](src/tools/registry.ts)** — Accept context in execute()
   ```typescript
   execute(toolName: string, args: any, context?: TaskContext) {
     const tier = policy.evaluateAction(toolName, args, context);
     // ...
   }
   ```

3. **[src/gateway/policy.ts](src/gateway/policy.ts)** — Conditional tier based on context
   ```typescript
   evaluateAction(
     toolName: string,
     args: any,
     context?: TaskContext
   ): 'READ' | 'PROPOSE' | 'APPROVED_EXECUTOR' | 'COMMIT' {
     
     // NEW: Check if this edit is for an approved proposal
     if (context?.sourceProposalId && context?.approvedFilePaths) {
       if (toolName.match(/^(edit|write|delete)/) &&
           context.approvedFilePaths.has(args.filePath)) {
         return 'APPROVED_EXECUTOR'; // ← NEW tier
       }
     }
     
     // Default: existing rules
     return evaluateByRule(toolName);
   }
   ```

### Phase 2: Load Proposal Context When Spawning Executor Task

**Files to modify:**
1. **[src/gateway/proposals/proposal-store.ts](src/gateway/proposals/proposal-store.ts)** — Pass to executor
   ```typescript
   approveProposal(proposalId: string): void {
     const proposal = this.loadProposal(proposalId);
     proposal.status = 'approved';
     
     if (proposal.executorAgentId) {
       // NEW: Create context
       const approvedFiles = new Set(
         proposal.affectedFiles.map(f => f.path)
       );
       
       // Spawn executor with context
       taskManager.spawnExecutor({
         agentId: proposal.executorAgentId,
         prompt: proposal.executorPrompt,
         
         // ← NEW fields
         sourceProposalId: proposalId,
         approvedFilePaths: approvedFiles,
       });
     }
   }
   ```

2. **[src/tasks/executor.ts](src/tasks/executor.ts)** (if it exists) — Inject context into agent
   ```typescript
   async executeTask(task: Task) {
     const executionContext = {
       taskId: task.id,
       sourceProposalId: task.sourceProposalId,    // ← NEW
       approvedFilePaths: task.approvedFilePaths,  // ← NEW
     };
     
     // Pass to agent runtime
     const agent = createAgent({
       ...task,
       context: executionContext,
     });
     
     await agent.run();
   }
   ```

### Phase 3: Update Audit & Tracking

**Files to modify:**
1. **[src/gateway/audit-log.ts](src/gateway/audit-log.ts)** — Link executor actions to source proposal
   ```typescript
   auditLog.record({
     action: 'file_edit',
     tool: 'edit',
     args: { filePath: 'src/config.ts' },
     
     // ← NEW
     sourceProposalId: context.sourceProposalId,
     approvalStatus: 'approved_executor_granted',
     executorTaskId: context.taskId,
     
     timestamp: now(),
   });
   ```

### Phase 4: Update Proposal Store Tracking

**Files to modify:**
1. **[src/gateway/proposals/proposal-store.ts](src/gateway/proposals/proposal-store.ts)** — Execution tracking
   ```typescript
   interface Proposal {
     // ... existing fields
     
     // NEW tracking
     executorTaskId?: string;        // Task ID spawned for execution
     executionStartedAt?: number;    // When executor task started
     executionStatus?: 'executing' | 'completed' | 'failed'; // Executor progress
     filesEditedDuringExecution?: string[]; // Track what was actually modified
   }
   
   markProposalExecuting(proposalId: string, taskId: string) {
     const proposal = this.loadProposal(proposalId);
     proposal.status = 'executing';
     proposal.executorTaskId = taskId;
     proposal.executionStartedAt = Date.now();
     this.save(proposal);
   }
   ```

---

## Files to Review/Modify (Summary)

| File | Change | Priority |
|------|--------|----------|
| [src/gateway/policy.ts](src/gateway/policy.ts) | Add conditional tier logic for approved executors | **P0** |
| [src/tools/registry.ts](src/tools/registry.ts) | Pass context to policy, handle new tier | **P0** |
| [src/gateway/session.ts](src/gateway/session.ts) | Add TaskContext with proposal fields | **P0** |
| [src/gateway/proposals/proposal-store.ts](src/gateway/proposals/proposal-store.ts) | Pass context when spawning executor | **P1** |
| [src/tasks/executor.ts](src/tasks/executor.ts) OR where tasks are spawned | Inject context into agent runtime | **P1** |
| [src/gateway/audit-log.ts](src/gateway/audit-log.ts) | Link edits back to source proposal | **P2** |

---

## Key Questions to Answer

1. **Where is executor task spawned?** (Need to find this file to inject context)
   - [src/gateway/proposals/proposal-store.ts](src/gateway/proposals/proposal-store.ts)#L XXX — Check `approveProposal()` method
   - OR look for task creation in [src/gateway/routes/proposals.router.ts](src/gateway/routes/proposals.router.ts)

2. **How is agent runtime invoked?** (Need to ensure context flows to policy checks)
   - Check [src/agents/spawner.ts](src/agents/spawner.ts) — likely entry point
   - Check [src/gateway/agents-runtime/](src/gateway/agents-runtime/)

3. **How deep should approval context flow?**
   - Option A: Only top-level tool calls check context (simpler)
   - Option B: All nested tool calls inherit context (safer, more correct)

4. **Should approved files be locked after executor completes?** 
   - Once proposal shifts from 'executing' → 'executed', should src/ revert to read-only?
   - Or remain editable (assume executor might loop)?

5. **What if executor modifies files NOT in affectedFiles?**
   - Block it (strict validation)?
   - Allow it with audit warning?
   - Flag as "proposal scope creep"?

---

## Testing Strategy

**Test 1: Blocked by Default**
- Agent tries to edit src/config.ts without proposal
- Expect: PROPOSE tier, draft created ✅

**Test 2: Allowed After Approval**
- Create proposal with affectedFiles: ['src/config.ts']
- User approves
- Executor task spawned with context
- Executor tries to edit src/config.ts
- Expect: APPROVED_EXECUTOR tier, edit executes ✅

**Test 3: Scope Validation**
- Proposal only includes 'src/config.ts'
- Executor tries to edit 'src/types.ts'
- Expect: PROPOSE tier, new draft (or blocked) ✅

**Test 4: Post-Completion**
- Proposal execution completes
- User tries to edit src/config.ts again
- Expect: PROPOSE tier (proposal no longer active) ✅

---

## Summary

**Current Gap**: Proposals are created-only (read-only) by design. After user approval, executor tasks still face blanket write restrictions.

**Root Cause**: Policy tier evaluation doesn't have context about which files are in approved proposals.

**Solution**: Add proposal/task context to policy evaluation. Create new 'APPROVED_EXECUTOR' tier that conditionally allows edits to files in approved proposals.

**Effort**: ~2-3 hours across 5-6 files, mostly in policy.ts and registry.ts.

**Risk**: Low — changes are additive, don't break existing proposal system.
