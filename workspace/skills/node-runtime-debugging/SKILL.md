---
name: "node-runtime-debugging"
description: "Diagnose TypeScript and Node.js runtime behavior with reproducible launches, inspector attachment, stack and async-state inspection, source-map checks, memory or event-loop evidence, and bounded verification. Use for runtime debugging, not ordinary TypeScript implementation or generic test failures; not for unrelated general-purpose workflows."
---

# Node Runtime Debugging

Use this workflow when a Node.js or TypeScript process behaves incorrectly, hangs, crashes, leaks memory, loses async context, or needs debugger-level inspection.

## 1. Capture the runtime

Record repository root, entrypoint, package-manager command, Node version, operating system, environment shape without secrets, source-map settings, and the smallest triggering input. Determine whether the process is a worker, CLI, server, test runner, or child process.

## 2. Reproduce safely

Run the narrowest documented command with a bounded timeout and disposable inputs. Capture stdout, stderr, exit code, signal, timing, and relevant logs. Prefer a dedicated debug port bound to localhost. Do not print environment secrets or attach to an unrelated production process.

## 3. Inspect with evidence

When a live process is needed, launch with Node's inspector enabled and attach through an available debugger or protocol client. Inspect breakpoints, stack frames, scopes, promise/async state, event-loop activity, open handles, heap or allocation evidence, and network/file boundaries as relevant. Confirm TypeScript source maps point to the intended source rather than generated or stale files.

Use targeted probes first. Preserve a minimal trace or screenshot where useful, and distinguish a sampled observation from a proof of a persistent leak or race.

## 4. Narrow and repair

Form competing hypotheses, change one variable at a time, and avoid increasing timeouts or adding retries as a substitute for understanding. Make the smallest source/configuration fix, keep process cleanup and cancellation explicit, and add a deterministic regression test when possible.

## 5. Verify

Re-run the original trigger, focused tests, typecheck/build, and one adjacent path. Confirm the debug port is closed and temporary processes are stopped. Report runtime versions, evidence, root-cause confidence, changed files, commands/results, and unverified conditions.
