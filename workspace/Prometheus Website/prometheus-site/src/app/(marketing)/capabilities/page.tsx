import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata = createMetadata({
  title: "Capabilities",
  description:
    "Every tool Prometheus can use: browser automation, persistent memory, file operations, background tasks, scheduling, team orchestration, integrations, and desktop control.",
  path: "/capabilities",
});

const capabilities = [
  {
    title: "Browser Execution",
    badge: "Core",
    description:
      "Real Chrome sessions — not headless puppetry. Navigate pages, fill forms, extract data, intercept network traffic, and run arbitrary JavaScript in page context. Uses your actual browser profile with existing logins.",
    features: ["Full page navigation & interaction", "Network interception & response logging", "Structured data extraction via CSS schemas", "Snapshot diffing for SPA efficiency", "DOM element watching without polling"],
    href: "/ai-browser-automation",
  },
  {
    title: "Memory & Context",
    badge: "Core",
    description:
      "Sessions are ephemeral. Memory isn't. Prometheus maintains an encrypted local vault with persistent context across every conversation — your projects, preferences, prior decisions, and working state.",
    features: ["Cross-session persistence", "Encrypted local vault", "Automatic context injection", "Memory browsing & management", "Session isolation when needed"],
    href: "/product",
  },
  {
    title: "File Operations",
    badge: "Core",
    description:
      "Read, write, create, and modify files across your system. No sandboxing theater — Prometheus operates on your real filesystem with the permissions you grant it.",
    features: ["Read & write any accessible file", "Directory traversal & search", "Source code analysis", "Structured file creation", "Batch file operations"],
    href: "/product",
  },
  {
    title: "Background Tasks",
    badge: "Automation",
    description:
      "Dispatch long-running work that continues even when you close the conversation. Collect results later, check status, or let tasks chain into downstream workflows.",
    features: ["Fire-and-forget execution", "Status polling & result collection", "Task chaining & dependencies", "Isolated session contexts", "Full audit trail"],
    href: "/background-tasks",
  },
  {
    title: "Scheduling & Cron",
    badge: "Automation",
    description:
      "Define recurring jobs that run on cron schedules. Prometheus executes them with full tool access — checking markets, scraping data, sending reports, monitoring systems.",
    features: ["Cron expression scheduling", "Isolated job sessions", "Synthesis rounds for quality", "Result summaries & logging", "Pause/resume control"],
    href: "/background-tasks",
  },
  {
    title: "Teams & Subagents",
    badge: "Orchestration",
    description:
      "Deploy specialized agent teams with a coordinator that plans, delegates, and synthesizes. Each subagent runs as a full Prometheus instance with scoped tool access.",
    features: ["Manager-agent coordination", "Background & foreground dispatch", "Shared team workspaces", "2-way communication with main agent", "Goal tracking & milestones"],
    href: "/product",
  },
  {
    title: "Integrations",
    badge: "Connectivity",
    description:
      "Email, calendar, Telegram, and growing. Prometheus connects to your existing services through OAuth and local credentials — no third-party relay servers.",
    features: ["Gmail read & compose", "Google Calendar management", "Telegram bot interface", "Webhook endpoints", "REST API access"],
    href: "/product",
  },
  {
    title: "Desktop Automation",
    badge: "Power",
    description:
      "Full UI Automation tree access, pixel-level monitoring, click/type macro recording and replay. Control any desktop application as if you were sitting at the keyboard.",
    features: ["Accessibility tree inspection", "Pixel color watching", "Macro recording & replay", "Click, type, scroll, keypress", "Window targeting & focus"],
    href: "/product",
  },
];

export default function CapabilitiesPage() {
  return (
    <>
      <Section className="pt-32 md:pt-40">
        <div className="max-w-3xl mb-16">
          <Badge variant="ember" className="mb-6">Capabilities</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Everything it can do.
            <br />
            <span className="text-muted">Nothing it can't reach.</span>
          </h1>
          <p className="text-lg text-muted leading-relaxed">
            Prometheus ships with a full suite of execution tools — from browser control to desktop automation.
            Each capability is native, local, and operates with real system access.
          </p>
        </div>
      </Section>

      <Section dark>
        <div className="grid md:grid-cols-2 gap-8">
          {capabilities.map((cap) => (
            <Card key={cap.title} hover className="flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-semibold">{cap.title}</h2>
                <Badge variant="ember">{cap.badge}</Badge>
              </div>
              <p className="text-muted leading-relaxed mb-6">{cap.description}</p>
              <ul className="space-y-2 mb-6 flex-1">
                {cap.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted">
                    <span className="text-ember mt-1">&#8226;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" href={cap.href}>
                Learn more &rarr;
              </Button>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">All of this. $8/month.</h2>
          <p className="text-muted text-lg mb-8">
            No feature tiers. No per-tool pricing. Every capability ships with every account.
          </p>
          <Button size="lg" href="/pricing">Start with Prometheus</Button>
        </div>
      </Section>
    </>
  );
}
