import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  PLAN_PRODUCT_IDS,
  PLAN_SCANS_LIMITS,
  createCheckoutUrl,
  getSubscriptionStatus,
  isPolarConfigured,
  resolveCustomerFromPolarExternalId,
  type PlanId,
} from "@/lib/polar-adapter";

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
          message:
            "Polar is not configured. Please contact support or configure billing.",
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
      .select("plan, customer_id")
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

    const { customerId, subscription } = await resolveCustomerFromPolarExternalId(
      user.id,
    );
    const status = subscription ? getSubscriptionStatus(subscription) : null;
    const hasActiveSubscription = Boolean(status?.active);

    if (hasActiveSubscription && customerId && subscription) {
      const nextPlanScans = PLAN_SCANS_LIMITS[currentPlan] ?? 3;
      await supabase
        .from("users")
        .update({
          customer_id: customerId,
          subscription_id: (subscription.id as string | undefined) || null,
          subscription_status: status?.status || "active",
          scans_limit: nextPlanScans,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      return NextResponse.json(
        {
          error: "Active subscription exists",
          message: "You already have an active subscription. Use Billing Portal to change plans.",
          shouldOpenPortal: true,
        },
        { status: 409 },
      );
    }

    const checkoutUrl = await createCheckoutUrl({
      productId,
      userId: user.id,
      customerEmail: user.email,
      customerId: customerId || (userRow?.customer_id as string | undefined) || null,
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

    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    console.error("Checkout route error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 },
    );
  }
}
