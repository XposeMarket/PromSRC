import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

// This route redirects to the latest installer download.
// The download button on the site points here so it always serves the current version.

export async function GET() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/XposeMarket/prometheus-releases/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Prometheus-Website/1.0",
        },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.redirect(
        "https://github.com/XposeMarket/prometheus-releases/releases/latest"
      );
    }

    const data = await res.json();
    const exeAsset = data.assets?.find((a: { name: string }) =>
      a.name.endsWith(".exe")
    );

    const downloadUrl =
      exeAsset?.browser_download_url ?? data.html_url;

    return NextResponse.redirect(downloadUrl);
  } catch {
    return NextResponse.redirect(
      "https://github.com/XposeMarket/prometheus-releases/releases/latest"
    );
  }
}
