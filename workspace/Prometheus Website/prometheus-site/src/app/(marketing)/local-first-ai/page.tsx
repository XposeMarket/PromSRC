import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";

export const metadata = createMetadata({
  title: "Local-First AI",
  description: "Prometheus runs on your machine with your data. No cloud dependency for execution. Your files, your browser, your control.",
  path: "/local-first-ai",
});

const principles = [
  {
    title: "Your machine, your data",
    description: "Prometheus runs locally. Your files, browser sessions, and execution happen on your hardware. Nothing leaves your machine unless you explicitly connect to external services.",
  },
  {
    title: "No cloud dependency",
    description: "The core execution engine doesn't require a persistent cloud connection. Tasks, tools, and workflows run locally even if connectivity is intermittent.",
  },
  {
    title: "Full control over permissions",
    description: "Every tool has explicit permissions. Browser access, file operations, email sending — you decide what Prometheus can and can't do.",
  },
  {
    title: "Transparent execution",
    description: "Every action is logged. Every tool call is recorded. You can audit exactly what Prometheus did, when, and why.",
  },
  {
    title: "No training on your data",
    description: "Your conversations, files, and workflows are never used to train models. Your data stays yours.",
  },
  {
    title: "Portable and self-contained",
    description: "Your Prometheus instance is yours. Configuration, memory, and state are stored locally and can be backed up, moved, or reset at any time.",
  },
];

export default function LocalFirstAIPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(220,74,26,0.06)_0%,transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Local-First AI</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            AI that lives<br />on your machine
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-8">
            No cloud lock-in. No data exfiltration. Prometheus executes locally, under your control.
          </p>
          <Button href="/signup" size="lg">Get started</Button>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {principles.map((p) => (
              <div key={p.title} className="bg-surface border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-2">{p.title}</h2>
                <p className="text-sm text-muted leading-relaxed">{p.description}</p>
              </div>
            ))}
          </div>

          <div className="max-w-3xl mx-auto mt-16 text-center">
            <h2 className="text-2xl font-bold mb-4">Why local-first matters</h2>
            <p className="text-muted leading-relaxed mb-4">
              Cloud-only AI tools hold your data hostage. They see everything you type, every file you share, every workflow you build. When they change terms, raise prices, or shut down, your work goes with them.
            </p>
            <p className="text-muted leading-relaxed mb-8">
              Prometheus is different. It runs where you are. Your data never leaves your machine unless you choose to send it somewhere. That&apos;s not a feature — it&apos;s the architecture.
            </p>
            <Button href="/security" variant="outline" size="lg">Learn about security</Button>
          </div>
        </div>
      </section>
    </>
  );
}
