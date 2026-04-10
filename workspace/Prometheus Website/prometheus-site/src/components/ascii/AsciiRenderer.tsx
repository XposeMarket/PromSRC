"use client";

interface AsciiRendererProps {
  lines: string[];
  revealedLines?: number;
  color?: "green" | "ember" | "white";
  className?: string;
}

const colorClasses = {
  green: "text-terminal-green text-glow-green",
  ember: "text-ember text-glow-ember",
  white: "text-foreground",
};

export function AsciiRenderer({
  lines,
  revealedLines,
  color = "green",
  className = "",
}: AsciiRendererProps) {
  return (
    <pre
      className={`font-mono text-xs sm:text-sm leading-tight whitespace-pre select-none ${colorClasses[color]} ${className}`}
      aria-hidden="true"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            visibility:
              revealedLines !== undefined && i >= revealedLines ? "hidden" : undefined,
          }}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
