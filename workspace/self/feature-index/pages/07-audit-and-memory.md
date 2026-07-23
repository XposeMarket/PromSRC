# Audit Log and Memory Graph

## Audit Log

Owner: `web-ui/src/pages/AuditPage.js`. The Audit page is a paginated/filterable view of non-main-agent and operational activity. It helps inspect provenance—agent/run/event details and related proposal context—without re-running the work. It is not a replacement for a task’s live journal or a process’s stdout/stderr log; use the originating Task or process card for those.

## Memory Graph

Owner: `web-ui/src/pages/MemoryPage.js`; memory runtime details: `../13-memory.md`.

The Memory page visualizes indexed/file-backed knowledge as an interactive graph. A user can pan/zoom, select nodes/hubs, inspect record summary/source/related records, and navigate memory relationships. The graph is a discovery/inspection surface over memory records; it does not automatically make every node permanent truth. Claim review, consolidation, acceptance/rejection/supersession and index status remain distinct memory operations.

## Documentation boundary

Say that Audit provides operational history and Memory provides durable knowledge navigation. Do not say that either page gives a complete raw terminal log, private provider chain-of-thought, or automatic fact verification.
