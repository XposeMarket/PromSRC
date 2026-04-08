export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readTime: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: "introducing-prometheus",
    title: "Introducing Prometheus: AI That Actually Does Things",
    description:
      "We built Prometheus because we were tired of AI that only talks. Here's what it means to have an AI system that executes.",
    date: "2026-04-01",
    author: "Prometheus Team",
    tags: ["announcement", "product"],
    readTime: "5 min",
  },
  {
    slug: "browser-automation-guide",
    title: "A Complete Guide to AI Browser Automation",
    description:
      "How Prometheus uses real Chrome sessions to navigate, extract, and interact with any website — without fragile selectors.",
    date: "2026-03-28",
    author: "Prometheus Team",
    tags: ["guide", "browser-automation"],
    readTime: "8 min",
  },
  {
    slug: "background-tasks-explained",
    title: "Background Tasks: How Prometheus Works While You Sleep",
    description:
      "Schedule work, dispatch long-running tasks, and collect results — even when you're offline. Here's how it works.",
    date: "2026-03-25",
    author: "Prometheus Team",
    tags: ["guide", "background-tasks"],
    readTime: "6 min",
  },
  {
    slug: "memory-and-context",
    title: "Why Memory Changes Everything About AI Assistants",
    description:
      "Context that persists across sessions transforms AI from a search box into a partner. Here's Prometheus's approach to memory.",
    date: "2026-03-20",
    author: "Prometheus Team",
    tags: ["deep-dive", "memory"],
    readTime: "7 min",
  },
];
