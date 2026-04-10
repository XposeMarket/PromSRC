interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "ember" | "green";
  className?: string;
}

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variants = {
    default: "bg-surface text-muted border-border",
    ember: "bg-ember/10 text-ember border-ember/20",
    green: "bg-green-900/20 text-green-400 border-green-800/30",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full border ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
