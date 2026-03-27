import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

const PLAN_PRODUCT_MAP: Record<string, string> = {};
const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
const unlimitedProductId = process.env.POLAR_UNLIMITED_PRODUCT_ID;
if (proProductId) PLAN_PRODUCT_MAP[proProductId] = "pro";
if (unlimitedProductId) PLAN_PRODUCT_MAP[unlimitedProductId] = "unlimited";

type UserRow = {
  id: string;
  email: string | null;
  plan: string | null;
  scans_limit: number | null;
  subscription_id: string | null;
  subscription_status: string | null;
  customer_id: string | null;
};

function getPlanFromSubscription(subscription: Record<string, unknown>): string | null {
  const directProductId =
    (subscription.product_id as string | undefined) ||
    ((subscription.product as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);

  if (directProductId && PLAN_PRODUCT_MAP[directProductId]) {
    return PLAN_PRODUCT_MAP[directProductId];
  }

  const items = subscription.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const itemProductId =
        (item.product_id as string | undefined) ||
        ((item.product as Record<string, unknown> | undefined)?.id as
          | string
          | undefined);

      if (itemProductId && PLAN_PRODUCT_MAP[itemProductId]) {
        return PLAN_PRODUCT_MAP[itemProductId];
      }
    }
  }

  const products = subscription.products as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(products)) {
    for (const product of products) {
      const productId =
        (product.id as string | undefined) ||
        (product.product_id as string | undefined);

      if (productId && PLAN_PRODUCT_MAP[productId]) {
        return PLAN_PRODUCT_MAP[productId];
      }
    }
  }

  return null;
}

function getNormalizedStatus(
  subscription: Record<string, unknown>,
): { status: string | null; active: boolean } {
  const rawStatus =
    typeof subscription.status === "string"
      ? subscription.status.toLowerCase()
      : "";

  const cancelAtPeriodEnd =
    subscription.cancel_at_period_end === true ||
    subscription.cancelAtPeriodEnd === true;

  if (cancelAtPeriodEnd || rawStatus === "cancelled" || rawStatus === "canceled") {
    return { status: "cancelled", active: true };
  }

  if (ACTIVE_STATUSES.has(rawStatus)) {
    return { status: "active", active: true };
  }

  return { status: rawStatus || null, active: false };
}

function getSubscriptionsFromStatePayload(
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  // Handle active_subscriptions (Polar CustomerState top-level field)
  const active = payload.active_subscriptions;
  if (Array.isArray(active) && active.length) {
    return active as Array<Record<string, unknown>>;
  }

  const direct = payload.subscriptions;
  if (Array.isArray(direct)) {
    return direct as Array<Record<string, unknown>>;
  }

  const customerState = payload.customer_state as Record<string, unknown> | undefined;
  const nested = customerState?.subscriptions;
  if (Array.isArray(nested)) {
    return nested as Array<Record<string, unknown>>;
  }

  return [];
}

function pickBestSubscription(
  subscriptions: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!subscriptions.length) return null;

  const active = subscriptions.find((sub) => {
    const status = typeof sub.status === "string" ? sub.status.toLowerCase() : "";
    return ACTIVE_STATUSES.has(status) || status === "cancelled" || status === "canceled";
  });

  if (active) return active;
  return subscriptions[0] || null;
}

export async function POST(req: NextRequest) {
  try {
    let checkoutId: string | null = null;
    const body = (await req.json().catch(() => null)) as
      | { checkoutId?: string }
      | null;
    if (typeof body?.checkoutId === "string" && body.checkoutId.trim()) {
      checkoutId = body.checkoutId.trim();
    }

    const supabase = await createServerClient();
    const adminSupabase =
      SUPABASE_URL && SUPABASE_SERVICE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        : null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select(
        "id, email, plan, scans_limit, subscription_id, subscription_status, customer_id",
      )
      .eq("id", user.id)
      .maybeSingle<UserRow>();

    if (userError) {
      console.error("sync: failed to load user row", { userId: user.id, error: userError });
    }

    // If Polar is not configured, return what we have
    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json({
        success: true,
        plan: userData?.plan || "free",
        subscriptionStatus: userData?.subscription_status,
        message: "Payment provider not configured.",
      });
    }

    let subscription: Record<string, unknown> | null = null;

    // 0) If we have a checkout ID from success redirect, resolve from checkout first
    if (checkoutId) {
      const checkoutResponse = await fetch(
        `${POLAR_API_URL}/checkouts/${encodeURIComponent(checkoutId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (checkoutResponse.ok) {
        const checkout = (await checkoutResponse.json()) as Record<string, unknown>;

        const checkoutStatus =
          typeof checkout.status === "string" ? checkout.status.toLowerCase() : "";
        const checkoutProductId =
          (checkout.product_id as string | undefined) ||
          ((checkout.product as Record<string, unknown> | undefined)?.id as
            | string
            | undefined) ||
          (((checkout.products as Array<Record<string, unknown>> | undefined)?.[0]?.id as
            | string
            | undefined) ??
            ((checkout.products as Array<Record<string, unknown>> | undefined)?.[0]
              ?.product_id as string | undefined));

        const checkoutCustomerId =
          (checkout.customer_id as string | undefined) ||
          ((checkout.customer as Record<string, unknown> | undefined)?.id as
            | string
            | undefined);
        const checkoutSubscriptionId =
          (checkout.subscription_id as string | undefined) ||
          ((checkout.subscription as Record<string, unknown> | undefined)?.id as
            | string
            | undefined);

        const completedStatuses = new Set(["succeeded", "paid", "completed", "active", "confirmed"]);
        const planFromCheckout =
          checkoutProductId && PLAN_PRODUCT_MAP[checkoutProductId]
            ? PLAN_PRODUCT_MAP[checkoutProductId]
            : null;

        if (completedStatuses.has(checkoutStatus) && planFromCheckout) {
          const updater = adminSupabase ?? supabase;
          const upsertPayload: Record<string, unknown> = {
            id: user.id,
            plan: planFromCheckout,
            scans_limit: PLAN_SCANS_LIMITS[planFromCheckout] ?? 3,
            subscription_status: "active",
            customer_id: checkoutCustomerId || userData?.customer_id,
            subscription_id: checkoutSubscriptionId || userData?.subscription_id,
            updated_at: new Date().toISOString(),
          };
          if (!userData) upsertPayload.scans_used = 0;

          const { error: checkoutUpdateError } = await updater
            .from("users")
            .upsert(upsertPayload, { onConflict: "id" });

          if (checkoutUpdateError) {
            console.error("Failed to update user from checkout sync", {
              userId: user.id,
              error: checkoutUpdateError,
            });
            return NextResponse.json(
              { message: "Failed to persist checkout subscription state." },
              { status: 500 },
            );
          }

          // If checkout already includes subscription details, we can stop here.
          if (checkoutSubscriptionId) {
            return NextResponse.json({
              success: true,
              plan: planFromCheckout,
              subscriptionStatus: "active",
              cancelAtPeriodEnd: false,
              currentPeriodEnd: null,
              message: `Synced from checkout ${checkoutId}.`,
            });
          }
        }
      }
    }

    // 1) Prefer known subscription_id
    if (userData?.subscription_id) {
      const polarResponse = await fetch(
        `${POLAR_API_URL}/subscriptions/${userData.subscription_id}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (polarResponse.ok) {
        subscription = (await polarResponse.json()) as Record<string, unknown>;
      } else {
        const errorText = await polarResponse.text();
        console.error("Failed to fetch Polar subscription by ID:", {
          status: polarResponse.status,
          details: errorText,
          subscriptionId: userData.subscription_id,
        });
      }
    }

    // 2) Fallback to customer state by external user ID
    if (!subscription) {
      const stateEndpoints = [
        `${POLAR_API_URL}/customers/external/${encodeURIComponent(user.id)}/state`,
        `${POLAR_API_URL}/customers/${encodeURIComponent(user.id)}/state`,
      ];

      for (const endpoint of stateEndpoints) {
        const stateResponse = await fetch(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        if (!stateResponse.ok) continue;

        const statePayload =
          (await stateResponse.json()) as Record<string, unknown>;
        const subscriptions = getSubscriptionsFromStatePayload(statePayload);
        const picked = pickBestSubscription(subscriptions);
        if (picked) {
          subscription = picked;
          break;
        }
      }
    }

    // 3) Fallback to subscriptions list by customer_id
    if (!subscription && userData?.customer_id) {
      const listResponse = await fetch(
        `${POLAR_API_URL}/subscriptions?customer_id=${encodeURIComponent(userData.customer_id)}&limit=20`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (listResponse.ok) {
        const listPayload = (await listResponse.json()) as Record<string, unknown>;
        const list =
          (listPayload.data as Array<Record<string, unknown>> | undefined) ||
          (listPayload.items as Array<Record<string, unknown>> | undefined) ||
          (listPayload.result as Array<Record<string, unknown>> | undefined) ||
          (listPayload.subscriptions as Array<Record<string, unknown>> | undefined) ||
          [];

        subscription = pickBestSubscription(list);
      }
    }

    if (!subscription && userData?.customer_id) {
      const stateByCustomerResponse = await fetch(
        `${POLAR_API_URL}/customers/${encodeURIComponent(userData.customer_id)}/state`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (stateByCustomerResponse.ok) {
        const statePayload =
          (await stateByCustomerResponse.json()) as Record<string, unknown>;
        const subscriptions = getSubscriptionsFromStatePayload(statePayload);
        subscription = pickBestSubscription(subscriptions);
      }
    }

    if (!subscription) {
      return NextResponse.json({
        success: true,
        plan: userData?.plan || "free",
        subscriptionStatus: userData?.subscription_status,
        message: "No subscription found on Polar. Kept current plan.",
      });
    }

    const { status: effectiveStatus, active: isActive } =
      getNormalizedStatus(subscription);

    const detectedPlan = getPlanFromSubscription(subscription);
    const effectivePlan = isActive
      ? detectedPlan || (userData?.plan && userData.plan !== "free" ? userData.plan : "pro")
      : "free";
    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;

    const resolvedSubscriptionId =
      (subscription.id as string | undefined) || userData?.subscription_id;
    const resolvedCustomerId =
      (subscription.customer_id as string | undefined) || userData?.customer_id;
    const cancelAtPeriodEnd =
      subscription.cancel_at_period_end === true ||
      subscription.cancelAtPeriodEnd === true;

    // Upsert DB — works even when the users row doesn't yet exist
    const updater = adminSupabase ?? supabase;
    const finalUpsertPayload: Record<string, unknown> = {
      id: user.id,
      plan: effectivePlan,
      scans_limit: scansLimit,
      subscription_id: resolvedSubscriptionId || null,
      subscription_status: effectiveStatus,
      customer_id: resolvedCustomerId || null,
      updated_at: new Date().toISOString(),
    };
    if (!userData) finalUpsertPayload.scans_used = 0;

    const { error: finalUpdateError } = await updater
      .from("users")
      .upsert(finalUpsertPayload, { onConflict: "id" });

    if (finalUpdateError) {
      console.error("Failed to persist subscription sync", {
        userId: user.id,
        error: finalUpdateError,
        effectivePlan,
        effectiveStatus,
        resolvedSubscriptionId,
        resolvedCustomerId,
      });
      return NextResponse.json(
        { message: "Failed to persist subscription state." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      plan: effectivePlan,
      subscriptionStatus: effectiveStatus,
      cancelAtPeriodEnd,
      currentPeriodEnd: subscription.current_period_end || null,
      message: `Synced to ${effectivePlan} plan.`,
    });
  } catch (error) {
    console.error("Subscription sync error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
