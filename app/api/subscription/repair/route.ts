import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

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

const PLAN_SCANS_LIMITS: Record<string, number> = { free: 3, pro: 50, unlimited: 999999 };

export async function POST() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === "your_polar_access_token_here") {
      return NextResponse.json({ error: "Polar not configured" }, { status: 500 });
    }

    // Search Polar for any subscription linked to this user's ID as external customer ID
    const stateResp = await fetch(
      `${POLAR_API_URL}/customers/external/${encodeURIComponent(user.id)}/state`,
      { headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );

    if (!stateResp.ok) {
      // Also try searching by email
      const emailSearchResp = await fetch(
        `${POLAR_API_URL}/subscriptions?email=${encodeURIComponent(user.email ?? "")}&limit=10`,
        { headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
      );

      if (!emailSearchResp.ok) {
        return NextResponse.json({
          error: "No subscription found on Polar",
          message: "Could not find any subscription associated with your account on Polar.",
          polar_status: stateResp.status,
        }, { status: 404 });
      }

      const emailData = await emailSearchResp.json() as Record<string, unknown>;
      const subs = (emailData.items ?? emailData.data ?? []) as Array<Record<string, unknown>>;
      const activeSub = subs.find(s => {
        const st = typeof s.status === "string" ? s.status.toLowerCase() : "";
        return st === "active" || st === "trialing";
      });

      if (!activeSub) {
        return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
      }

      return await applySubscription(user.id, activeSub, supabase);
    }

    const stateData = await stateResp.json() as Record<string, unknown>;
    const subscriptions = (
      (stateData.active_subscriptions as Array<Record<string, unknown>> | undefined) ??
      (stateData.subscriptions as Array<Record<string, unknown>> | undefined) ??
      []
    );

    const activeSub = subscriptions.find(s => {
      const st = typeof s.status === "string" ? s.status.toLowerCase() : "";
      return st === "active" || st === "trialing";
    }) ?? subscriptions[0];

    if (!activeSub) {
      return NextResponse.json({ error: "No active subscription found on Polar" }, { status: 404 });
    }

    return await applySubscription(user.id, activeSub, supabase);
  } catch (error) {
    console.error("Repair error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function applySubscription(
  userId: string,
  subscription: Record<string, unknown>,
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase-server").createServerClient>>
) {
  const productId =
    (subscription.product_id as string | undefined) ||
    ((subscription.product as Record<string, unknown> | undefined)?.id as string | undefined);

  const metaPlan = (subscription.metadata as Record<string, unknown> | undefined)?.plan;
  let plan: string = "pro";

  if (typeof metaPlan === "string" && (metaPlan === "pro" || metaPlan === "unlimited")) {
    plan = metaPlan;
  } else if (productId && PLAN_PRODUCT_MAP[productId]) {
    plan = PLAN_PRODUCT_MAP[productId];
  }

  const scansLimit = PLAN_SCANS_LIMITS[plan] ?? 50;
  const subscriptionId = subscription.id as string | undefined;
  const customerId = (subscription.customer_id as string | undefined) ||
    ((subscription.customer as Record<string, unknown> | undefined)?.id as string | undefined);

  const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : supabase;

  await adminSupabase.from("users").upsert({
    id: userId,
    plan,
    scans_limit: scansLimit,
    subscription_id: subscriptionId || null,
    subscription_status: "active",
    customer_id: customerId || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  return NextResponse.json({
    success: true,
    plan,
    scansLimit,
    subscriptionId,
    customerId,
    message: `Successfully repaired. Your plan is now ${plan}.`,
  });
}
