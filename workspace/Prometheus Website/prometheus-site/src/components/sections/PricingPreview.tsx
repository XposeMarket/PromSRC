"use client";

import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { analytics } from "@/lib/analytics";

export function PricingPreview() {
  return (
    <Section id="pricing-preview">
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-sm font-medium text-ember tracking-widest uppercase mb-4">
          Simple pricing
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          One plan. Full access.
        </h2>
        <p className="text-muted text-lg mb-10">
          Everything Prometheus can do. No feature gates, no surprise tiers.
        </p>

        <div className="bg-surface border border-border rounded-2xl p-8 md:p-12 glow-ember">
          <div className="flex items-baseline justify-center gap-2 mb-2">
            <span className="text-5xl md:text-6xl font-bold">$8</span>
            <span className="text-muted text-lg">/month</span>
          </div>
          <p className="text-muted mb-8">Full system access. Cancel anytime.</p>
          <Button
            size="lg"
            href="/pricing"
            onClick={() => analytics.track({ name: "pricing_cta_clicked", properties: { source: "home_preview" } })}
          >
            See what&apos;s included
          </Button>
        </div>
      </div>
    </Section>
  );
}
