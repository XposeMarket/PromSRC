import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata = createMetadata({
  title: "Security & Privacy",
  description:
    "Prometheus runs locally on your machine. Your data never leaves. Permissions model, account isolation, audit trails, and responsible execution — security by architecture.",
  path: "/security",
});

const principles = [
  {
    title: "Permissions Model",
    description:
      "Every tool in Prometheus requires explicit capability grants. Browser access, file operations, desktop control — nothing activates without your configuration. You define the boundary; the system respects it.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  {
    title: "Account Isolation",
    description:
      "Each session operates in its own context boundary. Cron jobs run in isolated sessions. Team agents get scoped tool access. Background tasks don't leak state across boundaries.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    title: "Privacy by Architecture",
    description:
      "Prometheus runs as a local gateway on your machine. Your conversations, files, memory, and task history never touch our servers. There is no cloud relay. There is no telemetry pipeline. Your data is yours.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "Local-First Control",
    description:
      "You own the runtime. Prometheus runs on your hardware, uses your API keys, connects to your accounts. If you shut it down, it stops. If you delete the data directory, it's gone. No residual cloud state.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
  {
    title: "Responsible Execution",
    description:
      "Prometheus is designed for legitimate automation. Tool blocklists prevent subagents from accessing sensitive operations without explicit grants. The system respects website terms and rate limits by default.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
      </svg>
    ),
  },
  {
    title: "Audit Trail",
    description:
      "Every action Prometheus takes is logged — tool calls, parameters, results, timestamps. The audit log is a local JSONL file you can inspect, search, or pipe into your own monitoring. Nothing happens in the dark.",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
];

export default function SecurityPage() {
  return (
    <>
      <Section className="pt-32 md:pt-40">
        <div className="max-w-3xl">
          <Badge variant="ember" className="mb-6">Security</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Trust through transparency.
            <br />
            <span className="text-ember">Security through architecture.</span>
          </h1>
          <p className="text-lg text-muted leading-relaxed">
            Most AI products ask you to trust their cloud. Prometheus asks you to trust your own machine.
            The system runs locally, logs everything, and gives you complete control over what it can access.
          </p>
        </div>
      </Section>

      <Section dark>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {principles.map((p) => (
            <Card key={p.title} hover>
              <div className="text-ember mb-4">{p.icon}</div>
              <h2 className="text-lg font-semibold mb-3">{p.title}</h2>
              <p className="text-muted text-sm leading-relaxed">{p.description}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">What we don't do</h2>
          <div className="space-y-4">
            {[
              "We don't store your conversations on our servers",
              "We don't train models on your data",
              "We don't sell usage analytics to third parties",
              "We don't require cloud connectivity for core features",
              "We don't hide tool execution behind opaque abstractions",
              "We don't run tools without logging the action",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="text-muted">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section dark>
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Your machine. Your data. Your rules.</h2>
          <p className="text-muted text-lg mb-8">
            Prometheus was built for people who take their privacy seriously. See the full system.
          </p>
          <Button size="lg" href="/pricing">Get Started</Button>
        </div>
      </Section>
    </>
  );
}
