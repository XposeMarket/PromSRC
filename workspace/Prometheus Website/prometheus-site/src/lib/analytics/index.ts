type EventName =
  | "intro_completed"
  | "intro_skipped"
  | "hero_cta_clicked"
  | "pricing_cta_clicked"
  | "signup_started"
  | "subscription_started"
  | "docs_engaged"
  | "blog_engaged"
  | "page_view";

interface AnalyticsEvent {
  name: EventName;
  properties?: Record<string, string | number | boolean>;
}

class Analytics {
  private enabled: boolean;

  constructor() {
    this.enabled = typeof window !== "undefined";
  }

  track({ name, properties }: AnalyticsEvent) {
    if (!this.enabled) return;

    // Placeholder: replace with your analytics vendor (Plausible, PostHog, Mixpanel, etc.)
    if (process.env.NODE_ENV === "development") {
      console.log(`[Analytics] ${name}`, properties);
    }

    // Example: window.plausible?.(name, { props: properties });
    // Example: posthog?.capture(name, properties);
  }

  page(path: string) {
    this.track({ name: "page_view", properties: { path } });
  }
}

export const analytics = new Analytics();
export type { EventName, AnalyticsEvent };
