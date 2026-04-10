"use client";

import { useRef, useState } from "react";

interface VideoHeroProps {
  src?: string;
  poster?: string;
  className?: string;
}

export function VideoHero({ src, poster, className = "" }: VideoHeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  if (!src) {
    return (
      <div className={`relative aspect-video bg-charcoal rounded-xl border border-border overflow-hidden ${className}`}>
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted">Video coming soon</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative aspect-video rounded-xl overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      {!loaded && (
        <div className="absolute inset-0 bg-charcoal flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-ember/30 border-t-ember rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
