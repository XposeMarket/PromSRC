import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
}

export async function POST(request: Request) {
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

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } else {
      // Dev mode: no signature verification
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (userId && customerId) {
          // Save Stripe customer ID to profile
          await supabaseAdmin
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
        }

        if (subscriptionId && userId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await supabaseAdmin.from("subscriptions").upsert({
            id: sub.id,
            user_id: userId,
            status: sub.status,
            price_id: sub.items.data[0]?.price.id,
            current_period_end: new Date(
              (sub as unknown as { current_period_end: number }).current_period_end * 1000
            ).toISOString(),
            cancel_at_period_end: sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        // Find user by stripe_customer_id
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", sub.customer as string)
          .single();

        if (profile) {
          await supabaseAdmin.from("subscriptions").upsert({
            id: sub.id,
            user_id: profile.id,
            status: sub.status,
            price_id: sub.items.data[0]?.price.id,
            current_period_end: new Date(
              (sub as unknown as { current_period_end: number }).current_period_end * 1000
            ).toISOString(),
            cancel_at_period_end: sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
