---
name: "runtime-operations-incident-response"
description: "Diagnose and safely recover Prometheus gateway and runtime incidents. Use for health checks, restart prerequisites, and post-recovery proof; not for deep timestamped root-cause analysis (prometheus-runtime-forensics)."
---

# Runtime Operations and Incident Response

Use this for Prometheus runtime health, gateway/process/provider anomalies, restart state, recurring errors, and operational incidents. It is read-only diagnosis first; application source changes belong to an approved source-edit workflow.

## Snapshot first

Run the public-safe system diagnostics snapshot, focusing on the suspected subsystem. Record gateway heartbeat, runtime state, automation anomalies, provider health, restart state, recurring errors, build status, and audit freshness. Separate observed behavior from hypothesis.

## Isolate the layer

Classify the incident as gateway/runtime, provider/model, automation/task, integration, workspace/build, audit/persistence, delivery, or application defect. Capture a sanitized incident packet with minimal reproduction, evidence, attempted operational recoveries, uncertainty, and severity/confidence. Do not expose secrets or raw internal payloads.

## Safe recovery order

Prefer read-only diagnostics, existing retry/backoff cancellation, stale-run cleanup, or connection repair before restart. Before any restart, inspect active tasks, approvals, scheduled jobs, unsaved artifacts, and user-visible work. Do not restart merely because one request is slow. A restart does not prove external rollback.

## Verify after recovery

Re-check gateway health, provider readiness, automation state, build/restart state, audit freshness, and the original symptom. Confirm active work and approvals survived or report what was lost. Resolve the incident only with bounded evidence that the expected behavior returned; otherwise leave it open with the next safe gate.
