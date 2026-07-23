# Mobile Tasks and Schedule

## Tasks

Route: `#mobile/tasks[/<id>]`. This is the compact task operations surface: status filters/counts, task expansion, progress/activity and lifecycle navigation. It uses the same background-task records as desktop, so it can reflect task state/recovery, but desktop provides the denser journal/process/evidence console. Mobile does not invent a second task runtime.

## Schedule

Route: `#mobile/schedule`. It fetches/caches/revalidates schedule cards, shows the schedule count, opens an editor expansion, lets the operator toggle enabled/paused and manually run a job, and offers a new-schedule entry point. The job’s actual configuration/execution is gateway-backed; the mobile card is not a local alarm.
