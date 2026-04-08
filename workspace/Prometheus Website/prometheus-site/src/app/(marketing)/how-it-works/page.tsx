import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata = createMetadata({
  title: "How It Works",
  description:
    "From request to result: how Prometheus plans, selects tools, executes actions, verifies outcomes, and persists context — all locally on your machine.",
  path: "/how-it-works",
});

const steps = [
  {
    number: "01",
    title: "Request",
    subtitle: "You state your intent",
    description:
      "Tell Prometheus what you need — in plain language. \"Research competitor pricing and put it in a spreadsheet.\" \"Check my email every morning and summarize anything from the team.\" \"Deploy a three-agent team to audit this codebase.\"",
    detail: "Requests arrive via web UI, Telegram, API call, or scheduled cron trigger. The system treats every input channel identically.",
  },
  {
    number: "02",
    title: "Planning",
    subtitle: "The system decomposes the task",
    description:
      "Prometheus analyzes the request against its available tools, current context, and persistent memory. It builds an execution plan — what tools to call, in what order, and what success looks like.",
    detail: "For complex tasks, the planner may deploy a team of specialized subagents, each assigned a scoped piece of the work.",
  },
  {
    number: "03",
    title: "Tool Execution",
    subtitle: "Real actions on real systems",
    description:
      "The plan becomes action. Browser sessions open. Files get written. APIs get called. Desktop applications get controlled. Every tool runs locally with native system access — no sandboxes, no simulations.",
    detail: "Tool execution is recursive: the output of one tool can trigger the selection of the next. The system adapts mid-execution when results differ from expectations.",
  },
  {
    number: "04",
    title: "Verification",
    subtitle: "Outcomes are validated",
    description:
      "After execution, Prometheus checks its work. Did the file actually get created? Did the browser reach the expected state? Did the API return the right data? Synthesis rounds catch vague or incomplete results.",
    detail: "For scheduled jobs, a second synthesis pass runs automatically when initial results are ambiguous, producing a clean final summary.",
  },
  {
    number: "05",
    title: "Persistence",
    subtitle: "Context survives the session",
    description:
      "Results, decisions, and learned context get written to persistent memory. The next time you ask about the same project, Prometheus already knows the history. Sessions end — understanding doesn't.",
    detail: "Memory is encrypted, local, and browsable. You control what persists and what gets forgotten.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Section className="pt-32 md:pt-40">
        <div className="max-w-3xl">
          <Badge variant="ember" className="mb-6">How It Works</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            From intent to outcome.
            <br />
            <span className="text-ember">Five stages. Zero hand-holding.</span>
          </h1>
          <p className="text-lg text-muted leading-relaxed">
            Prometheus follows a consistent execution pipeline for every task — whether it's a quick
            file read or a multi-day research operation across a team of agents.
          </p>
        </div>
      </Section>

      <Section dark>
        <div className="space-y-8">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              {i < steps.length - 1 && (
                <div className="absolute left-8 top-full w-px h-8 bg-gradient-to-b from-ember/40 to-transparent hidden md:block" />
              )}
              <Card className="md:flex items-start gap-8">
                <div className="shrink-0 mb-4 md:mb-0">
                  <div className="w-16 h-16 rounded-xl bg-ember/10 border border-ember/20 flex items-center justify-center">
                    <span className="text-2xl font-bold text-ember">{step.number}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-2xl font-bold">{step.title}</h2>
                    <span className="text-sm text-muted">{step.subtitle}</span>
                  </div>
                  <p className="text-muted leading-relaxed mb-3">{step.description}</p>
                  <p className="text-sm text-muted/70 leading-relaxed border-t border-border pt-3">{step.detail}</p>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </Section>

      {/* Pipeline Summary */}
      <Section>
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">The pipeline in one line</h2>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm md:text-base">
          {["Request", "Planning", "Tool Execution", "Verification", "Persistence"].map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <span className="px-4 py-2 bg-surface border border-border rounded-lg font-medium">{label}</span>
              {i < 4 && <span className="text-ember font-bold">&rarr;</span>}
            </div>
          ))}
        </div>
      </Section>

      <Section dark>
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">See it in action</h2>
          <p className="text-muted text-lg mb-8">
            The best way to understand Prometheus is to use it. Start with the full system for $8/month.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button size="lg" href="/pricing">Get Started</Button>
            <Button variant="outline" size="lg" href="/capabilities">Explore Capabilities</Button>
          </div>
        </div>
      </Section>
    </>
  );
}
