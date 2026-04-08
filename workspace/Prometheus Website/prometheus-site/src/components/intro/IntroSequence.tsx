"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AsciiReveal } from "@/components/ascii/AsciiReveal";
import { STARTUP_ASCII } from "@/content/ascii/startup";
import { LOGO_ASCII } from "@/content/ascii/logo";
import { parseAsciiToLines } from "@/lib/ascii/loader";
import { Button } from "@/components/ui/Button";
import { analytics } from "@/lib/analytics";

type Phase = "startup" | "logo" | "cta";

interface IntroSequenceProps {
  onComplete: () => void;
}

export function IntroSequence({ onComplete }: IntroSequenceProps) {
  const [phase, setPhase] = useState<Phase>("startup");

  const handleSkip = useCallback(() => {
    analytics.track({ name: "intro_skipped" });
    onComplete();
  }, [onComplete]);

  const handleEnter = useCallback(() => {
    analytics.track({ name: "intro_completed" });
    onComplete();
  }, [onComplete]);

  const startupLines = parseAsciiToLines(STARTUP_ASCII);
  const logoLines   = parseAsciiToLines(LOGO_ASCII);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden">
      {/* Skip button */}
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 text-xs text-muted/40 hover:text-muted/70 transition-colors z-10 tracking-widest uppercase"
      >
        Skip intro
      </button>

      <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto px-4">
        <AnimatePresence mode="wait">

          {/* Phase 1 — flame/particle art, green terminal */}
          {phase === "startup" && (
            <motion.div
              key="startup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <AsciiReveal
                lines={startupLines}
                color="green"
                msPerLine={30}
                onComplete={() => setTimeout(() => setPhase("logo"), 600)}
              />
            </motion.div>
          )}

          {/* Phase 2 — Prometheus figure art, ember/warm */}
          {phase === "logo" && (
            <motion.div
              key="logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
            >
              <AsciiReveal
                lines={logoLines}
                color="ember"
                msPerLine={25}
                className="text-[8px] sm:text-[10px]"
                onComplete={() => setTimeout(() => setPhase("cta"), 800)}
              />
            </motion.div>
          )}

          {/* Phase 3 — CTA */}
          {phase === "cta" && (
            <motion.div
              key="cta"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex flex-col items-center gap-10"
            >
              <div className="flex flex-col items-center gap-3">
                <Button size="lg" onClick={handleEnter} className="glow-ember-strong px-10 py-4 text-lg">
                  Enter the fire
                </Button>
                <span className="text-xs text-muted/30 tracking-widest uppercase">
                  Everything AI
                </span>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
