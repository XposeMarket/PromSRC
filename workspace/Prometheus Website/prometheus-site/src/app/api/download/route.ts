import { NextResponse } from "next/server";
import { getLatestRelease } from "@/lib/releases/github";

// This route redirects to the latest installer download.
// The download button on the site points here so it always serves the current version.

export async function GET() {
  const release = await getLatestRelease();

  return NextResponse.redirect(
    release.downloadUrl ??
      "https://github.com/XposeMarket/prometheus-releases/releases/latest"
  );
}
