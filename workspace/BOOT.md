# BOOT.md - Prometheus Daily Startup

This file opts the workspace into the once-per-day startup summary.

Current startup behavior:

1. Look at yesterday's intraday notes only.
2. Look at recent chat compaction summaries from the later of:
   - the last boot summary timestamp
   - 24 hours ago
3. Look at recent Brain thought/dream activity in that same recent window, including failed overnight attempts if any.
4. Send a short startup message about what may be worth resuming.

Hot restarts are separate from the daily startup:

1. A manual/proposal/update restart should resume from the previous chat session.
2. The restart follow-up should confirm the restart succeeded.
3. It should ask whether to continue the in-flight work from that conversation.

Keep both flows short, useful, and continuation-oriented.
