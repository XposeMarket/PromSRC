---
name: investigation-mode
description: "Orchestrated debugging coordinator. Triggers on frustration signals (stuck, hung, broken, waiting) and systematically triages: runtime logs → workflow status → browser verify → deploy/env. Reports findings at every step."
---

# Investigation Mode — Orchestrated Debugging

When a user reports something stuck, hung, broken, or not responding, you are the **diagnostic coordinator**. Do not guess. Follow the triage order, report evidence at every step, and stop at a high-confidence root cause. This skill is Prometheus's native port of the Vercel investigation coordinator: use Prometheus workspace, shell, browser, connector, process, and workflow tools where available, and treat provider-specific CLI commands as optional adapters rather than assumptions.

## Reporting Contract

Every investigation step MUST follow this pattern:

1. **Tell the user what you are checking** — "I'm checking the runtime logs for errors…"
2. **Share the evidence you found** — paste the relevant log line, status, error, or screenshot
3. **Explain the next step** — say what you will check next.

Never silently move between steps. The user is already frustrated — silence makes it worse.

## Triage Order

Work through these in order. Stop as soon as you find the root cause.

### 1. Runtime Logs (check first — most issues leave traces here)

- **Dev server**: Check terminal output for errors, warnings, unhandled rejections
- **Hosted logs**: use the connected provider's observability/log tool when available; use `vercel logs --follow` or `vercel logs <deployment-url>` only when this is actually a Vercel project with the CLI configured
- **Browser console**: Open DevTools → Console tab for client-side errors
- **If no logs exist**: This is the problem. Add logging before continuing (see "Add Logging" below)

Tell the user: "Checking runtime logs…" → share what you found → explain next step.

### 2. Workflow / Background Job Status

If the app uses workflows, queues, or cron jobs:

- Inspect Prometheus task, process, scheduler, queue, or connector status first. For Vercel Workflow projects, `vercel workflow runs list` is an optional adapter.
- Look for runs stuck in `running` state — likely a missing `await` or unresolved promise
- Check individual run details with the provider's run-inspection tool, or `vercel workflow runs get <run-id>` for Vercel Workflow.
- Look for failed steps, retry exhaustion, or timeout errors

Tell the user: "Checking workflow run status…" → share the run state → explain next step.

### 3. Browser Verification

Use Prometheus browser automation to visually verify what the user sees when a UI is involved. Reuse `local-file-browser-verification` for local HTML/browser artifacts and use the connected browser session for authenticated app state:

- Take a screenshot of the current page state
- Check the browser console for JavaScript errors
- Check the Network tab for failed requests (4xx/5xx, CORS errors, hanging requests)
- Look for hydration mismatches or React error boundaries

Tell the user: "Taking a browser screenshot to see the current state…" → share the screenshot → explain what you see.

### 4. Deploy / Environment Status

- Inspect the deployment/build/process status through the relevant provider or Prometheus process tools. `vercel inspect <deployment-url>` and `vercel ls` are Vercel-only adapters.
- Check for environment variable mismatches between local and production
- Verify the correct branch/commit is deployed

Tell the user: "Checking deployment status…" → share the deployment state → explain findings.

## Stop Condition

**Stop investigating when:**

- You find a high-confidence root cause (specific error, missing env var, failed step, etc.)
- Two consecutive triage steps produce no signal — report what you checked and that you found no evidence, then ask the user for more context

**Do not** keep cycling through steps hoping something appears. If logs are empty and workflows look fine, say so and ask the user what they expected to happen.

## Common Hang Causes

When logs point to code issues, check these frequent culprits:

- **Missing `await`**: Async functions called without await cause silent failures
- **Infinite loops**: `while(true)` without break conditions, recursive calls without base cases
- **Unresolved promises**: `new Promise()` that never calls `resolve()` or `reject()`
- **Missing env vars**: `process.env.X` returning `undefined`
- **Connection pool exhaustion**: connections not released
- **Middleware chains**: a middleware never calls `next()` or returns a response
- **Timeout misconfigs**: function timeout too short (check `vercel.json` maxDuration)

## Add Logging (If Missing)

If the investigation reveals insufficient observability and the user asked for a fix or instrumentation, add the smallest structured logging patch immediately — you cannot debug what you cannot see. If the user asked for diagnosis only, propose the instrumentation and wait before changing files. Do not log credentials, tokens, request bodies containing secrets, or personal data.

```typescript
// API routes — wrap handlers with try/catch + logging
export async function POST(request: Request) {
  console.log('[api/route] incoming request', { method: 'POST', url: request.url });
  try {
    const result = await doWork();
    console.log('[api/route] success', { resultId: result.id });
    return Response.json(result);
  } catch (error) {
    console.error('[api/route] failed', { error: String(error), stack: (error as Error).stack });
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

```typescript
// Workflow steps — log entry/exit of every step
const result = await step.run('process-data', async () => {
  console.log('[workflow:process-data] step started');
  const data = await fetchData();
  console.log('[workflow:process-data] step completed', { count: data.length });
  return data;
});
```

**Key principle**: Every async boundary, every external call, every step entry/exit should have a log line. When something hangs, the last log line tells you exactly where it stopped.
