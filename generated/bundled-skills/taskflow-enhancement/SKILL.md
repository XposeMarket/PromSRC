---
name: "taskflow-enhancement"
description: "Build, implement, or extend Prometheus task orchestration with child tasks, dependencies, waits, checkpoints, resumable summaries, progress, artifacts, and retry policy. Use for durable multi-step task flows or task-engine changes; do not use for a simple one-step task."
---

# TaskFlow Enhancement

Use this skill when designing or implementing OpenClaw-style task orchestration inside Prometheus.

## Prometheus Fit

Prometheus already has tasks, jobs, teams, memory, Brain Thought/Dream, skill gardener/curator, and workspace state. TaskFlow should extend those systems rather than creating a second task engine.

## Workflow Shape

A Prometheus task flow should support:

- parent and child task relationships
- dependency waits
- resumable checkpoints
- structured progress events
- final and partial summaries
- artifacts and links
- failure reasons and retry policy
- Brain-visible lessons when repeated patterns emerge

## Rules

- Keep task state in existing Prometheus task/job stores when possible.
- Do not hide child tasks from the user; expose status in the same task surface.
- Every long workflow needs a resumable summary.
- Waiting on a task should release the chat turn and resume through jobs/events.
- Failed steps should keep enough context for Brain/curator review.
- TaskFlow should work with connector tools and CLI adapters through typed tool calls, not raw shell.

## Implementation Route

1. Inspect current task/job/team schemas before changing source.
2. Add missing state fields conservatively: parent, children, dependencies, checkpoint, progress, artifacts.
3. Add helpers for create child task, wait for dependency, resume from checkpoint, and summarize flow.
4. Wire status into existing UI surfaces.
5. Let Brain and Skill Gardener consume task-flow lessons as normal evidence.

## Acceptance Check

Prometheus can run multi-step workflows that pause, resume, branch, and report progress without losing context between turns.
