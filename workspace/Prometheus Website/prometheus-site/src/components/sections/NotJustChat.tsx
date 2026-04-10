"use client";

import { Section } from "@/components/ui/Section";

const comparisons = [
  { chat: "Answers your question", prometheus: "Executes your task" },
  { chat: "Forgets between sessions", prometheus: "Remembers everything" },
  { chat: "Can only suggest", prometheus: "Can actually act" },
  { chat: "Single conversation", prometheus: "Background work, teams, scheduling" },
  { chat: "Generic responses", prometheus: "Context-aware, tool-equipped execution" },
];

export function NotJustChat() {
  return (
    <Section dark>
      <div className="text-center mb-16">
        <p className="text-sm font-medium text-ember tracking-widest uppercase mb-4">
          Beyond chatbots
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          This is not a chat window.
        </h2>
        <p className="text-muted text-lg max-w-2xl mx-auto">
          Most AI tools answer questions. Prometheus does the work.
        </p>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="grid grid-cols-2 gap-0 border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-surface border-b border-border text-sm font-semibold text-muted">
            Typical AI Chat
          </div>
          <div className="px-6 py-3 bg-ember/5 border-b border-border text-sm font-semibold text-ember">
            Prometheus
          </div>
          {comparisons.map((row, i) => (
            <div key={i} className="contents">
              <div className="px-6 py-4 border-b border-border text-sm text-muted/70">
                {row.chat}
              </div>
              <div className="px-6 py-4 border-b border-border text-sm text-foreground bg-ember/[0.02]">
                {row.prometheus}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
