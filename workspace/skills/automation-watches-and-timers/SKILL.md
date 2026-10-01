---
name: Automation Watches and Timers
description: Operate Prometheus internal_watch and timer tools safely. Use for file, task, scheduled-job, and event-queue watches; one-off reminders; TTL, firing-limit, delivery-policy, timeout, duplicate, and matched-condition recovery.
version: 1.0.0
triggers: event queue watch, one-off timer, internal_watch tool, timer tool, file watch, task watch
---

# Automation Watches and Timers

Use this for the internal_watch and timer tools. Use scheduler-operations-playbook for recurring scheduled jobs and task-lifecycle for durable task control. Route recurring monitoring of external feeds, GitHub repositories and releases, pages, listings, and prices to `change-and-price-watch`.

## Choose the mechanism

Use a timer to wake the current main chat at a known delay or timestamp. Use internal_watch to observe a typed file, task, scheduled-job, or event-queue condition and wake or notify when it matches. Use a scheduled job for recurring or future autonomous work. Never use a timer or watch as a substitute for a recurring job or manual polling.

## Create safely

Define the exact target, condition, TTL, firing limit, delivery mode, and on-match instruction. Keep the instruction review-oriented: a match is evidence, not permission to mutate work. Use review_only unless the user explicitly authorized a bounded recovery policy. Set max_firings to one by default and include timeout behavior. Use a stable watch ID so repeated setup reuses an active watch.

## Verify and recover

After creation, inspect the watch or timer and verify target, due/expiry time, condition, delivery mode, and policy. On match, inspect evidence before acting. If it fires repeatedly, cancel duplicates and preserve first evidence. If it times out, report timeout separately from condition failure. A notification is not proof that the watched task or external action completed.