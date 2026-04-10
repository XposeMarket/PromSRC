import { createMetadata } from "@/lib/seo/metadata";
import { AppLayout } from "@/components/layout/AppLayout";

export const metadata = createMetadata({
  title: "App",
  description: "Prometheus application dashboard.",
  path: "/dashboard",
  noIndex: true,
});

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
