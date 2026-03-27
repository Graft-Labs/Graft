import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const PLAN_PRICES: Record<string, { productId: string; priceId: string; scansLimit: number }> = {
  pro: { productId: process.env.POLAR_PRO_PRODUCT_ID || "", priceId: process.env.POLAR_PRO_PRICE_ID || "", scansLimit: 50 },
  unlimited: { productId: process.env.POLAR_UNLIMITED_PRODUCT_ID || "", priceId: process.env.POLAR_UNLIMITED_PRICE_ID || "", scansLimit: 999999 },
};

const PLAN_PRODUCT_MAP: Record<string, string> = {};
if (process.env.POLAR_PRO_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_PRO_PRODUCT_ID] = "pro";
if (process.env.POLAR_UNLIMITED_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_UNLIMITED_PRODUCT_ID] = "unlimited";

const VALID_PLAN_IDS = new Set(Object.keys(PLAN_PRICES));

type PolarSubscription = Record<string, unknown>;

function extractSubscriptions(payload: Record<string, unknown>): PolarSubscription[] {
  const direct = payload.subscriptions;
  if (Array.isArray(direct)) return direct as PolarSubscription[];
  const cs = payload.customer_state as Record<string, unknown> | undefined;
  const nested = cs?.subscriptions;
  if (Array.isArray(nested)) return nested as PolarSubscription[];
  const data = payload.data;
  if (Array.isArray(data)) return data as PolarSubscription[];
  return [];
}

function findActiveSubscription(subs: PolarSubscription[]): PolarSubscription | null {
  if (!subs.length) return null;
  const active = subs.find((s) => {
    const st = typeof s.status === "string" ? s.status.toLowerCase() : "";
    return st === "active" || st === "trialing";
  });
  if (active) return active;
  // Accept cancelled (cancel-at-period-end) since it's still technically active
  const cancelled = subs.find((s) => {
    const st = typeof s.status === "string" ? s.status.toLowerCase() : "";
    return st === "cancelled" || st === "canceled";
  });
  if (cancelled) return cancelled;
  return subs[0];
}

function getPlanFromSubscription(sub: PolarSubscription): string | null {
  const productId =
    (sub.product_id as string | undefined) ||
    ((sub.product as Record<string, unknown> | undefined)?.id as string | undefined);
  if (productId && PLAN_PRODUCT_MAP[productId]) return PLAN_PRODUCT_MAP[productId];
  const items = sub.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const id =
        (item.product_id as string | undefined) ||
        ((item.product as Record<string, unknown> | undefined)?.id as string | undefined);
      if (id && PLAN_PRODUCT_MAP[id]) return PLAN_PRODUCT_MAP[id];
    }
  }
  return null;
}

/**
 * POST /api/subscription/change-plan
 *
 * Seamlessly change the user's subscription plan.
 * Handles all scenarios:
 * - Free → Pro/Unlimited (creates new checkout)
 * - Pro → Unlimited (direct subscription update via Polar API)
 * - Unlimited → Pro (direct subscription update via Polar API — downgrade)
 * - Pro/Unlimited → Free (cancels subscription immediately)
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`change-plan:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const targetPlan = (body as Record<string, unknown>).targetPlan as string;
    if (typeof targetPlan !== "string") {
      return NextResponse.json({ error: "Missing targetPlan" }, { status: 400 });
    }

    // Validate target plan
    if (targetPlan !== "free" && !VALID_PLAN_IDS.has(targetPlan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === "your_polar_access_token_here") {
      return NextResponse.json({
        error: "Payment not configured",
        message: "Polar.sh is not configured. Please contact support.",
      }, { status: 500 });
    }

    // Read current user state
    const { data: userData } = await supabase
      .from("users")
      .select("plan, subscription_id, subscription_status, customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const currentPlan = userData?.plan || "free";
    const subscriptionId = userData?.subscription_id;
    const subscriptionStatus = (userData?.subscription_status || "").toLowerCase();
    const hasActiveSubscription =
      Boolean(subscriptionId) &&
      (subscriptionStatus === "active" || subscriptionStatus === "trialing" || subscriptionStatus === "cancelled");

    // Same plan — no-op
    if (targetPlan === currentPlan) {
      return NextResponse.json({
        success: true,
        action: "none",
        plan: currentPlan,
        message: "You are already on this plan.",
      });
    }

    // ─────────────────────────────────────────────────────────
    // SCENARIO 1: Downgrade to Free (cancel subscription)
    // ─────────────────────────────────────────────────────────
    if (targetPlan === "free") {
      if (!hasActiveSubscription || !subscriptionId) {
        // Already effectively free
        await supabase
          .from("users")
          .update({
            plan: "free",
            scans_limit: 3,
            subscription_status: "inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);

        return NextResponse.json({
          success: true,
          action: "downgraded",
          plan: "free",
          message: "Your plan has been changed to Free.",
        });
      }

      // Cancel subscription at period end via Polar
      const cancelResp = await fetch(
        `${POLAR_API_URL}/subscriptions/${subscriptionId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cancel_at_period_end: true }),
        },
      );

      if (!cancelResp.ok) {
        const errText = await cancelResp.text();
        console.error("Failed to cancel subscription for downgrade:", cancelResp.status, errText);
        return NextResponse.json({
          error: "Failed to cancel subscription",
          message: "Could not downgrade to free. Please try again.",
        }, { status: 500 });
      }

      const cancelledSub = (await cancelResp.json()) as Record<string, unknown>;
      const periodEnd = cancelledSub.current_period_end as string | undefined;

      await supabase
        .from("users")
        .update({
          subscription_status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      return NextResponse.json({
        success: true,
        action: "cancel_scheduled",
        plan: currentPlan,
        message: periodEnd
          ? `Your subscription will be cancelled at the end of the billing period (${new Date(periodEnd).toLocaleDateString()}).`
          : "Your subscription will be cancelled at the end of the billing period.",
        currentPeriodEnd: periodEnd || null,
      });
    }

    // ─────────────────────────────────────────────────────────
    // SCENARIO 2: Free → Paid Plan (new checkout)
    // ─────────────────────────────────────────────────────────
    if (currentPlan === "free" || !hasActiveSubscription) {
      const plan = PLAN_PRICES[targetPlan];
      if (!plan || !plan.productId) {
        return NextResponse.json({ error: "Invalid plan configuration" }, { status: 400 });
      }

      const checkoutBody: Record<string, unknown> = {
        products: [plan.productId],
        customer_email: user.email,
        external_customer_id: user.id,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success&target_plan=${targetPlan}&checkout_id={CHECKOUT_ID}`,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
      };

      if (plan.productId) checkoutBody.product_id = plan.productId;
      if (plan.priceId) checkoutBody.product_price_id = plan.priceId;

      const checkoutResp = await fetch(`${POLAR_API_URL}/checkouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(checkoutBody),
      });

      if (!checkoutResp.ok) {
        const errText = await checkoutResp.text();
        console.error("Checkout creation failed:", checkoutResp.status, errText);
        return NextResponse.json({
          error: "Failed to create checkout",
          message: "Could not start checkout. Please try again.",
        }, { status: 500 });
      }

      const checkout = (await checkoutResp.json()) as Record<string, unknown>;

      return NextResponse.json({
        success: true,
        action: "checkout",
        redirectUrl: checkout.url as string,
        checkoutId: checkout.id as string,
        message: "Redirecting to checkout...",
      });
    }

    // ─────────────────────────────────────────────────────────
    // SCENARIO 3: Paid → Different Paid Plan (direct swap)
    // Pro → Unlimited or Unlimited → Pro
    // ─────────────────────────────────────────────────────────
    const plan = PLAN_PRICES[targetPlan];
    if (!plan || !plan.productId) {
      return NextResponse.json({ error: "Invalid plan configuration" }, { status: 400 });
    }

    // First, resolve the actual subscription ID if needed
    let resolvedSubId = subscriptionId;

    if (!resolvedSubId) {
      // Try to find subscription from Polar using external customer ID
      const stateResp = await fetch(
        `${POLAR_API_URL}/customers/external/${encodeURIComponent(user.id)}/state`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (stateResp.ok) {
        const statePayload = (await stateResp.json()) as Record<string, unknown>;
        const subs = extractSubscriptions(statePayload);
        const picked = findActiveSubscription(subs);
        if (picked) {
          resolvedSubId = picked.id as string;
        }
      }
    }

    if (!resolvedSubId) {
      // No subscription found — fall back to checkout
      return NextResponse.json({
        success: true,
        action: "checkout_fallback",
        message: "No active subscription found. Redirecting to checkout...",
        redirectUrl: null,
      });
    }

    // Directly update the subscription to the new product
    const updateResp = await fetch(
      `${POLAR_API_URL}/subscriptions/${resolvedSubId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: plan.productId,
        }),
      },
    );

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      console.error("Subscription plan change failed:", updateResp.status, errText);

      // If PATCH fails, try creating a checkout with subscription_id as fallback
      const upgradeCheckoutBody: Record<string, unknown> = {
        products: [plan.productId],
        subscription_id: resolvedSubId,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success&target_plan=${targetPlan}&checkout_id={CHECKOUT_ID}`,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
      };

      const fallbackResp = await fetch(`${POLAR_API_URL}/checkouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(upgradeCheckoutBody),
      });

      if (fallbackResp.ok) {
        const fallbackCheckout = (await fallbackResp.json()) as Record<string, unknown>;
        return NextResponse.json({
          success: true,
          action: "checkout",
          redirectUrl: fallbackCheckout.url as string,
          checkoutId: fallbackCheckout.id as string,
          message: "Redirecting to confirm plan change...",
        });
      }

      return NextResponse.json({
        error: "Failed to change plan",
        message: "Could not update your subscription. Please try again or contact support.",
      }, { status: 500 });
    }

    const updatedSub = (await updateResp.json()) as Record<string, unknown>;

    // Detect the new plan from the updated subscription
    const detectedPlan = getPlanFromSubscription(updatedSub) || targetPlan;
    const scansLimit = PLAN_PRICES[detectedPlan]?.scansLimit ?? 50;

    // Update our database immediately
    const resolvedCustomerId =
      (updatedSub.customer_id as string | undefined) ||
      ((updatedSub.customer as Record<string, unknown> | undefined)?.id as string | undefined) ||
      userData?.customer_id;

    await supabase
      .from("users")
      .update({
        plan: detectedPlan,
        scans_limit: scansLimit,
        subscription_id: (updatedSub.id as string) || resolvedSubId,
        subscription_status: "active",
        customer_id: resolvedCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    const isUpgrade =
      (currentPlan === "pro" && targetPlan === "unlimited") ||
      (currentPlan === "free" && targetPlan !== "free");
    const isDowngrade =
      (currentPlan === "unlimited" && targetPlan === "pro");

    return NextResponse.json({
      success: true,
      action: isUpgrade ? "upgraded" : isDowngrade ? "downgraded" : "changed",
      plan: detectedPlan,
      scansLimit,
      message: isUpgrade
        ? `Successfully upgraded to ${detectedPlan.charAt(0).toUpperCase() + detectedPlan.slice(1)}! Your new limits are active immediately.`
        : isDowngrade
          ? `Successfully changed to ${detectedPlan.charAt(0).toUpperCase() + detectedPlan.slice(1)}. Changes take effect at next billing cycle.`
          : `Plan changed to ${detectedPlan.charAt(0).toUpperCase() + detectedPlan.slice(1)}.`,
    });
  } catch (error) {
    console.error("Change plan error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
