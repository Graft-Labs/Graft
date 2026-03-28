import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import {
  PLAN_SCANS_LIMITS,
  getPlanFromSubscription as _getPlanFromSubscription,
  getNormalizedStatus,
  getSubscriptionsFromStatePayload,
  pickBestSubscription,
} from "@/lib/subscription-utils";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";
const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLAN_PRODUCT_MAP: Record<string, string> = {};
if (process.env.POLAR_PRO_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_PRO_PRODUCT_ID] = "pro";
if (process.env.POLAR_UNLIMITED_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_UNLIMITED_PRODUCT_ID] = "unlimited";

function getPlanFromSubscription(subscription: Record<string, unknown>): string | null {
  return _getPlanFromSubscription(subscription, PLAN_PRODUCT_MAP);
}

export async function POST() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === "your_polar_access_token_here") {
      return NextResponse.json({ error: "Polar not configured" }, { status: 500 });
    }

    // Load existing DB state for customer_id / subscription_id lookups
    const { data: userData } = await supabase
      .from("users")
      .select("id, email, plan, subscription_id, subscription_status, customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let subscription: Record<string, unknown> | null = null;

    // 1) Try by subscription_id (most reliable)
    if (userData?.subscription_id) {
      try {
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
      } catch {}
    }

    // 2) Try customer state by external user ID
    if (!subscription) {
      try {
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
          const stateData = (await stateResp.json()) as Record<string, unknown>;
          const subs = getSubscriptionsFromStatePayload(stateData);
          subscription = pickBestSubscription(subs);
        }
      } catch {}
    }

    // 3) Try customer state by customer_id
    if (!subscription && userData?.customer_id) {
      try {
        const stateResp = await fetch(
          `${POLAR_API_URL}/customers/${encodeURIComponent(userData.customer_id)}/state`,
          {
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (stateResp.ok) {
          const stateData = (await stateResp.json()) as Record<string, unknown>;
          const subs = getSubscriptionsFromStatePayload(stateData);
          subscription = pickBestSubscription(subs);
        }
      } catch {}
    }

    // 4) Try subscriptions list by customer_id
    if (!subscription && userData?.customer_id) {
      try {
        const listResp = await fetch(
          `${POLAR_API_URL}/subscriptions?customer_id=${encodeURIComponent(userData.customer_id)}&limit=20`,
          {
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (listResp.ok) {
          const listPayload = (await listResp.json()) as Record<string, unknown>;
          const list =
            (listPayload.data as Array<Record<string, unknown>> | undefined) ||
            (listPayload.items as Array<Record<string, unknown>> | undefined) ||
            [];
          subscription = pickBestSubscription(list);
        }
      } catch {}
    }

    // 5) Try searching by email
    if (!subscription && user.email) {
      try {
        const emailResp = await fetch(
          `${POLAR_API_URL}/subscriptions?email=${encodeURIComponent(user.email)}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (emailResp.ok) {
          const emailData = (await emailResp.json()) as Record<string, unknown>;
          const subs =
            (emailData.items as Array<Record<string, unknown>> | undefined) ||
            (emailData.data as Array<Record<string, unknown>> | undefined) ||
            [];
          subscription = pickBestSubscription(subs);
        }
      } catch {}
    }

    if (!subscription) {
      return NextResponse.json(
        {
          error: "No subscription found",
          message: "Could not find any subscription associated with your account on Polar.",
        },
        { status: 404 },
      );
    }

    return await applySubscription(user.id, subscription);
  } catch (error) {
    console.error("Repair error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function applySubscription(
  userId: string,
  subscription: Record<string, unknown>,
) {
  const { status: effectiveStatus, active: isActive } = getNormalizedStatus(subscription);

  const detectedPlan = getPlanFromSubscription(subscription);
  const plan = isActive
    ? detectedPlan || "pro"
    : "free";

  const scansLimit = PLAN_SCANS_LIMITS[plan] ?? 3;
  const subscriptionId = (subscription.id as string | undefined) || null;
  const customerId =
    (subscription.customer_id as string | undefined) ||
    ((subscription.customer as Record<string, unknown> | undefined)?.id as string | undefined) ||
    null;

  const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

  if (!adminSupabase) {
    console.error("Repair: admin client not configured, cannot update DB");
    return NextResponse.json(
      { error: "Server misconfiguration", message: "Admin client not available." },
      { status: 500 },
    );
  }

  const { error: upsertError } = await adminSupabase.from("users").upsert(
    {
      id: userId,
      plan,
      scans_limit: scansLimit,
      subscription_id: subscriptionId,
      subscription_status: effectiveStatus || "active",
      customer_id: customerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (upsertError) {
    console.error("Repair: failed to upsert user plan", {
      userId,
      plan,
      error: upsertError.message,
    });
    return NextResponse.json(
      {
        error: "database_error",
        message: "Found your subscription on Polar but failed to save it. Please try again.",
        details: upsertError.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    plan,
    scansLimit,
    subscriptionId,
    customerId,
    message: `Successfully repaired. Your plan is now ${plan}.`,
  });
}
