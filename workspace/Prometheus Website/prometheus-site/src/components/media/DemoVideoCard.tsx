"use client";

interface DemoVideoCardProps {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
}

export function DemoVideoCard({ title, description, thumbnailUrl }: DemoVideoCardProps) {
  return (
    <div className="group rounded-xl border border-border bg-surface overflow-hidden hover:border-ember/30 transition-all">
      <div className="relative aspect-video bg-charcoal">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-ember/20 border border-ember/30 flex items-center justify-center group-hover:bg-ember/30 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-ember ml-0.5">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm mb-1">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
    </div>
  );
}
