"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  href?: string;
  className?: string;
}

const base =
  "inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:opacity-50 disabled:pointer-events-none rounded-lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-ember text-white hover:bg-ember-dark active:bg-ember-dark shadow-lg shadow-ember/20 hover:shadow-ember/30",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-hover hover:border-muted/30",
  ghost: "text-muted hover:text-foreground hover:bg-surface",
  outline: "border border-ember/40 text-ember hover:bg-ember/10 hover:border-ember",
};

const sizes: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", href, className = "", children, ...props }, ref) => {
    const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

    if (href) {
      return (
        <Link href={href} className={classes}>
          {children}
        </Link>
      );
    }

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
