import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  PLAN_PRODUCT_IDS,
  PLAN_SCANS_LIMITS,
  getSubscriptionStatus,
  isPolarConfigured,
  getPolarAccessToken,
  getPolarServer,
  resolveCustomerFromPolarExternalId,
  type PlanId,
} from "@/lib/polar-adapter";
import { Polar } from "@polar-sh/sdk";

const VALID_PAID_PLANS: Array<Exclude<PlanId, "free">> = ["pro", "unlimited"];

function isPaidPlan(value: string): value is Exclude<PlanId, "free"> {
  return VALID_PAID_PLANS.includes(value as Exclude<PlanId, "free">);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`checkout:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { planId?: string }
      | null;

    const planId = body?.planId;
    if (!planId || !isPaidPlan(planId)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    if (!isPolarConfigured()) {
      return NextResponse.json(
        {
          error: "Payment not configured",
          message: "Polar is not configured. Please contact support.",
        },
        { status: 500 },
      );
    }

    const productId = PLAN_PRODUCT_IDS[planId];
    if (!productId) {
      return NextResponse.json(
        {
          error: "Invalid plan configuration",
          message: `Missing Polar product id for ${planId} plan`,
        },
        { status: 500 },
      );
    }

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("plan, customer_id, subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    const currentPlan = (userRow?.plan as PlanId | null) || "free";
    if (currentPlan === planId) {
      return NextResponse.json(
        {
          error: "Already on this plan",
          message: `You are already on ${planId}`,
        },
        { status: 409 },
      );
    }

    const polar = new Polar({
      accessToken: getPolarAccessToken(),
      server: getPolarServer(),
    });

    // Check if user already has an active subscription in Polar
    const { customerId, subscription } = await resolveCustomerFromPolarExternalId(user.id);
    const status = subscription ? getSubscriptionStatus(subscription) : null;
    const hasActiveSubscription = Boolean(status?.active);
    const subscriptionId =
      (subscription?.id as string | undefined) ||
      (userRow?.subscription_id as string | undefined) ||
      null;

    // If user has an active subscription, UPDATE it instead of creating a new checkout
    if (hasActiveSubscription && subscriptionId) {
      console.log("[Checkout] Updating existing subscription", {
        subscriptionId,
        from: currentPlan,
        to: planId,
        productId,
      });

      const updated = await polar.subscriptions.update({
        id: subscriptionId,
        subscriptionUpdate: {
          productId,
          prorationBehavior: "invoice",
        },
      });

      // Update DB immediately
      await supabase
        .from("users")
        .update({
          plan: planId,
          scans_limit: PLAN_SCANS_LIMITS[planId],
          subscription_id: updated.id,
          subscription_status: "active",
          customer_id: customerId || (userRow?.customer_id as string | undefined) || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      return NextResponse.json({
        success: true,
        action: "updated",
        plan: planId,
        scansLimit: PLAN_SCANS_LIMITS[planId],
        message: `Plan changed to ${planId}.`,
      });
    }

    // No active subscription — create a new checkout
    const baseUrl = req.nextUrl.origin;
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl: `${baseUrl}/dashboard/settings?tab=billing&upgrade=success`,
      returnUrl: `${baseUrl}/dashboard/settings?tab=billing`,
      externalCustomerId: user.id,
      customerEmail: user.email || undefined,
      customerId: customerId || (userRow?.customer_id as string | undefined) || undefined,
      metadata: {
        user_id: user.id,
        plan: planId,
      },
    });

    if (customerId) {
      await supabase
        .from("users")
        .update({ customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Checkout route error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 },
    );
  }
}
