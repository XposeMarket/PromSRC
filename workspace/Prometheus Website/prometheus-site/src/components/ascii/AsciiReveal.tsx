"use client";

import { useState, useEffect, useCallback } from "react";
import { AsciiRenderer } from "./AsciiRenderer";

interface AsciiRevealProps {
  lines: string[];
  color?: "green" | "ember" | "white";
  msPerLine?: number;
  onComplete?: () => void;
  className?: string;
}

export function AsciiReveal({
  lines,
  color = "green",
  msPerLine = 60,
  onComplete,
  className = "",
}: AsciiRevealProps) {
  const [revealedLines, setRevealedLines] = useState(0);
  const [done, setDone] = useState(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finish = useCallback(() => {
    setRevealedLines(lines.length);
    setDone(true);
    onComplete?.();
  }, [lines.length, onComplete]);

  useEffect(() => {
    if (prefersReducedMotion) {
      finish();
      return;
    }

    if (revealedLines >= lines.length) {
      if (!done) finish();
      return;
    }

    const timer = setTimeout(() => {
      setRevealedLines((prev) => prev + 1);
    }, msPerLine);

    return () => clearTimeout(timer);
  }, [revealedLines, lines.length, msPerLine, prefersReducedMotion, done, finish]);

  return (
    <AsciiRenderer
      lines={lines}
      revealedLines={revealedLines}
      color={color}
      className={className}
    />
  );
}
