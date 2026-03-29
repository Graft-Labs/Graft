import { Checkout, CustomerPortal } from "@polar-sh/supabase";

export type PlanId = "free" | "pro" | "unlimited";

export const PLAN_SCANS_LIMITS: Record<PlanId, number> = {
  free: 3,
  pro: 50,
  unlimited: 999999,
};

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

export const PLAN_PRODUCT_IDS: Record<Exclude<PlanId, "free">, string> = {
  pro: process.env.POLAR_PRO_PRODUCT_ID || "",
  unlimited: process.env.POLAR_UNLIMITED_PRODUCT_ID || "",
};

const PLAN_PRODUCT_MAP: Record<string, Exclude<PlanId, "free">> = {};
if (PLAN_PRODUCT_IDS.pro) PLAN_PRODUCT_MAP[PLAN_PRODUCT_IDS.pro] = "pro";
if (PLAN_PRODUCT_IDS.unlimited) {
  PLAN_PRODUCT_MAP[PLAN_PRODUCT_IDS.unlimited] = "unlimited";
}

export function getPolarServer(): "sandbox" | "production" {
  return POLAR_IS_SANDBOX ? "sandbox" : "production";
}

export function isPolarConfigured(): boolean {
  return Boolean(
    POLAR_ACCESS_TOKEN && POLAR_ACCESS_TOKEN !== "your_polar_access_token_here",
  );
}

export function getPolarAccessToken(): string {
  if (!isPolarConfigured() || !POLAR_ACCESS_TOKEN) {
    throw new Error("Polar is not configured");
  }
  return POLAR_ACCESS_TOKEN;
}

export function getPlanFromProductId(
  productId: string | null | undefined,
): Exclude<PlanId, "free"> | null {
  if (!productId) return null;
  return PLAN_PRODUCT_MAP[productId] || null;
}

export function getPlanFromProductIds(
  productIds: Array<string | null | undefined>,
): Exclude<PlanId, "free"> | null {
  for (const id of productIds) {
    const plan = getPlanFromProductId(id);
    if (plan) return plan;
  }
  return null;
}

export async function createCheckoutUrl(params: {
  productId: string;
  userId: string;
  customerEmail?: string | null;
  customerId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const handler = Checkout({
    accessToken: getPolarAccessToken(),
    server: getPolarServer(),
    successUrl: `${APP_URL}/dashboard/settings?tab=billing&upgrade=success`,
    returnUrl: `${APP_URL}/dashboard/settings?tab=billing`,
  });

  const url = new URL(`${APP_URL}/api/checkout`);
  url.searchParams.append("products", params.productId);
  url.searchParams.set("customerExternalId", params.userId);
  if (params.customerEmail) {
    url.searchParams.set("customerEmail", params.customerEmail);
  }
  if (params.customerId) {
    url.searchParams.set("customerId", params.customerId);
  }
  if (params.metadata) {
    url.searchParams.set("metadata", JSON.stringify(params.metadata));
  }

  const response = await handler(new Request(url.toString(), { method: "GET" }));
  const redirectUrl = response.headers.get("location");
  if (!response.ok || !redirectUrl) {
    throw new Error("Failed to create Polar checkout session");
  }

  return redirectUrl;
}

export async function createCustomerPortalUrl(customerId: string): Promise<string> {
  const handler = CustomerPortal({
    accessToken: getPolarAccessToken(),
    server: getPolarServer(),
    returnUrl: `${APP_URL}/dashboard/settings?tab=billing`,
    getCustomerId: async () => customerId,
  });

  const response = await handler(new Request(`${APP_URL}/api/portal`, { method: "GET" }));
  const redirectUrl = response.headers.get("location");
  if (!response.ok || !redirectUrl) {
    throw new Error("Failed to create Polar customer portal session");
  }

  return redirectUrl;
}

function extractSubscriptions(payload: Record<string, unknown>): Array<Record<string, unknown>> {
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

export function pickBestSubscription(
  subscriptions: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!subscriptions.length) return null;

  const preferred = subscriptions.find((sub) => {
    const status =
      typeof sub.status === "string" ? sub.status.toLowerCase() : "";
    return (
      status === "active" ||
      status === "trialing" ||
      status === "cancelled" ||
      status === "canceled"
    );
  });

  return preferred || subscriptions[0] || null;
}

export async function resolveCustomerFromPolarExternalId(
  userId: string,
): Promise<{ customerId: string | null; subscription: Record<string, unknown> | null }> {
  if (!isPolarConfigured()) {
    return { customerId: null, subscription: null };
  }

  const response = await fetch(
    `${POLAR_API_URL}/customers/external/${encodeURIComponent(userId)}/state`,
    {
      headers: {
        Authorization: `Bearer ${getPolarAccessToken()}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    return { customerId: null, subscription: null };
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const customer = payload.customer as Record<string, unknown> | undefined;
  const customerId = (customer?.id as string | undefined) || null;
  const subscription = pickBestSubscription(extractSubscriptions(payload));

  return { customerId, subscription };
}

export function getSubscriptionStatus(subscription: Record<string, unknown>): {
  status: string;
  active: boolean;
  cancellationScheduled: boolean;
} {
  const rawStatus =
    typeof subscription.status === "string" ? subscription.status.toLowerCase() : "";
  const cancellationScheduled =
    subscription.cancel_at_period_end === true ||
    subscription.cancelAtPeriodEnd === true ||
    rawStatus === "cancelled" ||
    rawStatus === "canceled";

  if (rawStatus === "active" || rawStatus === "trialing") {
    return {
      status: cancellationScheduled ? "cancelled" : "active",
      active: true,
      cancellationScheduled,
    };
  }

  return {
    status: rawStatus || "inactive",
    active: false,
    cancellationScheduled,
  };
}
