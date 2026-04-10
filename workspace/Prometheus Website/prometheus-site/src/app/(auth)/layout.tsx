import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      {/* Subtle radial glow behind the card */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(220,74,26,0.06)_0%,transparent_70%)]" />

      <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-8">
        {/* Logo / wordmark */}
        <Link
          href="/"
          className="group flex items-center gap-2 text-foreground transition-colors hover:text-ember"
          aria-label="Back to homepage"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="transition-transform duration-300 group-hover:scale-110"
            aria-hidden="true"
          >
            {/* Flame icon */}
            <path
              d="M16 2C16 2 6 14 6 20a10 10 0 0 0 20 0C26 14 16 2 16 2Zm0 24a6 6 0 0 1-6-6c0-3 3-8 6-12 3 4 6 9 6 12a6 6 0 0 1-6 6Z"
              fill="currentColor"
              className="text-ember"
            />
          </svg>
          <span className="font-display text-xl font-semibold tracking-tight">
            Prometheus
          </span>
        </Link>

        {/* Auth card */}
        <div className="w-full rounded-xl border border-border bg-surface p-8 shadow-2xl shadow-black/40">
          {children}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-muted">
          &copy; {new Date().getFullYear()} Prometheus. All rights reserved.
        </p>
      </div>
    </div>
  );
}
