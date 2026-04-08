import { createMetadata } from "@/lib/seo/metadata";
import { docSections } from "@/content/docs/sections";
import Link from "next/link";

export const metadata = createMetadata({
  title: "Documentation",
  description: "Learn how to use Prometheus. Guides, tutorials, API reference, and everything you need to get the most from your AI system.",
  path: "/docs",
});

export default function DocsPage() {
  return (
    <>
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal to-background" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <p className="text-sm font-medium text-ember tracking-widest uppercase mb-6">Documentation</p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Learn Prometheus
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Guides, references, and tutorials to help you get the most from your AI system.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {docSections.map((section) => (
              <div key={section.slug} className="bg-surface border border-border rounded-xl p-6 hover:border-ember/30 transition-all">
                <h2 className="text-xl font-semibold mb-2">{section.title}</h2>
                <p className="text-sm text-muted mb-5">{section.description}</p>
                <ul className="space-y-2">
                  {section.articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        href={`/docs/${section.slug}/${article.slug}`}
                        className="flex items-center gap-2 text-sm text-muted hover:text-ember transition-colors group"
                      >
                        <svg className="w-4 h-4 text-ember/50 group-hover:text-ember transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        {article.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
