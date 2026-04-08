import { createMetadata } from "@/lib/seo/metadata";
import { Button } from "@/components/ui/Button";

export const metadata = createMetadata({
  title: "AI Browser Automation",
  description: "Prometheus controls a real Chrome browser to navigate websites, fill forms, extract data, and automate web workflows — no fragile selectors or scripts required.",
  path: "/ai-browser-automation",
});

const examples = [
  {
    title: "Web scraping & data extraction",
    description: "Navigate to any site, handle login flows, pagination, and dynamic content. Extract structured data into the format you need.",
  },
  {
    title: "Form filling & submissions",
    description: "Automate repetitive form submissions across any web application. Handle multi-step flows, file uploads, and confirmations.",
  },
  {
    title: "Competitive monitoring",
    description: "Track competitor pricing, product changes, and content updates. Get alerts when something changes.",
  },
  {
    title: "Testing & verification",
    description: "Verify that web applications work as expected. Check content, test user flows, validate deployments.",
  },
];

export default function AIBrowserAutomationPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(220,74,26,0.06)_0%,transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Browser Automation</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            AI that controls<br />your browser for you
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto mb-8">
            Prometheus uses a real Chrome browser to navigate, click, extract, and interact with any website. No scripts. No selectors. Just tell it what you need.
          </p>
          <Button href="/signup" size="lg">Try browser automation</Button>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="max-w-3xl mx-auto mb-16">
            <h2 className="text-2xl font-bold mb-4">How it works</h2>
            <div className="space-y-6">
              {["You describe what you need — \"go to this site and extract all product prices\"",
                "Prometheus opens a real Chrome browser session with full rendering and JavaScript",
                "It navigates pages, handles popups, waits for content to load, and interacts naturally",
                "Results are extracted, structured, and delivered to you — or piped into the next step"
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <span className="flex items-center justify-center w-8 h-8 rounded-full bg-ember/10 border border-ember/20 text-ember text-sm font-semibold shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-muted leading-relaxed pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <h2 className="text-2xl font-bold mb-8">What people automate</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {examples.map((ex) => (
              <div key={ex.title} className="bg-surface border border-border rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-2">{ex.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{ex.description}</p>
              </div>
            ))}
          </div>

          <div className="max-w-3xl mx-auto mt-16">
            <h2 className="text-2xl font-bold mb-4">Real browser, not a simulation</h2>
            <p className="text-muted leading-relaxed mb-4">
              Unlike browser automation tools that break on dynamic content, Prometheus sees and understands the page the way you do. It uses accessibility trees, screenshots, and DOM analysis to navigate any site — even those with complex JavaScript, authentication walls, or dynamic rendering.
            </p>
            <p className="text-muted leading-relaxed">
              You can even use your own Chrome profile with existing logins, cookies, and extensions.
            </p>
          </div>

          <div className="text-center mt-16">
            <Button href="/signup" size="lg">Start automating</Button>
          </div>
        </div>
      </section>
    </>
  );
}
