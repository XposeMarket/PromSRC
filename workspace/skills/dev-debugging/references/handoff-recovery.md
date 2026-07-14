# ChatGPT handoff recovery

Read this only when an explicitly requested ChatGPT desktop handoff fails or needs bounded follow-up.

## Window and conversation recovery

- Resolve the installed ChatGPT app and acquire a fresh exact window token. A missing window is a discovery/launch problem, not permission to type into the current focus.
- The default is a fresh chat. If the user names an existing conversation or says to stay in the current chat, that instruction wins; locate the requested conversation from fresh visible state and do not press `Ctrl+N`.
- After opening a new chat, wait for the composer to become visibly ready before typing. Do not rely on a fixed key sequence alone.
- A successful keypress or tool result is not proof of submission. Confirm the prepared prompt is visible in the conversation after Enter.

## Prompt transport failures

If long text fails through typing or clipboard automation:

1. Do not repeat the same failing payload.
2. Reduce the prompt to short plain text with minimal punctuation and no Markdown fences, backticks, or nested quoting.
3. Use short chunks only when the active desktop tool supports them and the composer state remains verifiable.
4. If transport still fails, stop. Preserve the exact unsent prompt in a note and report the tool blocker; never claim submission.

Keep detailed paths, logs, and artifact comparisons in the note when they cannot safely fit through desktop input. For media/export defects, include the failing artifact, any known-good comparison, and the observed visual or audio symptom.

## Modal and permission recovery

Treat any permission, confirmation, recovery, or ambiguous modal as a new state. Capture a fresh exact-window image and verify the label and consequence before one action. Never click a sequence of guessed modal coordinates.

Do not echo raw coordinate traces or tool fragments to the user. Report the grounded state: submitted, still working, completed, failed, or blocked—with the specific reason.

## Fetch or helper failure

- A bare infrastructure error such as `fetch failed` is not a final result. Inspect whether the prompt was typed or submitted, then make at most one screenshot-grounded recovery attempt.
- Use only desktop inspection helpers present in the active tool schema. When text extraction is unavailable, rely on a fresh screenshot and state that exact response text could not be extracted.
- If the target conversation or prompt cannot be recovered safely, preserve both in a note so a later turn can resume without reconstruction.

## Follow-up and truthfulness

- Create a timer only when the user requested asynchronous monitoring or the active surface supports it. Cap automatic checks at two.
- A blank or still-working response may schedule one final check; the final check reports status and stops.
- A ChatGPT claim that code was fixed is not source verification. Prometheus must inspect the resulting diff, run the required build/tests, and route source mutations through the governed source-proposal workflow.
- Never bypass an approved proposal by asking ChatGPT to patch directly outside that lane.
