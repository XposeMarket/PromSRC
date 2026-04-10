export interface DocSection {
  slug: string;
  title: string;
  description: string;
  articles: { slug: string; title: string }[];
}

export const docSections: DocSection[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description: "Set up your Prometheus account and start using the system.",
    articles: [
      { slug: "quickstart", title: "Quickstart Guide" },
      { slug: "installation", title: "Installation" },
      { slug: "first-task", title: "Your First Task" },
      { slug: "account-setup", title: "Account Setup" },
    ],
  },
  {
    slug: "core-concepts",
    title: "Core Concepts",
    description: "Understand how Prometheus thinks and works.",
    articles: [
      { slug: "how-it-works", title: "How Prometheus Works" },
      { slug: "tools", title: "Tools & Execution" },
      { slug: "memory", title: "Memory System" },
      { slug: "sessions", title: "Sessions & Context" },
    ],
  },
  {
    slug: "features",
    title: "Features",
    description: "Deep dives into each major feature area.",
    articles: [
      { slug: "browser-automation", title: "Browser Automation" },
      { slug: "background-tasks", title: "Background Tasks" },
      { slug: "scheduling", title: "Scheduling & Cron" },
      { slug: "teams", title: "Teams & Subagents" },
      { slug: "integrations", title: "Integrations" },
    ],
  },
  {
    slug: "api-reference",
    title: "API Reference",
    description: "Technical reference for developers and integrators.",
    articles: [
      { slug: "rest-api", title: "REST API" },
      { slug: "webhooks", title: "Webhooks" },
      { slug: "authentication", title: "Authentication" },
    ],
  },
];
