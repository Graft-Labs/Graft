/**
 * Shared subscription utility functions used by the subscription status and sync API routes.
 * Centralised here so both routes always use the same plan-detection logic.
 */

export const PLAN_SCANS_LIMITS: Record<string, number> = {
  free: 3,
  pro: 50,
  unlimited: 999999,
};

/**
 * Extracts the plan name from a Polar subscription object.
 *
 * Resolution order (most-to-least reliable):
 *   1. subscription.metadata.plan
 *   2. subscription.product_id / subscription.product.id   → planProductMap lookup
 *   3. subscription.items[].metadata.plan
 *   4. subscription.items[].product_id / .product.id       → planProductMap lookup
 *   5. subscription.products[].id / .product_id            → planProductMap lookup
 *
 * @param subscription   Raw subscription object returned by Polar.
 * @param planProductMap Map of { productId: planName } built from env-var product IDs.
 * @returns "pro" | "unlimited" | null
 */
export function getPlanFromSubscription(
  subscription: Record<string, unknown>,
  planProductMap: Record<string, string>,
): string | null {
  // 1) metadata.plan is the most explicit signal
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  if (metadata?.plan && typeof metadata.plan === "string") {
    const metaPlan = metadata.plan.toLowerCase();
    if (metaPlan === "pro" || metaPlan === "unlimited") return metaPlan;
  }

  // 2) top-level product_id
  const directProductId =
    (subscription.product_id as string | undefined) ||
    ((subscription.product as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);
  if (directProductId && planProductMap[directProductId]) {
    return planProductMap[directProductId];
  }

  // 3) items array
  const items = subscription.items as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(items)) {
    for (const item of items) {
      const itemMeta = item.metadata as Record<string, unknown> | undefined;
      if (itemMeta?.plan && typeof itemMeta.plan === "string") {
        const metaPlan = itemMeta.plan.toLowerCase();
        if (metaPlan === "pro" || metaPlan === "unlimited") return metaPlan;
      }
      const itemProductId =
        (item.product_id as string | undefined) ||
        ((item.product as Record<string, unknown> | undefined)?.id as
          | string
          | undefined);
      if (itemProductId && planProductMap[itemProductId]) {
        return planProductMap[itemProductId];
      }
    }
  }

  // 4) products array (some Polar response shapes)
  const products = subscription.products as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(products)) {
    for (const product of products) {
      const productId =
        (product.id as string | undefined) ||
        (product.product_id as string | undefined);
      if (productId && planProductMap[productId]) {
        return planProductMap[productId];
      }
    }
  }

  return null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * Normalises a Polar subscription status into { status, active }.
 * A subscription that is pending cancellation (cancel_at_period_end=true)
 * is considered still-active but with status="cancelled".
 */
export function getNormalizedStatus(subscription: Record<string, unknown>): {
  status: string | null;
  active: boolean;
} {
  const rawStatus =
    typeof subscription.status === "string"
      ? subscription.status.toLowerCase()
      : "";

  const cancelAtPeriodEnd =
    subscription.cancel_at_period_end === true ||
    subscription.cancelAtPeriodEnd === true;

  if (
    cancelAtPeriodEnd ||
    rawStatus === "cancelled" ||
    rawStatus === "canceled"
  ) {
    return { status: "cancelled", active: true };
  }

  if (ACTIVE_STATUSES.has(rawStatus)) {
    return { status: "active", active: true };
  }

  return { status: rawStatus || null, active: false };
}

/**
 * Returns true when a subscription has a scheduled (or immediate) cancellation.
 */
export function getCancellationScheduled(
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

/**
 * Extracts the subscription list from a Polar customer-state payload.
 * Polar returns the list in different fields depending on the endpoint version.
 */
export function getSubscriptionsFromStatePayload(
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  // Polar CustomerState: top-level active_subscriptions
  const active = payload.active_subscriptions;
  if (Array.isArray(active) && active.length) {
    return active as Array<Record<string, unknown>>;
  }

  // Direct subscriptions array
  const direct = payload.subscriptions;
  if (Array.isArray(direct)) {
    return direct as Array<Record<string, unknown>>;
  }

  // Nested customer_state.subscriptions
  const customerState = payload.customer_state as
    | Record<string, unknown>
    | undefined;
  const nested = customerState?.subscriptions;
  if (Array.isArray(nested)) {
    return nested as Array<Record<string, unknown>>;
  }

  return [];
}

/**
 * Selects the "best" subscription from a list.
 * Prefers active/trialing/cancelled over any other status.
 */
export function pickBestSubscription(
  subscriptions: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!subscriptions.length) return null;

  const preferred = subscriptions.find((sub) => {
    const status =
      typeof sub.status === "string" ? sub.status.toLowerCase() : "";
    return (
      ACTIVE_STATUSES.has(status) ||
      status === "cancelled" ||
      status === "canceled"
    );
  });

  return preferred ?? subscriptions[0] ?? null;
}
