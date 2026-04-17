"use client";

import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";

const capabilities = [
  {
    title: "Browser Automation",
    description: "Navigate, click, extract, and interact with any website. Full browser control with real Chrome sessions.",
    icon: "🌐",
  },
  {
    title: "File & Workflow Execution",
    description: "Read, write, transform, and manage files. Execute multi-step workflows with real tool calls.",
    icon: "📁",
  },
  {
    title: "Desktop Automation",
    description: "Control local apps, windows, files, and workflows across your machine with real desktop-level execution.",
    icon: "🖥️",
  },
  {
    title: "Interactive Chat Visuals",
    description: "Turn conversations into live cards, previews, diagrams, and visual interfaces that respond as work evolves.",
    icon: "💬",
  },
  {
    title: "Built-in Marketing Tools",
    description: "Plan campaigns, shape landing pages, draft launch assets, and generate customer-facing content in one flow.",
    icon: "📣",
  },
  {
    title: "Persistent Memory",
    description: "Remembers context across sessions. Your preferences, your projects, your history - all retained.",
    icon: "🧠",
  },
  {
    title: "Full Business Context Injection System",
    description: "Bring company docs, product knowledge, workflows, and customer context directly into every agent task.",
    icon: "🧩",
  },
  {
    title: "Background Tasks",
    description: "Dispatch long-running work that continues even when you're away. Check results when you're ready.",
    icon: "⚡",
  },
  {
    title: "Scheduling & Cron",
    description: "Set up recurring tasks that run on your schedule. Automated reports, checks, and maintenance.",
    icon: "🕐",
  },
  {
    title: "Teams & Subagents",
    description: "Orchestrate multiple AI agents working together on complex projects with shared workspaces.",
    icon: "👥",
  },
  {
    title: "Skills",
    description: "Use 60+ built-in skills for specialized work, with the ability to add or create more as your needs grow.",
    icon: "🛠️",
  },
  {
    title: "Integrations",
    description: "Connect to email, calendars, messaging, APIs, and databases. Prometheus reaches where you need it.",
    icon: "🔗",
  },
];

export function CapabilitiesPreview() {
  return (
    <Section id="capabilities">
      <div className="text-center mb-16">
        <p className="text-sm font-medium text-ember tracking-widest uppercase mb-4">
          Capabilities
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          Everything a real AI system needs
        </h2>
        <p className="text-muted text-lg max-w-2xl mx-auto">
          Not features for a demo. Tools for actual work.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {capabilities.map((cap) => (
          <Card key={cap.title} hover>
            <div className="text-2xl mb-3">{cap.icon}</div>
            <h3 className="text-lg font-semibold mb-2">{cap.title}</h3>
            <p className="text-sm text-muted leading-relaxed">{cap.description}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
