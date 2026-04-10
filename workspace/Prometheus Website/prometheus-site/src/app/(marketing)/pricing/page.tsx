import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { PricingCard } from "@/components/pricing/PricingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PricingFAQ } from "./faq";

export const metadata = createMetadata({
  title: "Pricing",
  description:
    "Prometheus Pro: $8/month for the full AI execution system. No feature tiers, no usage caps. Browser automation, scheduling, teams, memory, desktop control — everything.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <>
      <Section className="pt-32 md:pt-40">
        <div className="max-w-3xl mx-auto text-center">
          <Badge variant="ember" className="mb-6">Pricing</Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            One plan. Full power.
            <br />
            <span className="text-ember">$8/month.</span>
          </h1>
          <p className="text-lg text-muted leading-relaxed">
            We don't believe in feature gates. Every Prometheus user gets the complete system.
            No starter tier. No enterprise upsell. Just the tool, at a price that respects your intelligence.
          </p>
        </div>
      </Section>

      <Section dark>
        <div className="max-w-lg mx-auto">
          <PricingCard featured />
        </div>
      </Section>

      <Section id="faq">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Frequently asked questions</h2>
          <p className="text-muted text-lg">Straight answers. No deflection.</p>
        </div>
        <PricingFAQ />
      </Section>

      <Section dark>
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Stop paying for promises. Start paying for execution.</h2>
          <p className="text-muted text-lg mb-8">
            Prometheus does what other AI products only talk about. See for yourself.
          </p>
          <Button size="lg" href="/signup">Start with Prometheus</Button>
        </div>
      </Section>
    </>
  );
}
