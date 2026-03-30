import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  PLAN_PRODUCT_IDS,
  PLAN_SCANS_LIMITS,
  getPolarAccessToken,
  getPolarServer,
  type PlanId,
} from "@/lib/polar-adapter";
import {
  fetchBestSubscriptionForUser,
  patchSubscription,
} from "@/lib/subscription-core";
import { Polar } from "@polar-sh/sdk";

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

    const subStatus = subscription
      ? (typeof subscription.status === "string" ? subscription.status.toLowerCase() : "")
      : "";
    const hasActiveSubscription = subStatus === "active" || subStatus === "trialing";
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
      const baseUrl = req.nextUrl.origin;
      const polar = new Polar({
        accessToken: getPolarAccessToken(),
        server: getPolarServer(),
      });

      const checkout = await polar.checkouts.create({
        products: [productId],
        successUrl: `${baseUrl}/dashboard/settings?tab=billing&upgrade=success`,
        returnUrl: `${baseUrl}/dashboard/settings?tab=billing`,
        externalCustomerId: user.id,
        customerEmail: user.email || undefined,
        customerId: (userRow?.customer_id as string | undefined) || undefined,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
      });

      return NextResponse.json({
        success: true,
        action: "checkout",
        redirectUrl: checkout.url,
        message: "Redirecting to checkout...",
      });
    }

    // User has active subscription — update it via SDK instead of creating checkout
    const polar = new Polar({
      accessToken: getPolarAccessToken(),
      server: getPolarServer(),
    });

    let updatedSub;
    try {
      updatedSub = await polar.subscriptions.update({
        id: subscriptionId,
        subscriptionUpdate: {
          productId,
          prorationBehavior: "invoice",
        },
      });
    } catch {
      // Fallback to checkout if SDK update fails
      const baseUrl = req.nextUrl.origin;
      const checkout = await polar.checkouts.create({
        products: [productId],
        successUrl: `${baseUrl}/dashboard/settings?tab=billing&upgrade=success`,
        returnUrl: `${baseUrl}/dashboard/settings?tab=billing`,
        externalCustomerId: user.id,
        customerEmail: user.email || undefined,
        customerId: (userRow?.customer_id as string | undefined) || undefined,
        metadata: {
          user_id: user.id,
          plan: targetPlan,
        },
      });

      return NextResponse.json({
        success: true,
        action: "checkout",
        redirectUrl: checkout.url,
        message: "Redirecting to confirm plan change...",
      });
    }

    // Update DB
    await supabase
      .from("users")
      .update({
        plan: targetPlan,
        scans_limit: PLAN_SCANS_LIMITS[targetPlan],
        subscription_id: updatedSub.id,
        subscription_status: "active",
        customer_id:
          (userRow?.customer_id as string | undefined) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      action: targetPlan === "unlimited" ? "upgraded" : "changed",
      plan: targetPlan,
      scansLimit: PLAN_SCANS_LIMITS[targetPlan],
      message: `Plan changed to ${targetPlan}.`,
    });
  } catch (error) {
    console.error("Change plan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
