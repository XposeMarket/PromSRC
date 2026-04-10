"use client";

import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";

const workflows = [
  {
    title: "Morning research brief",
    description:
      "Schedule Prometheus to scan news sources, financial data, and competitor activity every morning. Get a synthesized briefing in your inbox before you start work.",
    tags: ["Scheduling", "Browser", "Email"],
  },
  {
    title: "Automated data pipeline",
    description:
      "Extract data from web dashboards, transform it, and push results to your spreadsheet or database — on repeat, without manual intervention.",
    tags: ["Browser Automation", "Background Tasks", "Files"],
  },
  {
    title: "Code review and deployment prep",
    description:
      "Prometheus reads your pull requests, analyzes changes, runs checks, and prepares a deployment summary with risk assessment.",
    tags: ["Integrations", "Memory", "Teams"],
  },
  {
    title: "Customer outreach sequences",
    description:
      "Draft personalized emails, schedule follow-ups, and track responses — all orchestrated through background tasks with persistent context.",
    tags: ["Email", "Scheduling", "Memory"],
  },
];

export function WorkflowStories() {
  return (
    <Section dark>
      <div className="text-center mb-16">
        <p className="text-sm font-medium text-ember tracking-widest uppercase mb-4">
          Real workflows
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          What people build with Prometheus
        </h2>
        <p className="text-muted text-lg max-w-2xl mx-auto">
          Concrete examples, not hypotheticals.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {workflows.map((wf) => (
          <Card key={wf.title} hover>
            <h3 className="text-lg font-semibold mb-3">{wf.title}</h3>
            <p className="text-sm text-muted leading-relaxed mb-4">{wf.description}</p>
            <div className="flex flex-wrap gap-2">
              {wf.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-1 rounded bg-ember/10 text-ember/80 border border-ember/10"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
