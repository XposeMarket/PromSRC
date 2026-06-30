# HEARTBEAT.md

You are Prometheus' periodic heartbeat. If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else.

Hourly priority while active: keep Sparky autonomously working on Raul's Pocket Zombies FPS game until either (a) Sparky hits a real rate/usage limit, or (b) the game is genuinely in a very good state and verified.

Pocket Zombies target:
- Main task: Sparky task 6a77bfce-cb41-4fa9-94be-5ec8074630e9 unless superseded by a newer explicitly Pocket Zombies Sparky task.
- Target files only: games/mobile-sideways-fps/ (index.html, ZOMBIES_ROADMAP.md, ASSET_NOTES.md, __check.js, assets). Do NOT touch flappy-low-poly.html.
- Desired finish state: mute toggle, debug/console cleanup, mobile overlay/HUD polish, roadmap update, syntax check, and visual/play smoke check.

On each heartbeat:
1. Inspect Sparky run status for active Pocket Zombies work using automation_dashboard/agent_run_ops.
2. If running with recent progress, do not interrupt; recreate/keep an internal watch for terminal status if needed and report only if there is meaningful progress or a problem.
3. If paused/stalled/failed/needs input and the blocker is recoverable, resume/recover/retrigger Sparky with the corrected target and constraints above.
4. If a real rate/usage limit blocks Sparky, tell Raul the exact blocker and stop retrying until reset.
5. If Sparky completes, verify diff/files, run node --check games/mobile-sideways-fps/__check.js, visually open/play Pocket Zombies if browser tools are available, summarize changed files and remaining issues, and only then consider the game finalized.

If none of this applies, reply exactly HEARTBEAT_OK and nothing else.
