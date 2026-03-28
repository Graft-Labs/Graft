import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import {
  PLAN_SCANS_LIMITS,
  getPlanFromSubscription as _getPlanFromSubscription,
  getCancellationScheduled,
  getSubscriptionsFromStatePayload,
  pickBestSubscription,
} from "@/lib/subscription-utils";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLAN_PRODUCT_MAP: Record<string, string> = {};
const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
const unlimitedProductId = process.env.POLAR_UNLIMITED_PRODUCT_ID;
if (proProductId) PLAN_PRODUCT_MAP[proProductId] = "pro";
if (unlimitedProductId) PLAN_PRODUCT_MAP[unlimitedProductId] = "unlimited";

function getPlanFromSubscription(
  subscription: Record<string, unknown>,
): string | null {
  return _getPlanFromSubscription(subscription, PLAN_PRODUCT_MAP);
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
        const subs = getSubscriptionsFromStatePayload(payload);
        const picked = pickBestSubscription(subs);
        if (picked) return picked;
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
      const subs = getSubscriptionsFromStatePayload(payload);
      const picked = pickBestSubscription(subs);
      if (picked) return picked;
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
            .maybeSingle();

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
    const dbSubscriptionStatus = (userData?.subscription_status as string) || null;

    // TRUST THE DB FIRST — the webhook writes the ground truth.
    // If DB already has a paid plan, return it immediately without calling Polar.
    // This prevents env var misconfiguration from overriding a correctly webhook-set plan.
    if (dbPlan && dbPlan !== "free") {
      return buildResponse(
        dbPlan,
        dbScansLimit,
        dbSubscriptionStatus,
        dbSubscriptionId,
        dbCustomerId,
        dbSubscriptionStatus === "cancelled" || dbSubscriptionStatus === "canceled",
        null,
      );
    }

    // DB says free. Only call Polar if we have a token configured.
    if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === "your_polar_access_token_here") {
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

    // DB says free but Polar might know better (webhook may have failed).
    // Try to find subscription on Polar using external customer ID (user.id).
    const subscription = await fetchSubscriptionFromPolar(
      userId,
      dbSubscriptionId,
      dbCustomerId,
    );

    if (!subscription) {
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

    const detectedPlan = getPlanFromSubscription(subscription);
    const rawStatus = typeof subscription.status === "string"
      ? subscription.status.toLowerCase()
      : "";
    const isActive = rawStatus === "active" || rawStatus === "trialing";

    // If Polar found an active subscription but plan detection failed,
    // it means POLAR_PRO_PRODUCT_ID / POLAR_UNLIMITED_PRODUCT_ID env vars
    // are not set. Fall back to whatever DB says rather than incorrectly downgrading.
    const effectivePlan = isActive
      ? detectedPlan || (dbPlan && dbPlan !== "free" ? dbPlan : "pro")
      : "free";

    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;
    const cancellationScheduled = getCancellationScheduled(subscription);
    const effectiveStatus = cancellationScheduled ? "cancelled" : isActive ? "active" : rawStatus;
    const resolvedSubscriptionId = (subscription.id as string | undefined) || dbSubscriptionId;
    const resolvedCustomerId = (subscription.customer_id as string | undefined) || dbCustomerId;

    // Polar found a paid plan the webhook missed — write it to DB now.
    if (effectivePlan !== "free" && supabase && userId) {
      const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        : supabase;

      const persistPayload: Record<string, unknown> = {
        id: userId,
        plan: effectivePlan,
        scans_limit: scansLimit,
        subscription_status: effectiveStatus,
        subscription_id: resolvedSubscriptionId || null,
        customer_id: resolvedCustomerId || null,
        updated_at: new Date().toISOString(),
      };
      if (!userData) persistPayload.scans_used = 0;

      await adminSupabase.from("users").upsert(persistPayload, { onConflict: "id" });
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
