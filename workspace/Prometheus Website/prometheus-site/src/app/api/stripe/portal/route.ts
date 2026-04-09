import { NextResponse } from "next/server";
import Stripe from "stripe";

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
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

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY as string;
    const stripe = new Stripe(stripeSecretKey);
    const { customerId } = await request.json().catch(() => ({}));
    const origin = new URL(request.url).origin;

    if (!customerId) {
      return NextResponse.json(
        { error: "No customer ID provided" },
        { status: 400 }
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe portal error:", err);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
