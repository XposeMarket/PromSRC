### [COMPACTION_SUMMARY] 2026-04-05T04:21:22.998Z
Found it. **LangChain's `DynamicTool`** and **Composio's custom tools** are the exact patterns you need.

**Here's what exists:**

1. **LangChain DynamicTool** — lets you create tools at runtime from a function, name, and description. Not hardcoded; you define them on the fly.

2. **Composio Custom Tools** — compose multiple API calls into a single reusable tool. You define the pipeline once, call it as one tool after.

3. **MCP Protocol** — supports `notifications/tools/list_changed` so tools can be added/removed dynamically at runtime without reconnection.

**What you're describing is absolu

### [COMPACTION_SUMMARY] 2026-04-05T05:48:09.788Z
**Done.** The proposal is submitted and ready for approval.

**Summary of what happened:**

1. ✅ You rejected the first proposal  
2. ✅ I found the real root cause: **stale monitor dimensions in the desktop advisor packet cache**
3. ✅ New proposal submitted with the correct fix: **refresh the advisory packet by calling `desktopScreenshot()` silently before showing the monitor menu**

When you approve this, the fix will:
- Call `desktopScreenshot(sessionId, { capture: 'all' })` (fire-and-forget)  to refresh the cached dimensions
- Show the menu with current monitor info
- When user clicks a mon

