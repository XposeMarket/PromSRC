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

export function useSubscription(userId: string | undefined) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    supabase
      .from("subscriptions")
      .select("id, status, price_id, current_period_end, cancel_at_period_end")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        setSubscription(data);
        setLoading(false);
      });
  }, [userId]);

  const isActive = subscription?.status === "active" || subscription?.status === "trialing";

  return { subscription, isActive, loading };
}
