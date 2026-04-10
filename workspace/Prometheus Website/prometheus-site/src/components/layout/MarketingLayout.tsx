import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

interface MarketingLayoutProps {
  children: React.ReactNode;
}

export function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <>
      <Navbar />
      <main id="main-content" className="flex-1 pt-16">
        {children}
      </main>
      <Footer />
    </>
  );
}
