import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata = createMetadata({
  title: "Product",
  description:
    "Prometheus is a local-first AI system that executes real tasks — browser automation, file operations, scheduling, and multi-agent orchestration. Not a chatbot. An operator.",
  path: "/product",
});

const pillars = [
  {
    title: "Tool Execution",
    description:
      "Prometheus doesn't suggest actions — it takes them. Real browser sessions, real file operations, real API calls. Every tool runs locally on your machine with full system access.",
    icon: (
      <svg className="w-8 h-8 text-ember" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
      </svg>
    ),
  },
  {
    title: "Persistent Memory",
    description:
      "Sessions end. Memory doesn't. Prometheus maintains context across conversations, building a working understanding of your projects, preferences, and prior decisions.",
    icon: (
      <svg className="w-8 h-8 text-ember" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    title: "Orchestration",
    description:
      "Deploy teams of specialized agents that coordinate on complex tasks. A manager agent plans, delegates, and synthesizes results — just like a real team lead.",
    icon: (
      <svg className="w-8 h-8 text-ember" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    title: "Automation",
    description:
      "Schedule recurring jobs, dispatch background tasks, and let Prometheus handle workflows while you're away. Cron-powered execution with full audit trails.",
    icon: (
      <svg className="w-8 h-8 text-ember" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

export default function ProductPage() {
  return (
    <>
      {/* Hero */}
      <Section className="pt-32 md:pt-40">
        <div className="max-w-3xl">
          <Badge variant="ember" className="mb-6">The System</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            AI that operates.
            <br />
            <span className="text-ember">Not one that narrates.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted leading-relaxed mb-8">
            Prometheus is a local-first AI system that runs on your machine, controls your browser,
            manages your files, schedules tasks, and orchestrates multi-agent teams — all through a
            single conversational interface. It doesn't ask for permission to be useful.
          </p>
          <div className="flex flex-wrap gap-4">
            <Button size="lg" href="/pricing">Get Started</Button>
            <Button variant="outline" size="lg" href="/how-it-works">See How It Works</Button>
            <Button variant="secondary" size="lg" href="/download">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "inline", marginRight: "8px", verticalAlign: "middle" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Now
            </Button>
          </div>
        </div>
      </Section>

      {/* Pillars */}
      <Section dark id="pillars">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Four pillars. One system.</h2>
          <p className="text-muted text-lg max-w-2xl">
            Every capability in Prometheus exists to serve a single purpose: turning intent into executed outcome.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {pillars.map((pillar) => (
            <Card key={pillar.title} hover className="flex flex-col gap-4">
              <div className="p-3 bg-ember/10 rounded-lg w-fit">{pillar.icon}</div>
              <h3 className="text-xl font-semibold">{pillar.title}</h3>
              <p className="text-muted leading-relaxed">{pillar.description}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Architecture */}
      <Section id="architecture">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Architecture built for action</h2>
          <p className="text-muted text-lg">
            Prometheus runs as a local gateway on your machine. Your data never leaves unless you tell it to.
            The system processes requests through a pipeline of planning, tool selection, execution, and verification.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="text-center">
            <div className="text-3xl font-bold text-ember mb-2">Gateway</div>
            <p className="text-sm text-muted">Local TypeScript server handling requests, routing, and tool dispatch</p>
          </Card>
          <Card className="text-center">
            <div className="text-3xl font-bold text-ember mb-2">Tool Layer</div>
            <p className="text-sm text-muted">Browser, desktop, file, network, and integration tools — all native</p>
          </Card>
          <Card className="text-center">
            <div className="text-3xl font-bold text-ember mb-2">Memory Store</div>
            <p className="text-sm text-muted">Persistent sessions, encrypted vault, and context graph — fully local</p>
          </Card>
        </div>
      </Section>

      {/* CTA */}
      <Section dark>
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to stop asking and start executing?</h2>
          <p className="text-muted text-lg mb-8">
            Prometheus Pro gives you the full system for $8/month. No usage caps. No feature gates.
          </p>
          <Button size="lg" href="/pricing">See Pricing</Button>
        </div>
      </Section>
    </>
  );
}
