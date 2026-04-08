interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover = false }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl p-6 ${
        hover ? "transition-all duration-200 hover:border-ember/30 hover:shadow-lg hover:shadow-ember/5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
