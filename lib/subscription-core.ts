import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_SCANS_LIMITS,
  getPlanFromProductIds,
  getPolarAccessToken,
  isPolarConfigured,
  pickBestSubscription,
  getSubscriptionStatus,
  type PlanId,
} from "@/lib/polar-adapter";

const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";
const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export type UserBillingRow = {
  id: string;
  email: string | null;
  plan: PlanId | null;
  scans_limit: number | null;
  subscription_id: string | null;
  subscription_status: string | null;
  customer_id: string | null;
};

export function planScansLimit(plan: PlanId): number {
  return PLAN_SCANS_LIMITS[plan];
}

export function createAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function extractProductIds(subscription: Record<string, unknown>): string[] {
  const ids: string[] = [];

  const topLevelProduct = subscription.product as Record<string, unknown> | undefined;
  const topProductId =
    (subscription.product_id as string | undefined) ||
    (topLevelProduct?.id as string | undefined);
  if (topProductId) ids.push(topProductId);

  const items = subscription.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const product = item.product as Record<string, unknown> | undefined;
      const id =
        (item.product_id as string | undefined) || (product?.id as string | undefined);
      if (id) ids.push(id);
    }
  }

  const products = subscription.products as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(products)) {
    for (const product of products) {
      const id =
        (product.id as string | undefined) ||
        (product.product_id as string | undefined);
      if (id) ids.push(id);
    }
  }

  return ids;
}

export function resolvePlanFromSubscription(subscription: Record<string, unknown>): PlanId {
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  const metadataPlan =
    typeof metadata?.plan === "string" ? metadata.plan.toLowerCase() : null;
  if (metadataPlan === "pro" || metadataPlan === "unlimited") {
    return metadataPlan;
  }

  const planFromProducts = getPlanFromProductIds(extractProductIds(subscription));
  if (planFromProducts) return planFromProducts;

  const status = getSubscriptionStatus(subscription);
  if (status.active) return "pro";
  return "free";
}

async function polarFetch(path: string): Promise<Response> {
  return fetch(`${POLAR_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${getPolarAccessToken()}`,
      "Content-Type": "application/json",
    },
  });
}

export async function fetchBestSubscriptionForUser(params: {
  userId: string;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<Record<string, unknown> | null> {
  if (!isPolarConfigured()) return null;

  if (params.subscriptionId) {
    const response = await polarFetch(
      `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
    );
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }
  }

  if (params.customerId) {
    const response = await polarFetch(
      `/customers/${encodeURIComponent(params.customerId)}/state`,
    );
    if (response.ok) {
      const state = (await response.json()) as Record<string, unknown>;
      const subs =
        ((state.active_subscriptions as Array<Record<string, unknown>> | undefined) ||
          (state.subscriptions as Array<Record<string, unknown>> | undefined) ||
          ((state.customer_state as Record<string, unknown> | undefined)
            ?.subscriptions as Array<Record<string, unknown>> | undefined) ||
          []) as Array<Record<string, unknown>>;
      return pickBestSubscription(subs);
    }
  }

  const externalState = await polarFetch(
    `/customers/external/${encodeURIComponent(params.userId)}/state`,
  );
  if (!externalState.ok) return null;

  const payload = (await externalState.json()) as Record<string, unknown>;
  const subscriptions =
    ((payload.active_subscriptions as Array<Record<string, unknown>> | undefined) ||
      (payload.subscriptions as Array<Record<string, unknown>> | undefined) ||
      ((payload.customer_state as Record<string, unknown> | undefined)
        ?.subscriptions as Array<Record<string, unknown>> | undefined) ||
      []) as Array<Record<string, unknown>>;
  return pickBestSubscription(subscriptions);
}

export async function persistSubscriptionState(params: {
  admin: SupabaseClient;
  userId: string;
  email: string | null;
  subscription: Record<string, unknown> | null;
  fallback?: Partial<UserBillingRow>;
}): Promise<{ plan: PlanId; subscriptionStatus: string }> {
  if (!params.subscription) {
    const plan: PlanId = "free";
    const subscriptionStatus = "inactive";
    const payload: Record<string, unknown> = {
      id: params.userId,
      email: params.email,
      plan,
      scans_limit: PLAN_SCANS_LIMITS[plan],
      subscription_id: null,
      subscription_status: subscriptionStatus,
      customer_id: null,
      updated_at: new Date().toISOString(),
    };
    if (!params.fallback) payload.scans_used = 0;
    await params.admin.from("users").upsert(payload, { onConflict: "id" });
    return { plan, subscriptionStatus };
  }

  const status = getSubscriptionStatus(params.subscription);
  const plan = resolvePlanFromSubscription(params.subscription);
  const customer = params.subscription.customer as Record<string, unknown> | undefined;
  const customerId =
    (params.subscription.customer_id as string | undefined) ||
    (customer?.id as string | undefined) ||
    params.fallback?.customer_id ||
    null;

  const payload: Record<string, unknown> = {
    id: params.userId,
    email: params.email,
    plan,
    scans_limit: PLAN_SCANS_LIMITS[plan],
    subscription_id:
      (params.subscription.id as string | undefined) || params.fallback?.subscription_id || null,
    subscription_status: status.status,
    customer_id: customerId,
    updated_at: new Date().toISOString(),
  };
  if (!params.fallback) payload.scans_used = 0;

  await params.admin.from("users").upsert(payload, { onConflict: "id" });

  return { plan, subscriptionStatus: status.status };
}

export async function fetchSubscriptionById(subscriptionId: string) {
  if (!isPolarConfigured()) return null;
  const response = await polarFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export async function patchSubscription(
  subscriptionId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!isPolarConfigured()) return null;

  // Polar requires proration_behavior when changing product_id.
  // "invoice" = immediately charge the prorated difference.
  const payload = { ...body };
  if ("product_id" in payload && !("proration_behavior" in payload)) {
    payload.proration_behavior = "invoice";
  }

  const response = await fetch(
    `${POLAR_API_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${getPolarAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(
      `Polar PATCH /subscriptions/${subscriptionId} failed (${response.status}):`,
      errorBody,
    );
    return null;
  }
  return (await response.json()) as Record<string, unknown>;
}
