---
name: "verification"
description: "Verify a complete user story end to end across UI, client/server code, APIs, processes, data, external dependencies, and the final response. Use when the user asks whether a feature actually works or wants full-flow proof; do not use for unit-test-only requests."
---

# Full-Story Verification

Verify the path a user cares about, not just isolated source files or a green unit test. The default evidence chain is:

`user action → UI/client state → server or API boundary → process/external dependency → persisted or returned data → rendered result`

## 1. Infer the story

Read the request, recent diff, route/component entry point, API or process handler, data layer, environment assumptions, and relevant tests. State the story in one sentence, including the expected visible result. Do not broaden verification to unrelated features.

## 2. Establish evidence

Before interacting, establish the baseline:

- exact branch, build, server/process, URL, or artifact under test;
- browser screenshot/DOM state when a UI exists;
- server, process, workflow, and runtime logs;
- relevant environment/config presence without exposing secret values;
- current data or fixture state.

Use the reporting contract: **Checking**, **Evidence**, **Next**. Never silently jump between layers. Reuse `local-file-browser-verification` for local HTML or localhost browser QA and `investigation-mode` when the baseline shows a hang, timeout, missing response, or unexplained failure.

## 3. Walk the flow

Exercise the real user action through the real surface. At each boundary, confirm both the call and its result:

1. UI control, route, form, or command is available and enabled.
2. Client state/event handler sends the expected method, payload, headers, and identifiers.
3. Server/API/process route is reached and returns or schedules work.
4. Authentication, environment, database, queue, workflow, or external provider behaves as expected.
5. Response/data shape is compatible with the consumer, including loading, empty, error, and retry states.
6. The UI or final artifact renders the intended result, not merely a successful network status.

Check common false positives: missing `await`, wrong HTTP method, absent environment variable, server-only import in client code, type/schema mismatch, swallowed error, stale build, wrong port, caching, race conditions, and error boundaries that hide the failure.

## 4. Verify negative and adjacent paths

When risk warrants it, test one invalid input, failed dependency, empty result, retry, or permission boundary. Test one adjacent regression path. Do not turn a focused verification into an unbounded QA sweep.

## Stop conditions

Stop at the first broken boundary and report the exact evidence. If two consecutive layers produce no signal, report the limitation and ask for the missing evidence rather than repeating the same check. Do not declare success from elapsed time, a successful click, a 200 response alone, or absence of console errors alone.

## Report

Return:

| Layer | Expected | Evidence | Result |
| --- | --- | --- | --- |
| UI/client | | | pass/fail/blocked |
| server/API/process | | | pass/fail/blocked |
| data/external dependency | | | pass/fail/blocked |
| final response/render | | | pass/fail/blocked |

Then state the root cause or confidence level, tests/checks run, artifact or URL verified, and remaining risks. Never claim end-to-end success when a dependency-backed layer was not actually exercised.
