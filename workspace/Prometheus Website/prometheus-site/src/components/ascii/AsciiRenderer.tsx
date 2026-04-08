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
  const visible = revealedLines !== undefined ? lines.slice(0, revealedLines) : lines;

  return (
    <pre
      className={`font-mono text-xs sm:text-sm leading-tight whitespace-pre overflow-x-auto select-none ${colorClasses[color]} ${className}`}
      aria-hidden="true"
    >
      {visible.map((line, i) => (
        <div key={i} style={{ opacity: revealedLines !== undefined ? 1 : undefined }}>
          {line}
        </div>
      ))}
    </pre>
  );
}
