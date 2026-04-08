import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";

export const metadata = createMetadata({
  title: "Compare Prometheus",
  description: "See how Prometheus compares to ChatGPT, Claude, and other AI tools. Feature-by-feature comparison of execution, memory, automation, and more.",
  path: "/compare",
});

const features = [
  { name: "Tool execution", prometheus: true, chatgpt: "Limited", claude: "Limited" },
  { name: "Browser automation", prometheus: true, chatgpt: false, claude: false },
  { name: "Background tasks", prometheus: true, chatgpt: false, claude: false },
  { name: "Persistent memory", prometheus: true, chatgpt: "Basic", claude: "Basic" },
  { name: "Scheduling & cron", prometheus: true, chatgpt: false, claude: false },
  { name: "Team/subagent orchestration", prometheus: true, chatgpt: false, claude: false },
  { name: "Desktop automation", prometheus: true, chatgpt: false, claude: false },
  { name: "File operations", prometheus: true, chatgpt: "Limited", claude: "Limited" },
  { name: "Email & calendar integration", prometheus: true, chatgpt: false, claude: false },
  { name: "Local-first architecture", prometheus: true, chatgpt: false, claude: false },
  { name: "Custom workflows", prometheus: true, chatgpt: false, claude: false },
  { name: "Conversation quality", prometheus: true, chatgpt: true, claude: true },
];

function CellValue({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-ember font-medium">Yes</span>;
  if (value === false) return <span className="text-muted/40">No</span>;
  return <span className="text-muted/70">{value}</span>;
}

export default function ComparePage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Compare</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Prometheus vs. the rest
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Most AI tools are conversation windows. Prometheus is an execution system.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-4 px-4 font-medium text-muted">Feature</th>
                  <th className="text-center py-4 px-4 font-semibold text-ember">Prometheus</th>
                  <th className="text-center py-4 px-4 font-medium text-muted">ChatGPT</th>
                  <th className="text-center py-4 px-4 font-medium text-muted">Claude</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.name} className="border-b border-border/50">
                    <td className="py-3 px-4 text-foreground">{f.name}</td>
                    <td className="py-3 px-4 text-center"><CellValue value={f.prometheus} /></td>
                    <td className="py-3 px-4 text-center"><CellValue value={f.chatgpt} /></td>
                    <td className="py-3 px-4 text-center"><CellValue value={f.claude} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-center mt-16">
            <p className="text-muted mb-6">Ready to try something that actually does the work?</p>
            <Button href="/signup" size="lg">Get started with Prometheus</Button>
          </div>
        </div>
      </section>
    </>
  );
}
