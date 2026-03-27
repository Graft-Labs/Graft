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

async function fetchSubscriptionFromPolar(
  userId: string,
  dbSubscriptionId: string | null,
  dbCustomerId: string | null,
): Promise<Record<string, unknown> | null> {
  if (
    !POLAR_ACCESS_TOKEN ||
    POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
  ) {
    return null;
  }

  // 1) Try by subscription_id
  if (dbSubscriptionId) {
    try {
      const resp = await fetch(
        `${POLAR_API_URL}/subscriptions/${dbSubscriptionId}`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (resp.ok) {
        return (await resp.json()) as Record<string, unknown>;
      }
    } catch {}
  }

  // 2) Fallback by customer_id
  if (dbCustomerId) {
    try {
      const resp = await fetch(
        `${POLAR_API_URL}/customers/${encodeURIComponent(dbCustomerId)}/state`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (resp.ok) {
        const payload = (await resp.json()) as Record<string, unknown>;
        const subs =
          (payload.subscriptions as
            | Array<Record<string, unknown>>
            | undefined) ||
          ((
            payload.customer_state as Record<string, unknown> | undefined
          )?.subscriptions as
            | Array<Record<string, unknown>>
            | undefined) ||
          [];
        if (subs.length) {
          return (
            subs.find((s) => {
              const st =
                typeof s.status === "string" ? s.status.toLowerCase() : "";
              return (
                st === "active" ||
                st === "trialing" ||
                st === "cancelled" ||
                st === "canceled"
              );
            }) || subs[0]
          );
        }
      }
    } catch {}
  }

  // 3) Fallback by external user ID
  try {
    const resp = await fetch(
      `${POLAR_API_URL}/customers/external/${encodeURIComponent(userId)}/state`,
      {
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (resp.ok) {
      const payload = (await resp.json()) as Record<string, unknown>;
      const subs =
        (payload.subscriptions as
          | Array<Record<string, unknown>>
          | undefined) ||
        ((
          payload.customer_state as Record<string, unknown> | undefined
        )?.subscriptions as
          | Array<Record<string, unknown>>
          | undefined) ||
        [];
      if (subs.length) {
        return (
          subs.find((s) => {
            const st =
              typeof s.status === "string" ? s.status.toLowerCase() : "";
            return (
              st === "active" ||
              st === "trialing" ||
              st === "cancelled" ||
              st === "canceled"
            );
          }) || subs[0]
        );
      }
    }
  } catch {}

  return null;
}

export async function GET() {
  try {
    console.log("Subscription status API called");

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Try to load user from DB, but don't fail if it errors
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select(
        "plan, scans_limit, subscription_id, subscription_status, customer_id",
      )
      .eq("id", user.id)
      .single();

    if (userError) {
      console.error("Users table query failed:", userError.message);
    }

    const dbPlan = userData?.plan || null;
    const dbScansLimit = userData?.scans_limit ?? 3;
    const dbSubscriptionId = userData?.subscription_id || null;
    const dbCustomerId = userData?.customer_id || null;
    const dbSubscriptionStatus = userData?.subscription_status || null;

    // Polar not configured — return whatever is in DB
    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json({
        success: true,
        plan: dbPlan || "free",
        scansLimit: dbScansLimit,
        subscriptionStatus: dbSubscriptionStatus,
        subscriptionId: dbSubscriptionId,
        customerId: dbCustomerId,
        cancellationScheduled:
          dbSubscriptionStatus === "cancelled" ||
          dbSubscriptionStatus === "canceled",
        currentPeriodEnd: null,
      });
    }

    // Fetch subscription from Polar
    const subscription = await fetchSubscriptionFromPolar(
      user.id,
      dbSubscriptionId,
      dbCustomerId,
    );

    if (!subscription) {
      return NextResponse.json({
        success: true,
        plan: dbPlan || "free",
        scansLimit: dbScansLimit,
        subscriptionStatus: dbSubscriptionStatus,
        subscriptionId: dbSubscriptionId,
        customerId: dbCustomerId,
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
    const isActive = rawStatus === "active" || rawStatus === "trialing";

    const effectivePlan = isActive
      ? detectedPlan || (dbPlan && dbPlan !== "free" ? dbPlan : "pro")
      : "free";

    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;

    const effectiveStatus = cancellationScheduled
      ? "cancelled"
      : isActive
        ? "active"
        : rawStatus;

    const resolvedSubscriptionId =
      (subscription.id as string | undefined) || dbSubscriptionId;
    const resolvedCustomerId =
      (subscription.customer_id as string | undefined) || dbCustomerId;

    // Persist if anything changed
    if (userData) {
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
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Subscription status API error:", errorMessage);
    return NextResponse.json(
      { message: "Internal server error", error: errorMessage },
      { status: 500 },
    );
  }
}
