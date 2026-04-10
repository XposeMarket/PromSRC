"use client";

import { useState } from "react";

const faqs = [
  {
    q: "What exactly do I get for $8/month?",
    a: "Everything. Full system access — browser automation, background tasks, scheduling, team orchestration, desktop control, persistent memory, integrations. No feature tiers, no usage caps. The entire Prometheus system.",
  },
  {
    q: "Is there a free tier?",
    a: "Not currently. Prometheus is a production system with real compute costs. We'd rather offer the full system at a fair price than a crippled free version that wastes your time.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account settings and you'll retain access through the end of your billing period. No cancellation fees, no retention tricks.",
  },
  {
    q: "Where does my data go?",
    a: "Nowhere. Prometheus runs locally on your machine. Your files, memory, browser sessions, and task history stay on your hardware. We don't collect, store, or transmit your data.",
  },
  {
    q: "Do I need to provide my own AI API keys?",
    a: "Yes. Prometheus connects to AI providers (OpenAI, Anthropic, etc.) using your own API keys or OAuth connections. This keeps you in full control of your AI spend and provider choice.",
  },
  {
    q: "What platforms are supported?",
    a: "Windows is the primary platform with full feature support including desktop automation. macOS and Linux support is in progress. Browser automation and core features work across all platforms.",
  },
  {
    q: "How is this different from ChatGPT or Claude?",
    a: "Those are chat interfaces. Prometheus is an execution system. It doesn't just tell you how to do something — it does it. Real browser sessions, real file operations, real scheduled tasks running on your machine.",
  },
  {
    q: "Is my system safe?",
    a: "Prometheus operates with the permissions you grant. Every tool call is logged in an audit trail. You can review exactly what actions were taken, when, and why. There's no hidden execution.",
  },
];

export function PricingFAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      {faqs.map((faq, i) => (
        <div key={i} className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-surface-hover transition-colors"
          >
            <span className="font-medium">{faq.q}</span>
            <svg
              className={`w-5 h-5 text-muted shrink-0 transition-transform duration-200 ${open === i ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open === i && (
            <div className="px-6 pb-4 text-muted leading-relaxed">{faq.a}</div>
          )}
        </div>
      ))}
    </div>
  );
}
