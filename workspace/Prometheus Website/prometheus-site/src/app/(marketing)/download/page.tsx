import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata = createMetadata({
  title: "Download Prometheus",
  description: "Download the Prometheus desktop app for your platform.",
  path: "/download",
});

export default function DownloadPage() {
  return (
    <Section className="pt-32 md:pt-40">
      <div className="max-w-2xl">
        <Badge variant="ember" className="mb-6">Coming Soon</Badge>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Download <span className="text-ember">Prometheus</span>
        </h1>
        <p className="text-lg text-muted leading-relaxed mb-8">
          The Prometheus desktop app is currently in private beta. Sign up to get
          early access when it launches for Windows, macOS, and Linux.
        </p>
        <div className="flex flex-wrap gap-4">
          <Button size="lg" href="/signup">Get Early Access</Button>
          <Button variant="outline" size="lg" href="/product">Learn More</Button>
        </div>
      </div>
    </Section>
  );
}
