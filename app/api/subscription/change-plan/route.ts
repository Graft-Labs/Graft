import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  PLAN_PRODUCT_IDS,
  PLAN_SCANS_LIMITS,
  createCheckoutUrl,
  getSubscriptionStatus,
  type PlanId,
} from "@/lib/polar-adapter";
import {
  patchSubscription,
  fetchBestSubscriptionForUser,
  resolvePlanFromSubscription,
} from "@/lib/subscription-core";

const VALID_PLANS: PlanId[] = ["free", "pro", "unlimited"];

function isPlan(value: string): value is PlanId {
  return VALID_PLANS.includes(value as PlanId);
}

function isPaid(plan: PlanId): plan is Exclude<PlanId, "free"> {
  return plan === "pro" || plan === "unlimited";
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`change-plan:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { targetPlan?: string }
      | null;

    const targetPlan = body?.targetPlan;
    if (!targetPlan || !isPlan(targetPlan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
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
      .select("plan, subscription_id, subscription_status, customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const currentPlan = ((userRow?.plan as PlanId | undefined) || "free") as PlanId;
    if (currentPlan === targetPlan) {
      return NextResponse.json({
        success: true,
        action: "none",
        plan: currentPlan,
        message: "You are already on this plan.",
      });
    }

    const subscription = await fetchBestSubscriptionForUser({
      userId: user.id,
      customerId: (userRow?.customer_id as string | undefined) || null,
      subscriptionId: (userRow?.subscription_id as string | undefined) || null,
    });

    const status = subscription ? getSubscriptionStatus(subscription) : null;
    const hasActiveSubscription = Boolean(status?.active);
    const subscriptionId =
      (subscription?.id as string | undefined) ||
      (userRow?.subscription_id as string | undefined) ||
      null;

    if (targetPlan === "free") {
      if (!subscriptionId || !hasActiveSubscription) {
        await supabase
          .from("users")
          .update({
            plan: "free",
            scans_limit: PLAN_SCANS_LIMITS.free,
            subscription_status: "inactive",
            subscription_id: null,
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

      const patched = await patchSubscription(subscriptionId, {
        cancel_at_period_end: true,
      });

      if (!patched) {
        return NextResponse.json(
          {
            error: "Failed to cancel subscription",
            message: "Could not downgrade to free. Please try again.",
          },
          { status: 500 },
        );
      }

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
        currentPeriodEnd:
          typeof patched.current_period_end === "string"
            ? patched.current_period_end
            : null,
        message: "Your subscription will be cancelled at the end of the billing period.",
      });
    }

    const productId = PLAN_PRODUCT_IDS[targetPlan];
    if (!productId) {
      return NextResponse.json(
        {
          error: "Invalid plan configuration",
          message: `Missing Polar product id for ${targetPlan}`,
        },
        { status: 500 },
      );
    }

    if (!hasActiveSubscription || !subscriptionId || !isPaid(currentPlan)) {
      const checkoutUrl = await createCheckoutUrl({
        productId,
        userId: user.id,
        customerEmail: user.email,
        customerId: (userRow?.customer_id as string | undefined) || null,
        appUrl: req.nextUrl.origin,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
      });

      return NextResponse.json({
        success: true,
        action: "checkout",
        redirectUrl: checkoutUrl,
        message: "Redirecting to checkout...",
      });
    }

    const patched = await patchSubscription(subscriptionId, {
      product_id: productId,
    });

    if (!patched) {
      const checkoutUrl = await createCheckoutUrl({
        productId,
        userId: user.id,
        customerEmail: user.email,
        customerId: (userRow?.customer_id as string | undefined) || null,
        appUrl: req.nextUrl.origin,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
      });

      return NextResponse.json({
        success: true,
        action: "checkout",
        redirectUrl: checkoutUrl,
        message: "Redirecting to confirm plan change...",
      });
    }

    const detectedPlan = resolvePlanFromSubscription(patched);
    const nextStatus = getSubscriptionStatus(patched);
    await supabase
      .from("users")
      .update({
        plan: detectedPlan,
        scans_limit: PLAN_SCANS_LIMITS[detectedPlan],
        subscription_id:
          (patched.id as string | undefined) || subscriptionId || null,
        subscription_status: nextStatus.status,
        customer_id:
          (patched.customer_id as string | undefined) ||
          (userRow?.customer_id as string | undefined) ||
          null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      action: detectedPlan === "unlimited" ? "upgraded" : "changed",
      plan: detectedPlan,
      scansLimit: PLAN_SCANS_LIMITS[detectedPlan],
      message: `Plan changed to ${detectedPlan}.`,
    });
  } catch (error) {
    console.error("Change plan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
