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
  // 1) Check metadata first (most reliable)
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  if (metadata?.plan && typeof metadata.plan === "string") {
    const metaPlan = metadata.plan.toLowerCase();
    if (metaPlan === "pro" || metaPlan === "unlimited") return metaPlan;
  }

  // 2) Check product_id against known product IDs
  const productId =
    (subscription.product_id as string | undefined) ||
    ((subscription.product as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);

  if (productId && PLAN_PRODUCT_MAP[productId]) {
    return PLAN_PRODUCT_MAP[productId];
  }

  // 3) Check items for product_id
  const items = subscription.items as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      // Check item metadata
      const itemMeta = item.metadata as Record<string, unknown> | undefined;
      if (itemMeta?.plan && typeof itemMeta.plan === "string") {
        const metaPlan = itemMeta.plan.toLowerCase();
        if (metaPlan === "pro" || metaPlan === "unlimited") return metaPlan;
      }
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
          (payload.active_subscriptions as
            | Array<Record<string, unknown>>
            | undefined) ||
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
        (payload.active_subscriptions as
          | Array<Record<string, unknown>>
          | undefined) ||
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

function buildResponse(
  plan: string,
  scansLimit: number,
  subscriptionStatus: string | null,
  subscriptionId: string | null,
  customerId: string | null,
  cancellationScheduled: boolean,
  currentPeriodEnd: string | null,
) {
  return NextResponse.json({
    success: true,
    plan,
    scansLimit,
    subscriptionStatus,
    subscriptionId,
    customerId,
    cancellationScheduled,
    currentPeriodEnd,
  });
}

export async function GET() {
  try {
    console.log("Subscription status API called");

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Try to get authenticated user from Supabase
    let userId: string | null = null;
    let supabase: Awaited<ReturnType<typeof createServerClient>> | null = null;
    let userData: Record<string, unknown> | null = null;

    if (supabaseUrl && supabaseAnonKey) {
      try {
        supabase = await createServerClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          userId = user.id;

          // Try to load user from DB
          const { data: dbData, error: dbError } = await supabase
            .from("users")
            .select(
              "plan, scans_limit, subscription_id, subscription_status, customer_id",
            )
            .eq("id", user.id)
            .single();

          if (dbError) {
            console.error("Users table query failed:", dbError.message);
          } else if (dbData) {
            userData = dbData as Record<string, unknown>;
          }
        }
      } catch (e) {
        console.error("Supabase auth failed:", e);
      }
    }

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const dbPlan = (userData?.plan as string) || null;
    const dbScansLimit = (userData?.scans_limit as number) ?? 3;
    const dbSubscriptionId = (userData?.subscription_id as string) || null;
    const dbCustomerId = (userData?.customer_id as string) || null;
    const dbSubscriptionStatus =
      (userData?.subscription_status as string) || null;

    // Polar not configured — return whatever is in DB
    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return buildResponse(
        dbPlan || "free",
        dbScansLimit,
        dbSubscriptionStatus,
        dbSubscriptionId,
        dbCustomerId,
        dbSubscriptionStatus === "cancelled" ||
          dbSubscriptionStatus === "canceled",
        null,
      );
    }

    // Fetch subscription from Polar
    const subscription = await fetchSubscriptionFromPolar(
      userId,
      dbSubscriptionId,
      dbCustomerId,
    );

    if (!subscription) {
      console.log("No subscription found on Polar for user:", userId);
      return buildResponse(
        dbPlan || "free",
        dbScansLimit,
        dbSubscriptionStatus,
        dbSubscriptionId,
        dbCustomerId,
        false,
        null,
      );
    }

    // Determine plan from subscription
    const detectedPlan = getPlanFromSubscription(subscription);
    const polarProductId =
      subscription.product_id ||
      (subscription.product as Record<string, unknown>)?.id ||
      null;
    const rawStatus =
      typeof subscription.status === "string"
        ? subscription.status.toLowerCase()
        : "";
    const isActive = rawStatus === "active" || rawStatus === "trialing";

    console.log(
      "Polar sub found - product_id:",
      polarProductId,
      "status:",
      rawStatus,
      "detected_plan:",
      detectedPlan,
      "known_ids:",
      JSON.stringify(PLAN_PRODUCT_MAP),
    );

    const effectivePlan = isActive
      ? detectedPlan || (dbPlan && dbPlan !== "free" ? dbPlan : "pro")
      : "free";

    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;
    const cancellationScheduled = getCancellationScheduled(subscription);
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
    if (supabase && userData) {
      const hasChanges =
        effectivePlan !== dbPlan ||
        scansLimit !== dbScansLimit ||
        effectiveStatus !== dbSubscriptionStatus ||
        resolvedSubscriptionId !== dbSubscriptionId ||
        resolvedCustomerId !== dbCustomerId;

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
          .eq("id", userId);
      }
    }

    return buildResponse(
      effectivePlan,
      scansLimit,
      effectiveStatus,
      resolvedSubscriptionId,
      resolvedCustomerId,
      cancellationScheduled,
      typeof subscription.current_period_end === "string"
        ? subscription.current_period_end
        : null,
    );
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
