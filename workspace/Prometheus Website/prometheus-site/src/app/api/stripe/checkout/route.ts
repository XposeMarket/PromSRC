import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
}

function normalizeReturnPath(raw: unknown) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  return value;
}

export async function POST(request: Request) {
  try {
    const missingStripeEnv = missingEnv(["STRIPE_SECRET_KEY"]);
    if (missingStripeEnv.length > 0) {
      return NextResponse.json(
        { error: `Missing server env: ${missingStripeEnv.join(", ")}` },
        { status: 500 }
      );
    }
    const missingSupabaseEnv = missingEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    if (missingSupabaseEnv.length > 0) {
      return NextResponse.json(
        { error: `Missing server env: ${missingSupabaseEnv.join(", ")}` },
        { status: 500 }
      );
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY as string;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

    const stripe = new Stripe(stripeSecretKey);
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey
    );
    const origin = new URL(request.url).origin;

    const { priceId, returnPath } = await request.json();
    if (!priceId) {
      return NextResponse.json(
        { error: "No price ID provided" },
        { status: 400 }
      );
    }

    // Get the logged-in user from the Authorization header
    const authHeader = request.headers.get("authorization");
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      userId = user?.id;
      userEmail = user?.email ?? undefined;
    }

    if (!userId) {
      return NextResponse.json(
        { error: "You must be signed in to start checkout" },
        { status: 401 }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    const safeReturnPath = normalizeReturnPath(returnPath);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}${safeReturnPath}?checkout=success`,
      cancel_url: `${origin}${safeReturnPath}`,
      client_reference_id: userId,
      customer: profile?.stripe_customer_id ?? undefined,
      customer_email: profile?.stripe_customer_id ? undefined : userEmail,
      metadata: { user_id: userId },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
