import Link from "next/link";
import Image from "next/image";

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
          <Image
            src="/images/prometheus-logo.png"
            alt="Prometheus"
            width={32}
            height={38}
            className="transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_0_8px_rgba(220,74,26,0.5)]"
            priority
          />
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
