"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  display_name: string | null;
  stripe_customer_id: string | null;
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        supabase
          .from("profiles")
          .select("id, display_name, stripe_customer_id")
          .eq("id", user.id)
          .single()
          .then(({ data }) => setProfile(data));
      }
      setLoading(false);
    });
  }, []);

  return { user, profile, loading };
}
