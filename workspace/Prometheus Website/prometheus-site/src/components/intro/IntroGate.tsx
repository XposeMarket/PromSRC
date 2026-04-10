"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IntroSequence } from "./IntroSequence";

// sessionStorage = resets every new tab/window. localStorage = persists forever.
const INTRO_KEY = "prometheus_intro_seen";

interface IntroGateProps {
  children: React.ReactNode;
}

export function IntroGate({ children }: IntroGateProps) {
  const [showIntro, setShowIntro] = useState<boolean | null>(null);
  const [introExiting, setIntroExiting] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      setShowIntro(false);
      return;
    }

    // Use sessionStorage so intro shows on every new tab/window, not just first-ever visit
    const seen = sessionStorage.getItem(INTRO_KEY);
    setShowIntro(!seen);
  }, []);

  const handleIntroComplete = () => {
    setIntroExiting(true);
    sessionStorage.setItem(INTRO_KEY, "true");
    setTimeout(() => {
      setShowIntro(false);
      setIntroExiting(false);
    }, 600);
  };

  if (showIntro === null) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <>
      <AnimatePresence>
        {showIntro && !introExiting && (
          <motion.div
            key="intro"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <IntroSequence onComplete={handleIntroComplete} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={showIntro ? { opacity: 0 } : { opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: showIntro ? 0.3 : 0 }}
      >
        {children}
      </motion.div>
    </>
  );
}
