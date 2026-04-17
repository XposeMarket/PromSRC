import { createMetadata } from "@/lib/seo/metadata";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { getLatestRelease } from "@/lib/releases/github";

export const metadata = createMetadata({
  title: "Download Prometheus",
  description:
    "Download the Prometheus desktop app for Windows. Local-first AI automation that runs on your machine.",
  path: "/download",
});

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function DownloadPage() {
  const release = await getLatestRelease();

  return (
    <Section className="pt-32 md:pt-40 pb-24">
      <div className="max-w-5xl">

        {/* ── Header ── */}
        <Badge variant={release.available ? "green" : "ember"} className="mb-6">
          {release.available ? `v${release.version} — Available Now` : "Coming Soon"}
        </Badge>

        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
          Download <span className="text-ember">Prometheus</span>
        </h1>
        <p className="text-lg text-muted leading-relaxed mb-12 max-w-2xl">
          A local-first AI system that executes real tasks — browser automation,
          file operations, scheduling, and multi-agent workflows. Runs entirely
          on your machine.
        </p>

        {/* ── Platform cards ── */}
        <div className="grid md:grid-cols-3 gap-4 mb-16">

          {/* Windows — primary */}
          <div className="relative rounded-2xl border border-border bg-surface p-6 flex flex-col gap-4 md:col-span-1 ring-1 ring-ember/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ember/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-ember" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-foreground">Windows</div>
                  <div className="text-xs text-muted">x64 — NSIS Installer</div>
                </div>
              </div>
              <Badge variant="green" className="text-xs">Available</Badge>
            </div>

            {release.available && release.version && (
              <div className="text-xs text-muted space-y-1">
                <div>Version {release.version}</div>
                {release.publishedAt && (
                  <div>Released {formatDate(release.publishedAt)}</div>
                )}
                {release.fileSize && (
                  <div>{formatBytes(release.fileSize)}</div>
                )}
              </div>
            )}

            <div className="mt-auto pt-2">
              {release.available ? (
                <Button href="/api/download" className="w-full" size="md">
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download for Windows
                </Button>
              ) : (
                <Button href="/signup" className="w-full" size="md">
                  Get Early Access
                </Button>
              )}
            </div>
          </div>

          {/* macOS — coming soon */}
          <div className="rounded-2xl border border-border bg-surface/50 p-6 flex flex-col gap-4 opacity-60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center border border-border">
                  <svg className="w-5 h-5 text-muted" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-foreground">macOS</div>
                  <div className="text-xs text-muted">Apple Silicon + Intel</div>
                </div>
              </div>
              <Badge className="text-xs">Soon</Badge>
            </div>
            <div className="mt-auto pt-2">
              <button disabled className="w-full rounded-lg border border-border bg-surface/50 px-4 py-3 text-sm font-medium text-muted cursor-not-allowed">
                Coming Soon
              </button>
            </div>
          </div>

          {/* Linux — coming soon */}
          <div className="rounded-2xl border border-border bg-surface/50 p-6 flex flex-col gap-4 opacity-60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center border border-border">
                  <svg className="w-5 h-5 text-muted" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.87-1.273-1.224-1.65l-.141-.13c-.324-.31-.479-.444-.607-.76-.183-.477-.22-.982-.168-1.619.052-.673.119-1.534-.058-2.509-.22-1.235-.965-2.075-1.763-3.158-.799-1.083-1.589-2.417-1.859-3.862-.327-1.708.275-3.494 1.859-4.532.586-.388 1.25-.594 1.911-.672C21.512 5.36 24 9.056 24 12.504c0 6.624-5.379 12.004-12.004 12.004-6.625 0-12.005-5.38-12.005-12.004 0-6.625 5.38-12.005 12.005-12.005z" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-foreground">Linux</div>
                  <div className="text-xs text-muted">AppImage / deb</div>
                </div>
              </div>
              <Badge className="text-xs">Soon</Badge>
            </div>
            <div className="mt-auto pt-2">
              <button disabled className="w-full rounded-lg border border-border bg-surface/50 px-4 py-3 text-sm font-medium text-muted cursor-not-allowed">
                Coming Soon
              </button>
            </div>
          </div>
        </div>

        {/* ── System Requirements ── */}
        <div className="grid md:grid-cols-2 gap-8 border-t border-border pt-12">
          <div>
            <h2 className="text-xl font-bold mb-4">System Requirements</h2>
            <ul className="space-y-2 text-sm text-muted">
              {[
                ["OS", "Windows 10 / 11 (64-bit)"],
                ["RAM", "8 GB minimum, 16 GB recommended"],
                ["Storage", "2 GB available space"],
                ["Network", "Required for AI model access (or run local models offline)"],
                ["Account", "Prometheus account with active subscription"],
              ].map(([label, value]) => (
                <li key={label} className="flex gap-3">
                  <span className="text-ember font-medium w-20 flex-shrink-0">{label}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4">What&apos;s Included</h2>
            <ul className="space-y-2 text-sm text-muted">
              {[
                "Prometheus desktop app (Electron)",
                "Local gateway server (runs on port 18789)",
                "Browser automation via Playwright",
                "Bundled skill library (20+ skills)",
                "Auto-update engine — always stays current",
                "Your data stays on your machine",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-ember mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Footer CTA ── */}
        {!release.available && (
          <div className="mt-16 rounded-2xl border border-ember/20 bg-ember/5 p-8 text-center">
            <h3 className="text-xl font-bold mb-2">Not available yet?</h3>
            <p className="text-muted mb-6">Sign up to be notified the moment Prometheus launches.</p>
            <Button href="/signup" size="lg">Get Early Access</Button>
          </div>
        )}
      </div>
    </Section>
  );
}
