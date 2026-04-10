import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center px-6">
        <p className="text-ember text-sm font-medium tracking-widest uppercase mb-4">404</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Page not found</h1>
        <p className="text-muted text-lg mb-8 max-w-md mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button href="/">Back to home</Button>
          <Button variant="secondary" href="/docs">
            Documentation
          </Button>
        </div>
        <p className="mt-12 text-sm text-muted/50">
          <Link href="/contact" className="hover:text-muted transition-colors">
            Need help? Contact us
          </Link>
        </p>
      </div>
    </div>
  );
}
