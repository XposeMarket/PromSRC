import type { Metadata } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://prometheus.ai";
const SITE_NAME = "Prometheus";

interface PageMetaOptions {
  title: string;
  description: string;
  path?: string;
  ogImage?: string;
  noIndex?: boolean;
}

export function createMetadata({
  title,
  description,
  path = "",
  ogImage = "/og/default.png",
  noIndex = false,
}: PageMetaOptions): Metadata {
  const url = `${SITE_URL}${path}`;
  const fullTitle = path === "" ? `${SITE_NAME} — ${title}` : `${title} | ${SITE_NAME}`;

  return {
    title: fullTitle,
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export { SITE_URL, SITE_NAME };
