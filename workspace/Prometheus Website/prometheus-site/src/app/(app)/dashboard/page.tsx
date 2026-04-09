"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/lib/auth/useUser";
import { useSubscription } from "@/lib/auth/useSubscription";
import { createCheckoutSession, PLANS } from "@/lib/stripe";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: "easeOut" as const },
  }),
};

const quickActions = [
  {
    label: "Get Started",
    description: "Step-by-step onboarding guide",
    href: "/get-started",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
      </svg>
    ),
  },
  {
    label: "Documentation",
    description: "API references and guides",
    href: "/docs",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    label: "Billing",
    description: "Manage your subscription",
    href: "/billing",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="1" y="4" width="22" height="16" rx="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    label: "Settings",
    description: "Account and preferences",
    href: "/settings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
];

const recentActivity = [
  { action: "Task completed", detail: "Browser data extraction", time: "2 hours ago" },
  { action: "Scheduled job ran", detail: "Daily report generation", time: "6 hours ago" },
  { action: "Team deployed", detail: "Analysis team alpha", time: "1 day ago" },
  { action: "Integration connected", detail: "Telegram channel", time: "2 days ago" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function DashboardPage() {
  const { user, profile } = useUser();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { subscription, isActive, loading: subLoading } = useSubscription(user?.id, refreshKey);

  const displayName = profile?.display_name ?? user?.email?.split("@")[0] ?? "there";
  const renewalLabel = subscription?.cancel_at_period_end ? "Access ends" : "Renews";

  useEffect(() => {
    setCheckoutSuccess(new URLSearchParams(window.location.search).get("checkout") === "success");
  }, []);

  useEffect(() => {
    if (!checkoutSuccess || isActive || !user?.id) return;

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      setRefreshKey((value) => value + 1);
      if (attempts >= 8) {
        window.clearInterval(interval);
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [checkoutSuccess, isActive, user?.id]);

  async function handleActivatePlan() {
    setActionError(null);
    setActionLoading(true);
    try {
      await createCheckoutSession(PLANS.pro.priceId, { returnPath: "/dashboard" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Checkout could not be started.");
      setActionLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Welcome panel */}
      <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Welcome back{displayName ? `, ${displayName}` : ""}
            </h1>
            <p className="text-muted mt-1">
              Here is an overview of your Prometheus workspace.
            </p>
          </div>
          <Button variant="primary" size="sm" href="/get-started">
            Quick start guide
          </Button>
        </div>
      </motion.div>

      {/* Subscription status */}
      <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
        <Card>
          {actionError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
              {actionError}
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-ember/10 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-ember)" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    Prometheus Pro
                  </h2>
                  {!subLoading && (
                    isActive
                      ? <Badge variant="green">Active</Badge>
                      : <Badge variant="default">Inactive</Badge>
                  )}
                </div>
                <p className="text-sm text-muted mt-0.5">
                  {subLoading
                    ? "Loading…"
                    : isActive && subscription?.current_period_end
                      ? `$8 / month · ${renewalLabel} ${formatDate(subscription.current_period_end)}`
                      : subscription
                        ? `Subscription status: ${subscription.status}`
                        : "No active subscription"}
                </p>
              </div>
            </div>
            {!subLoading && (
              isActive
                ? <Button variant="secondary" size="sm" href="/billing">Manage plan</Button>
                : <Button variant="primary" size="sm" onClick={handleActivatePlan} disabled={actionLoading}>
                    {actionLoading ? "Redirecting…" : "Activate plan"}
                  </Button>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Quick actions */}
      <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp}>
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <Card key={action.label} hover>
              <a href={action.href} className="block group">
                <div className="text-muted group-hover:text-ember transition-colors mb-3">
                  {action.icon}
                </div>
                <h3 className="text-sm font-semibold text-foreground">{action.label}</h3>
                <p className="text-xs text-muted mt-1">{action.description}</p>
              </a>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Recent activity */}
      <motion.div initial="hidden" animate="visible" custom={3} variants={fadeUp}>
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent activity</h2>
        <Card>
          <ul className="divide-y divide-border" role="list">
            {recentActivity.map((item, i) => (
              <li key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.action}</p>
                  <p className="text-xs text-muted mt-0.5">{item.detail}</p>
                </div>
                <span className="text-xs text-muted whitespace-nowrap ml-4">{item.time}</span>
              </li>
            ))}
          </ul>
        </Card>
      </motion.div>
    </div>
  );
}
