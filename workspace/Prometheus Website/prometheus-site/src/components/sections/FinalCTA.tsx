"use client";

import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";

export function FinalCTA() {
  return (
    <Section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,74,26,0.1)_0%,transparent_60%)]" />
      <div className="relative text-center max-w-2xl mx-auto">
        <h2
          className="text-3xl md:text-5xl font-bold tracking-tight mb-6"
          style={{ fontFamily: "var(--font-display), Georgia, serif" }}
        >
          Ready to stop chatting
          <br />
          and start executing?
        </h2>
        <p className="text-muted text-lg mb-10 leading-relaxed">
          Prometheus is built for people who need AI that does real work.
          Create your account and see what&apos;s possible.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" href="/signup" className="glow-ember">
            Create your account
          </Button>
          <Button variant="secondary" size="lg" href="/pricing">
            View pricing
          </Button>
        </div>
      </div>
    </Section>
  );
}
