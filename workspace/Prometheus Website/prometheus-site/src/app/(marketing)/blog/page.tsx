import { createMetadata } from "@/lib/seo/metadata";
import { blogPosts } from "@/content/blog/posts";
import Link from "next/link";

export const metadata = createMetadata({
  title: "Blog",
  description: "Insights, guides, and updates from the Prometheus team. Learn about AI execution, browser automation, background tasks, and more.",
  path: "/blog",
});

export default function BlogPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Blog</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            From the Prometheus team
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Guides, deep dives, and product updates.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="space-y-8">
            {blogPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block bg-surface border border-border rounded-xl p-6 md:p-8 hover:border-ember/30 transition-all group"
              >
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <time className="text-xs text-muted">{post.date}</time>
                  <span className="text-xs text-muted">·</span>
                  <span className="text-xs text-muted">{post.readTime} read</span>
                  {post.tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded bg-ember/10 text-ember/70 border border-ember/10">
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="text-xl font-semibold mb-2 group-hover:text-ember transition-colors">
                  {post.title}
                </h2>
                <p className="text-sm text-muted leading-relaxed">{post.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
