import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";

export const metadata = createMetadata({
  title: "About",
  description: "The story behind Prometheus. Why we built an AI system focused on execution, not conversation.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(220,74,26,0.06)_0%,transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">About</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            AI should do the work,<br />not just talk about it.
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            That conviction is why Prometheus exists.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8 space-y-12">
          <div>
            <h2 className="text-2xl font-bold mb-4">The problem</h2>
            <p className="text-muted leading-relaxed mb-4">
              Most AI tools are conversation windows. You type, they respond, and then you go do the actual work yourself. The AI helped you think — but it didn&apos;t help you act.
            </p>
            <p className="text-muted leading-relaxed">
              We kept running into the same gap: the distance between &ldquo;the AI told me what to do&rdquo; and &ldquo;the thing is actually done.&rdquo; Prometheus was built to close that gap.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-bold mb-4">What we believe</h2>
            <ul className="space-y-4">
              {[
                "AI should be able to use tools, not just describe them.",
                "Memory should persist. Every session should build on the last.",
                "Background work should run whether you're watching or not.",
                "A system should orchestrate, not just respond.",
                "Your data and control should stay with you.",
              ].map((belief) => (
                <li key={belief} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-ember mt-2 shrink-0" />
                  <span className="text-muted leading-relaxed">{belief}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-2xl font-bold mb-4">How Prometheus works</h2>
            <p className="text-muted leading-relaxed mb-4">
              Prometheus is a personal AI system. It connects to your browser, your files, your calendar, your email. It plans tasks, executes them with real tools, and remembers what happened.
            </p>
            <p className="text-muted leading-relaxed">
              It runs background jobs on schedules you set. It coordinates teams of specialized agents. It doesn&apos;t just answer — it acts, reports, and learns.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-bold mb-4">The name</h2>
            <p className="text-muted leading-relaxed">
              In myth, Prometheus stole fire from the gods and gave it to humanity — the power to build, to create, to transform. This system carries the same idea: take the power of AI and put it directly in your hands, as a tool you control.
            </p>
          </div>

          <div className="text-center pt-8">
            <Button href="/signup" size="lg">Start with Prometheus</Button>
          </div>
        </div>
      </section>
    </>
  );
}
