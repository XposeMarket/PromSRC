"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PLANS, createPortalSession, createCheckoutSession } from "@/lib/stripe";
import { useUser } from "@/lib/auth/useUser";
import { useSubscription } from "@/lib/auth/useSubscription";
import { useState } from "react";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BillingPage() {
  const { user, profile, loading: userLoading } = useUser();
  const { subscription, isActive, loading: subLoading } = useSubscription(user?.id);
  const [actionLoading, setActionLoading] = useState(false);
  const plan = PLANS.pro;

  const loading = userLoading || subLoading;

  async function handleManage() {
    setActionLoading(true);
    try {
      await createPortalSession(profile?.stripe_customer_id ?? undefined);
    } catch {
      setActionLoading(false);
    }
  }

  async function handleSubscribe() {
    setActionLoading(true);
    try {
      await createCheckoutSession(plan.priceId);
    } catch {
      setActionLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-muted mt-1">Manage your subscription and payment details.</p>
      </motion.div>

      {/* Current plan */}
      <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
        <Card>
          {loading ? (
            <p className="text-sm text-muted">Loading subscription…</p>
          ) : isActive ? (
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-lg font-semibold text-foreground">{plan.name}</h2>
                    <Badge variant="green">
                      {subscription?.status === "trialing" ? "Trial" : "Active"}
                    </Badge>
                    {subscription?.cancel_at_period_end && (
                      <Badge variant="default">Cancels at period end</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    ${plan.price}/{plan.interval} · Next billing date: {formatDate(subscription?.current_period_end ?? null)}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-2">Included features</h3>
                  <ul className="space-y-1.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-muted">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ember)" strokeWidth="2.5" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end shrink-0">
                <div className="text-3xl font-bold text-foreground">
                  ${plan.price}
                  <span className="text-base font-normal text-muted">/{plan.interval}</span>
                </div>
                <Button variant="primary" size="sm" onClick={handleManage} disabled={actionLoading}>
                  {actionLoading ? "Redirecting…" : "Manage Subscription"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">No active subscription</h2>
                <p className="text-sm text-muted">
                  Subscribe to Prometheus Pro to unlock the full system for ${plan.price}/month.
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={handleSubscribe} disabled={actionLoading}>
                {actionLoading ? "Redirecting…" : "Subscribe — $8/mo"}
              </Button>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Manage / change plan */}
      {isActive && (
        <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp}>
          <h2 className="text-lg font-semibold text-foreground mb-4">Need to make changes?</h2>
          <Card>
            <p className="text-sm text-muted">
              You can update your payment method, download invoices, or cancel your subscription
              at any time through the Stripe customer portal. Changes take effect immediately and
              are prorated automatically.
            </p>
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" size="sm" onClick={handleManage} disabled={actionLoading}>
                Open billing portal
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
