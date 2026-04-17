"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { analytics } from "@/lib/analytics";

export function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-charcoal to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,74,26,0.08)_0%,transparent_70%)]" />

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">
            The World&apos;s First Everything AI
          </p>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6"
          style={{ fontFamily: "var(--font-display), Georgia, serif" }}
        >
          &ldquo;Everything&rdquo; just got
          <br />
          <span className="text-ember text-glow-ember">a whole lot easier.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-lg md:text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Prometheus runs tools, automates your browser, manages background tasks,
          remembers context, and orchestrates workflows. Not a chatbot. A system.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button
            size="lg"
            href="/signup"
            className="glow-ember"
            onClick={() => analytics.track({ name: "hero_cta_clicked", properties: { cta: "get_started" } })}
          >
            Get started
          </Button>
          <Button variant="outline" size="lg" href="/how-it-works">
            See how it works
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
