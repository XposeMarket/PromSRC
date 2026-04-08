"use client";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface PricingCardProps {
  featured?: boolean;
}

const features = [
  "Full AI system access",
  "Browser automation & control",
  "Background tasks & scheduling",
  "Persistent memory across sessions",
  "Team & subagent orchestration",
  "File & workflow execution",
  "Email, calendar & integrations",
  "Desktop automation",
  "Priority support",
];

export function PricingCard({ featured = true }: PricingCardProps) {
  return (
    <div
      className={`rounded-2xl p-8 md:p-10 ${
        featured
          ? "bg-surface border-2 border-ember/30 glow-ember"
          : "bg-surface border border-border"
      }`}
    >
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-xl font-bold">Prometheus Pro</h3>
        {featured && <Badge variant="ember">Most popular</Badge>}
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-5xl font-bold">$8</span>
        <span className="text-muted">/month</span>
      </div>
      <p className="text-sm text-muted mb-8">Everything. No limits. Cancel anytime.</p>

      <Button size="lg" href="/signup" className="w-full mb-8">
        Start with Prometheus
      </Button>

      <ul className="space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm">
            <svg
              className="w-5 h-5 text-ember shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-muted">{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
