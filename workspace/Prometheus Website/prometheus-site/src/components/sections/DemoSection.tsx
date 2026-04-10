"use client";

import { Section } from "@/components/ui/Section";

export function DemoSection() {
  return (
    <Section id="demo">
      <div className="text-center mb-12">
        <p className="text-sm font-medium text-ember tracking-widest uppercase mb-4">
          See it in action
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          Watch Prometheus work
        </h2>
        <p className="text-muted text-lg max-w-2xl mx-auto">
          Real execution. Real tools. Real results.
        </p>
      </div>

      {/* Video placeholder */}
      <div className="max-w-4xl mx-auto">
        <div className="relative aspect-video rounded-xl border border-border bg-charcoal overflow-hidden group">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-ember/20 border border-ember/30 flex items-center justify-center group-hover:bg-ember/30 transition-colors cursor-pointer">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-ember ml-1"
                >
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
              <p className="text-sm text-muted">Demo video coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
