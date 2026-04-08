import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { supabase } from "@/lib/auth/supabase";

let stripePromise: Promise<Stripe | null>;

export function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder"
    );
  }
  return stripePromise;
}

export const PLANS = {
  pro: {
    name: "Prometheus Pro",
    price: 8,
    interval: "month" as const,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || "price_placeholder",
    features: [
      "Full AI system access",
      "Browser automation",
      "Background tasks & scheduling",
      "Persistent memory across sessions",
      "Team & subagent orchestration",
      "File & workflow execution",
      "Priority support",
    ],
  },
} as const;

export async function createCheckoutSession(priceId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ priceId }),
  });
  const { url, error } = await response.json();
  if (error) throw new Error(error);
  if (url) window.location.href = url;
}

export async function createPortalSession(customerId?: string) {
  if (!customerId) {
    // No subscription yet — send to checkout
    return createCheckoutSession(PLANS.pro.priceId);
  }
  const response = await fetch("/api/stripe/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId }),
  });
  const { url, error } = await response.json();
  if (error) throw new Error(error);
  if (url) window.location.href = url;
}
