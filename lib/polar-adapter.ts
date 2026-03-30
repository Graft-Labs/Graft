export type PlanId = "free" | "pro" | "unlimited";

export const PLAN_SCANS_LIMITS: Record<PlanId, number> = {
  free: 3,
  pro: 50,
  unlimited: 999999,
};

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

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

export function validatePolarEnvVars(): {
  valid: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === "your_polar_access_token_here") {
    missing.push("POLAR_ACCESS_TOKEN");
  }

  if (!PLAN_PRODUCT_IDS.pro) {
    missing.push("POLAR_PRO_PRODUCT_ID");
  }

  if (!PLAN_PRODUCT_IDS.unlimited) {
    missing.push("POLAR_UNLIMITED_PRODUCT_ID");
  }

  if (missing.length === 0 && PLAN_PRODUCT_IDS.pro === PLAN_PRODUCT_IDS.unlimited) {
    warnings.push(
      "POLAR_PRO_PRODUCT_ID and POLAR_UNLIMITED_PRODUCT_ID are identical — plan detection will break.",
    );
  }

  if (!process.env.POLAR_WEBHOOK_SECRET || process.env.POLAR_WEBHOOK_SECRET === "your_polar_webhook_secret_here") {
    warnings.push("POLAR_WEBHOOK_SECRET is missing — webhooks will not be processed.");
  }

  return { valid: missing.length === 0, missing, warnings };
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
