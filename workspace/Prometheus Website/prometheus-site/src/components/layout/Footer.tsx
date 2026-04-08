import Link from "next/link";

const footerSections = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/product" },
      { label: "Capabilities", href: "/capabilities" },
      { label: "How It Works", href: "/how-it-works" },
      { label: "Pricing", href: "/pricing" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Use Cases",
    links: [
      { label: "Browser Automation", href: "/ai-browser-automation" },
      { label: "Background Tasks", href: "/background-tasks" },
      { label: "Local-First AI", href: "/local-first-ai" },
      { label: "All Use Cases", href: "/use-cases" },
      { label: "Compare", href: "/compare" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Blog", href: "/blog" },
      { label: "Get Started", href: "/get-started" },
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log In", href: "/login" },
      { label: "Sign Up", href: "/signup" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Billing", href: "/billing" },
      { label: "Settings", href: "/settings" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-charcoal">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {footerSections.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-foreground mb-4">{section.title}</h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-border gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">Prometheus</span>
          </div>
          <p className="text-sm text-muted">
            &copy; {new Date().getFullYear()} Prometheus. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
