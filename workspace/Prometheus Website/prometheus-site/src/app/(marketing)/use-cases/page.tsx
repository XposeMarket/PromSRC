import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export const metadata = createMetadata({
  title: "Use Cases",
  description: "Discover how people use Prometheus for research automation, data pipelines, customer outreach, code review, content creation, and monitoring.",
  path: "/use-cases",
});

const useCases = [
  {
    title: "Research Automation",
    description: "Prometheus browses the web, collects data from multiple sources, synthesizes findings, and delivers structured reports — on schedule or on demand.",
    capabilities: ["Browser Automation", "Scheduling", "Memory"],
    href: "/ai-browser-automation",
  },
  {
    title: "Data Pipelines",
    description: "Extract data from web dashboards, APIs, and documents. Transform, validate, and deliver to your spreadsheets, databases, or downstream systems.",
    capabilities: ["Background Tasks", "File Operations", "Integrations"],
    href: "/background-tasks",
  },
  {
    title: "Customer Outreach",
    description: "Draft personalized messages, manage follow-up sequences, track responses, and maintain relationship context across every interaction.",
    capabilities: ["Memory", "Email", "Scheduling"],
    href: "#",
  },
  {
    title: "Code Review & DevOps",
    description: "Analyze pull requests, run automated checks, prepare deployment summaries, and flag risks — integrated with your existing development workflow.",
    capabilities: ["Integrations", "Teams", "File Operations"],
    href: "#",
  },
  {
    title: "Content Creation",
    description: "Research topics, draft content, manage editorial calendars, and publish across channels. Prometheus handles the pipeline, you handle the voice.",
    capabilities: ["Browser Automation", "Memory", "Scheduling"],
    href: "#",
  },
  {
    title: "Monitoring & Alerts",
    description: "Watch websites, prices, availability, or any data source on a schedule. Get notified when conditions change. Act automatically when they do.",
    capabilities: ["Scheduling", "Browser Automation", "Background Tasks"],
    href: "#",
  },
];

export default function UseCasesPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Use Cases</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            What you can build with Prometheus
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Real workflows. Real outcomes. Not hypotheticals.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((uc) => (
              <Link
                key={uc.title}
                href={uc.href}
                className="block bg-surface border border-border rounded-xl p-6 hover:border-ember/30 transition-all group"
              >
                <h2 className="text-lg font-semibold mb-2 group-hover:text-ember transition-colors">{uc.title}</h2>
                <p className="text-sm text-muted leading-relaxed mb-4">{uc.description}</p>
                <div className="flex flex-wrap gap-2">
                  {uc.capabilities.map((cap) => (
                    <span key={cap} className="text-xs px-2 py-0.5 rounded bg-ember/10 text-ember/70 border border-ember/10">
                      {cap}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center mt-16">
            <Button href="/signup" size="lg">Start building your workflow</Button>
          </div>
        </div>
      </section>
    </>
  );
}
