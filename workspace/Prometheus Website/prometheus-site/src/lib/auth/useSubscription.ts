"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export interface Subscription {
  id: string;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export function useSubscription(userId: string | undefined, refreshKey: number = 0) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setLoading(false);
      setSubscription(null);
      return;
    }

    setLoading(true);
    setSubscription(null);

    (async () => {
      try {
        const { data, error } = await supabase
          .from("subscriptions")
          .select("id, status, price_id, current_period_end, cancel_at_period_end")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .order("current_period_end", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          setSubscription(null);
        } else {
          setSubscription(data ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const isVerified = Boolean(subscription);

  return { subscription, isActive, isVerified, loading };
}
