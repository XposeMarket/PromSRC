"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    // Placeholder — wire to your form handler
    await new Promise((r) => setTimeout(r, 1000));
    setSubmitted(true);
    setLoading(false);
  }

  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Contact</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Get in touch
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Questions, partnerships, enterprise inquiries, or feedback — we&apos;d like to hear from you.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-xl px-6 lg:px-8">
          {submitted ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-ember/20 border border-ember/30 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-ember" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">Message sent</h2>
              <p className="text-muted">We&apos;ll get back to you as soon as possible.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">Name</label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-foreground placeholder:text-muted/50 focus:border-ember focus:outline-none transition-colors"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-foreground placeholder:text-muted/50 focus:border-ember focus:outline-none transition-colors"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label htmlFor="subject" className="block text-sm font-medium mb-2">Subject</label>
                <select
                  id="subject"
                  name="subject"
                  className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-foreground focus:border-ember focus:outline-none transition-colors"
                >
                  <option value="general">General inquiry</option>
                  <option value="support">Support</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="partnership">Partnership</option>
                  <option value="feedback">Feedback</option>
                </select>
              </div>
              <div>
                <label htmlFor="message" className="block text-sm font-medium mb-2">Message</label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={5}
                  className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-foreground placeholder:text-muted/50 focus:border-ember focus:outline-none transition-colors resize-none"
                  placeholder="Tell us what you need..."
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send message"}
              </Button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
