import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://prometheus.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/product",
    "/capabilities",
    "/how-it-works",
    "/pricing",
    "/security",
    "/docs",
    "/blog",
    "/about",
    "/contact",
    "/use-cases",
    "/compare",
    "/ai-browser-automation",
    "/background-tasks",
    "/local-first-ai",
    "/login",
    "/signup",
    "/get-started",
  ];

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/pricing" ? 0.9 : 0.7,
  }));
}
