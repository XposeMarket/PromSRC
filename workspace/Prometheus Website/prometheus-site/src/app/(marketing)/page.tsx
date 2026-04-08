import { IntroGate } from "@/components/intro/IntroGate";
import { Hero } from "@/components/hero/Hero";
import { CapabilitiesPreview } from "@/components/sections/CapabilitiesPreview";
import { NotJustChat } from "@/components/sections/NotJustChat";
import { DemoSection } from "@/components/sections/DemoSection";
import { WorkflowStories } from "@/components/sections/WorkflowStories";
import { PricingPreview } from "@/components/sections/PricingPreview";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function HomePage() {
  return (
    <IntroGate>
      <Hero />
      <CapabilitiesPreview />
      <NotJustChat />
      <DemoSection />
      <WorkflowStories />
      <PricingPreview />
      <FinalCTA />
    </IntroGate>
  );
}
