import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";

export const metadata = createMetadata({
  title: "Background Tasks",
  description: "Prometheus runs tasks in the background while you focus on other things. Schedule recurring jobs, dispatch long-running work, and collect results when you're ready.",
  path: "/background-tasks",
});

export default function BackgroundTasksPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(220,74,26,0.06)_0%,transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Background Tasks</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            AI that works<br />while you don&apos;t
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-8">
            Dispatch work, close the tab, and come back to results. Prometheus keeps going.
          </p>
          <Button href="/signup" size="lg">Try background tasks</Button>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="max-w-3xl mx-auto space-y-12">
            <div>
              <h2 className="text-2xl font-bold mb-4">How background tasks work</h2>
              <p className="text-muted leading-relaxed mb-4">
                When you give Prometheus a task that takes time — research, data processing, multi-step workflows — it runs in the background. You don&apos;t need to keep the conversation open. You don&apos;t need to watch it work.
              </p>
              <p className="text-muted leading-relaxed">
                Tasks run to completion, store their results, and notify you when they&apos;re done.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Scheduling</h2>
              <p className="text-muted leading-relaxed mb-4">
                Set up recurring tasks with cron-style scheduling. Daily reports, weekly summaries, hourly monitoring checks — anything that should happen on a regular cadence.
              </p>
              <div className="bg-surface border border-border rounded-xl p-6 font-mono text-sm">
                <div className="text-muted mb-2"># Example: daily morning briefing at 7am</div>
                <div className="text-terminal-green">schedule: &quot;0 7 * * *&quot;</div>
                <div className="text-terminal-green">task: &quot;Scan news, financial markets, and competitor activity. Synthesize into a briefing.&quot;</div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4">Task management</h2>
              <ul className="space-y-3">
                {[
                  "View all running and completed tasks from your dashboard",
                  "Cancel tasks that are no longer needed",
                  "Review full results with context and reasoning",
                  "Chain tasks together for complex workflows",
                  "Set up automated responses to task completion",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-ember shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="text-center mt-16">
            <Button href="/signup" size="lg">Start running background tasks</Button>
          </div>
        </div>
      </section>
    </>
  );
}
