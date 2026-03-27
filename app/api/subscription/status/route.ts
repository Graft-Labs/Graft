import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
};

const PLAN_PRODUCT_MAP: Record<string, string> = {};
const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
const unlimitedProductId = process.env.POLAR_UNLIMITED_PRODUCT_ID;
if (proProductId) PLAN_PRODUCT_MAP[proProductId] = "pro";
if (unlimitedProductId) PLAN_PRODUCT_MAP[unlimitedProductId] = "unlimited";

function getPlanFromSubscription(
  subscription: Record<string, unknown>,
): string | null {
  const productId =
    (subscription.product_id as string | undefined) ||
    ((subscription.product as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);

  if (productId && PLAN_PRODUCT_MAP[productId]) {
    return PLAN_PRODUCT_MAP[productId];
  }

  const items = subscription.items as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const id =
        (item.product_id as string | undefined) ||
        ((item.product as Record<string, unknown> | undefined)?.id as
          | string
          | undefined);
      if (id && PLAN_PRODUCT_MAP[id]) return PLAN_PRODUCT_MAP[id];
    }
  }

  return null;
}

function getCancellationScheduled(
  subscription: Record<string, unknown>,
): boolean {
  if (subscription.cancel_at_period_end === true) return true;
  if (subscription.cancelAtPeriodEnd === true) return true;

  const status =
    typeof subscription.status === "string"
      ? subscription.status.toLowerCase()
      : "";

  return status === "cancelled" || status === "canceled";
}

export async function GET() {
  const debugSteps: string[] = [];
  try {
    debugSteps.push("1: entered handler");
    console.log("Subscription status API called");
    let supabase;
    try {
      supabase = await createServerClient();
      debugSteps.push("2: createServerClient OK");
      console.log("Supabase client created");
    } catch (e: unknown) {
      debugSteps.push("2: createServerClient FAILED: " + (e instanceof Error ? e.message : String(e)));
      console.error("CRITICAL: createServerClient() failed:", e);
      return NextResponse.json({ message: "createServerClient failed", debug: debugSteps, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    
    let authResult;
    try {
      authResult = await supabase.auth.getUser();
      debugSteps.push("3: auth.getUser OK, user=" + (authResult.data.user ? "yes" : "no"));
      console.log("User auth check:", authResult.data.user ? "authenticated" : "not authenticated");
    } catch (e: unknown) {
      debugSteps.push("3: auth.getUser FAILED: " + (e instanceof Error ? e.message : String(e)));
      return NextResponse.json({ message: "auth.getUser failed", debug: debugSteps, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    const { data: { user } } = authResult;

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    console.log("Querying users table for:", user.id);
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select(
        "plan, scans_limit, subscription_id, subscription_status, customer_id",
      )
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      console.error("Users table query error:", userError, userData);
      return NextResponse.json(
        { message: "Could not load subscription status." },
        { status: 500 },
      );
    }

    console.log("User data loaded:", JSON.stringify(userData));

    // Polar not configured — return whatever is in DB
    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json({
        success: true,
        plan: userData.plan || "free",
        scansLimit: userData.scans_limit ?? 3,
        subscriptionStatus: userData.subscription_status,
        subscriptionId: userData.subscription_id,
        customerId: userData.customer_id,
        cancellationScheduled:
          userData.subscription_status === "cancelled" ||
          userData.subscription_status === "canceled",
        currentPeriodEnd: null,
      });
    }

    let subscription: Record<string, unknown> | null = null;

    // 1) Try by subscription_id
    if (userData.subscription_id) {
      const resp = await fetch(
        `${POLAR_API_URL}/subscriptions/${userData.subscription_id}`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (resp.ok) {
        subscription = (await resp.json()) as Record<string, unknown>;
      }
    }

    // 2) Fallback by customer_id
    if (!subscription && userData.customer_id) {
      const resp = await fetch(
        `${POLAR_API_URL}/customers/${encodeURIComponent(userData.customer_id)}/state`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (resp.ok) {
        const payload =
          (await resp.json()) as Record<string, unknown>;
        const subs =
          (payload.subscriptions as Array<Record<string, unknown>> | undefined) ||
          ((payload.customer_state as Record<string, unknown> | undefined)
            ?.subscriptions as Array<Record<string, unknown>> | undefined) ||
          [];
        if (subs.length) {
          // Pick first active/trialing/cancelled sub
          subscription =
            subs.find((s) => {
              const st =
                typeof s.status === "string" ? s.status.toLowerCase() : "";
              return (
                st === "active" ||
                st === "trialing" ||
                st === "cancelled" ||
                st === "canceled"
              );
            }) || subs[0];
        }
      }
    }

    // 3) Fallback by external user ID
    if (!subscription) {
      const resp = await fetch(
        `${POLAR_API_URL}/customers/external/${encodeURIComponent(user.id)}/state`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (resp.ok) {
        const payload =
          (await resp.json()) as Record<string, unknown>;
        const subs =
          (payload.subscriptions as Array<Record<string, unknown>> | undefined) ||
          ((payload.customer_state as Record<string, unknown> | undefined)
            ?.subscriptions as Array<Record<string, unknown>> | undefined) ||
          [];
        if (subs.length) {
          subscription =
            subs.find((s) => {
              const st =
                typeof s.status === "string" ? s.status.toLowerCase() : "";
              return (
                st === "active" ||
                st === "trialing" ||
                st === "cancelled" ||
                st === "canceled"
              );
            }) || subs[0];
        }
      }
    }

    // No subscription found on Polar — return current DB state
    if (!subscription) {
      return NextResponse.json({
        success: true,
        plan: userData.plan || "free",
        scansLimit: userData.scans_limit ?? 3,
        subscriptionStatus: userData.subscription_status,
        subscriptionId: userData.subscription_id,
        customerId: userData.customer_id,
        cancellationScheduled: false,
        currentPeriodEnd: null,
      });
    }

    // Determine plan from subscription
    const detectedPlan = getPlanFromSubscription(subscription);
    const cancellationScheduled = getCancellationScheduled(subscription);
    const rawStatus =
      typeof subscription.status === "string"
        ? subscription.status.toLowerCase()
        : "";
    const isActive =
      rawStatus === "active" || rawStatus === "trialing";

    const effectivePlan = isActive
      ? detectedPlan ||
        (userData.plan && userData.plan !== "free"
          ? userData.plan
          : "pro")
      : "free";

    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;

    const effectiveStatus = cancellationScheduled
      ? "cancelled"
      : isActive
        ? "active"
        : rawStatus;

    const resolvedSubscriptionId =
      (subscription.id as string | undefined) || userData.subscription_id;
    const resolvedCustomerId =
      (subscription.customer_id as string | undefined) ||
      userData.customer_id;

    // Persist if anything changed
    const hasChanges =
      effectivePlan !== userData.plan ||
      scansLimit !== userData.scans_limit ||
      effectiveStatus !== userData.subscription_status ||
      resolvedSubscriptionId !== userData.subscription_id ||
      resolvedCustomerId !== userData.customer_id;

    if (hasChanges) {
      await supabase
        .from("users")
        .update({
          plan: effectivePlan,
          scans_limit: scansLimit,
          subscription_status: effectiveStatus,
          subscription_id: resolvedSubscriptionId || null,
          customer_id: resolvedCustomerId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }

    return NextResponse.json({
      success: true,
      plan: effectivePlan,
      scansLimit,
      subscriptionStatus: effectiveStatus,
      subscriptionId: resolvedSubscriptionId,
      customerId: resolvedCustomerId,
      cancellationScheduled,
      currentPeriodEnd:
        typeof subscription.current_period_end === "string"
          ? subscription.current_period_end
          : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Subscription status API error:", errorMessage, errorStack);
    return NextResponse.json(
      { message: "Internal server error", error: errorMessage, stack: errorStack, debug: debugSteps },
      { status: 500 },
    );
  }
}
