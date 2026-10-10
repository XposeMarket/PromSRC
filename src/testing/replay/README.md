# Turn-loop replay harness

Runs the real `handleChat` turn loop headless against a scripted model. No
gateway server, Electron, browser, network, real provider or real account is
involved. Everything is written to a throwaway `PROMETHEUS_DATA_DIR`.

```
npm run test:replay                         # all scenarios
npm run test:replay -- tool-round-trip      # one or more ids, comma separated
REPLAY_VERBOSE=1 npm run test:replay        # keep gateway console output
```

## What is real and what is fake

| Real (the code under test) | Fake |
|---|---|
| prompt/context assembly, tool surface, category gating | the model: `ScriptedProvider` |
| policy, approval queue, `executeTool`, tool results | side-effect tools: per-scenario stubs |
| loop detector, abort handling, SSE events, sessions | approvals: resolved by the scenario's `approvals` policy |

Two test-only seams make this possible, both refuse to arm when
`NODE_ENV=production`:

- `setProviderOverrideForTesting(provider)` in `src/providers/factory.ts`: every
  factory entry point returns the scripted provider.
- `setToolExecutionOverrideForTesting(fn)` in `subagent-executor.ts`: the harness
  records every dispatched tool, runs stubs, and **blocks any side-effect tool
  without a stub** (desktop, browser, shell, network, connectors, delivery...).

The harness loads modules with `require`, not `import()`. Under tsx a dynamic
`import()` of a `.ts` file builds a second module graph with its own
singletons, so the scenario would resolve approvals on a different queue than
the runtime uses.

## Writing a scenario

Add an entry to `scenarios.ts`:

```ts
{
  id: 'tool-crash-is-reported',
  kind: 'contract',
  contract: 'A tool that throws becomes an error result the model can see.',
  input: {
    message: 'Fetch it',
    tools: { web_fetch: () => { throw new Error('socket exploded'); } },
    script: [
      { toolCalls: [{ name: 'web_fetch', args: { url: 'https://example.com' } }] },
      { text: 'Handled the failure.' },
    ],
  },
  check(run) {
    assert.match(lastToolResultText(run.provider.requests[1]), /socket exploded/);
  },
}
```

Script steps: `{ text, toolCalls, thinking, delayMs, stopReason }`, `{ throw }`,
or a function that receives the recorded request (messages, offered tool names)
and returns a reply. `rawArguments` sends malformed tool JSON.

`run` exposes `result`, `error`, `events`, `provider.requests`, `dispatched`,
`blockedTools`, `approvals`, `finalEvents`, `aborted`, `timedOut`, `elapsedMs`.

## contract vs known_gap

- `contract`: behaviour we rely on. A failure fails CI.
- `known_gap`: the intended behaviour for a bug that is not fixed yet. It is
  reported as XFAIL. When a fix makes it pass, the runner fails with `FIXED?`
  so the fix PR promotes it to `contract` and the guarantee is locked in.
