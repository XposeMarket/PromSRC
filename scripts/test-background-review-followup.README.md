# Background review follow-up integration regression

Run from this checkout (no install, account, server or network needed):

```powershell
node scripts/test-background-review-followup.mjs
```

## Boundary exercised

This is not a source-pattern test or a mocked `handleChat` transcript. It reuses
`src/testing/replay/harness.ts` to initialize the real chat router. The actual
`backgroundSpawn` and `backgroundFollowUp` task-runner executors invoke the real
`handleChat` pipeline; only the provider and tool execution are replaced through
existing testing overrides. The wrapper around `handleChat` only records its
arguments and delegates unchanged.

The scripted provider records deep copies of the messages received by its actual
`chat(messages, model, options)` method. Four requests are expected:

1. Original assignment: no follow-up question, verdict or tool-only fact yet.
2. Original assignment after one synthetic `skill_list` tool call: receives the
   unique fact and returns a verdict deliberately omitting that fact.
3. First request of the **second worker invocation**, admitted through
   `backgroundFollowUp`: must receive the new question, first verdict **and**
   unique tool-only fact. Returns an answer without another tool call.
4. Independent fresh spawn: receives its own first assignment, not the prior
   question/verdict/fact.

The test additionally checks the follow-up has a fresh execution ID, retains the
original worker session, is not a rerun of the first assignment, publishes the
follow-up result, and performs exactly **one total synthetic read**. Thus “second
request” here means the first model request of the follow-up invocation, not the
ordinary tool-loop request that produced the original verdict.

## Isolation

Before application modules load, config/data/workspace/profile/home roots and
cwd are redirected into a new temporary directory. The existing replay harness
creates a nested temporary workspace. No gateway startup runs: only the headless
replay router initializes, so schedulers/channels/recovery are never started.
Preview mode must be off because the core deliberately rejects follow-up
admission in preview; fail-closed I/O guards provide isolation instead.
Model-call and context-build workers are disabled (the guarded process performs
all model and context work). All provider calls use the
in-process `ScriptedProvider`, including deterministic side-channel `generate`.
All tool execution is intercepted: only the synthetic `skill_list` read is
allowed, and every other tool fails closed. `fetch`, HTTP(S) and TCP connections
are fail-closed guards; attempted networking is recorded and fails the test.
No account, production runtime, live user data or real tool input is required.
The launcher owns the outer temporary root and removes it after child exit,
when Windows SQLite/watch handles are closed. Coalesced writes drain before the
child exits explicitly because application modules may install timers.
The launcher also imposes a 90-second hard ceiling.

## Limitations

This exercises the real **provider-interface boundary and message assembly**,
not an external vendor adapter's HTTP serialization, authentication or remote
context retention. The provider response and tool observation are deterministic
stubs. The script does not start an HTTP gateway/Electron/UI, exercise restart or
pruning, or prove remote model reasoning. Those are separate concerns from the
regression it targets: whether actual follow-up model input contains evidence
omitted from the first verdict without rereading. Admission/ownership/idempotency
and restart coverage belong to the core task-runner regressions.

The test deliberately fails (rather than silently skipping or fabricating a
follow-up) if the concurrent core `backgroundFollowUp` implementation is absent.
