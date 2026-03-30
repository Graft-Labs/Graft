import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Webhooks } from "@polar-sh/supabase";
import {
  PLAN_SCANS_LIMITS,
  getPlanFromProductIds,
  getSubscriptionStatus,
} from "@/lib/polar-adapter";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;

type PolarEventPayload = {
  type: string;
  data: Record<string, unknown>;
};

const webhookHandler =
  POLAR_WEBHOOK_SECRET &&
  SUPABASE_URL &&
  SUPABASE_SERVICE_KEY &&
  POLAR_WEBHOOK_SECRET !== "your_polar_webhook_secret_here"
    ? Webhooks({
        webhookSecret: POLAR_WEBHOOK_SECRET,
        onOrderPaid: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionCreated: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionUpdated: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionActive: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionCanceled: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionRevoked: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onSubscriptionUncanceled: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
        onOrderRefunded: async (payload: PolarEventPayload) => {
          await handleBillingPayload(payload.type, payload.data);
        },
      })
    : null;

type UserRecord = {
  id: string;
  email: string | null;
  plan: string | null;
  customer_id: string | null;
  subscription_id: string | null;
};

function adminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function extractProductIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const subscription = data.subscription as Record<string, unknown> | undefined;
  const product = data.product as Record<string, unknown> | undefined;

  const topLevel =
    (data.product_id as string | undefined) || (product?.id as string | undefined);
  if (topLevel) ids.push(topLevel);

  const subProduct =
    (subscription?.product_id as string | undefined) ||
    ((subscription?.product as Record<string, unknown> | undefined)?.id as
      | string
      | undefined);
  if (subProduct) ids.push(subProduct);

  const items =
    (data.items as Array<Record<string, unknown>> | undefined) ||
    (subscription?.items as Array<Record<string, unknown>> | undefined) ||
    [];
  for (const item of items) {
    const id =
      (item.product_id as string | undefined) ||
      ((item.product as Record<string, unknown> | undefined)?.id as string | undefined);
    if (id) ids.push(id);
  }

  return ids;
}

function detectPlan(data: Record<string, unknown>): "free" | "pro" | "unlimited" {
  const metadata =
    (data.metadata as Record<string, unknown> | undefined) ||
    ((data.subscription as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined) ||
    ((data.checkout as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined);

  const metadataPlan =
    typeof metadata?.plan === "string" ? metadata.plan.toLowerCase() : null;
  if (metadataPlan === "pro" || metadataPlan === "unlimited") {
    return metadataPlan;
  }

  const planFromProducts = getPlanFromProductIds(extractProductIds(data));
  if (planFromProducts) return planFromProducts;

  const status = getSubscriptionStatus(data.subscription as Record<string, unknown>);
  if (status.active) return "pro";
  return "free";
}

async function resolveUser(data: Record<string, unknown>): Promise<UserRecord | null> {
  const supabase = adminClient();
  if (!supabase) return null;

  const metadata =
    (data.metadata as Record<string, unknown> | undefined) ||
    ((data.subscription as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined) ||
    ((data.checkout as Record<string, unknown> | undefined)?.metadata as
      | Record<string, unknown>
      | undefined);

  const metadataUserId =
    typeof metadata?.user_id === "string" ? metadata.user_id : null;
  if (metadataUserId) {
    const { data: row } = await supabase
      .from("users")
      .select("id, email, plan, customer_id, subscription_id")
      .eq("id", metadataUserId)
      .maybeSingle<UserRecord>();
    if (row) return row;
  }

  const externalId =
    ((data.customer as Record<string, unknown> | undefined)?.external_id as
      | string
      | undefined) ||
    (data.customer_external_id as string | undefined) ||
    null;

  if (externalId) {
    const { data: row } = await supabase
      .from("users")
      .select("id, email, plan, customer_id, subscription_id")
      .eq("id", externalId)
      .maybeSingle<UserRecord>();
    if (row) return row;
  }

  const customerId =
    (data.customer_id as string | undefined) ||
    ((data.customer as Record<string, unknown> | undefined)?.id as
      | string
      | undefined) ||
    null;
  if (customerId) {
    const { data: row } = await supabase
      .from("users")
      .select("id, email, plan, customer_id, subscription_id")
      .eq("customer_id", customerId)
      .maybeSingle<UserRecord>();
    if (row) return row;
  }

  const emailRaw =
    (data.customer_email as string | undefined) ||
    ((data.customer as Record<string, unknown> | undefined)?.email as
      | string
      | undefined) ||
    (data.email as string | undefined) ||
    null;
  const email = emailRaw?.trim().toLowerCase() || null;
  if (email) {
    const { data: row } = await supabase
      .from("users")
      .select("id, email, plan, customer_id, subscription_id")
      .ilike("email", email)
      .maybeSingle<UserRecord>();
    if (row) return row;
  }

  return null;
}

function mapSubscriptionForPayload(data: Record<string, unknown>): Record<string, unknown> {
  const sub = data.subscription as Record<string, unknown> | undefined;
  if (sub) return sub;
  return data;
}

async function handleBillingPayload(
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;

  const user = await resolveUser(data);
  if (!user) {
    console.warn("Polar webhook: could not resolve user", { eventType });
    return;
  }

  const customerId =
    (data.customer_id as string | undefined) ||
    ((data.customer as Record<string, unknown> | undefined)?.id as
      | string
      | undefined) ||
    user.customer_id ||
    null;

  const subscription = mapSubscriptionForPayload(data);
  const status = getSubscriptionStatus(subscription);
  const subscriptionId =
    (subscription.id as string | undefined) ||
    (data.subscription_id as string | undefined) ||
    user.subscription_id ||
    null;

  let nextPlan = detectPlan(data);
  let nextStatus = status.status;

  // Debug logging for subscription.updated — helps verify product_id mapping
  if (eventType === "subscription.updated") {
    const subData = data.subscription as Record<string, unknown> | undefined;
    const newProductId =
      (data.product_id as string | undefined) ||
      ((data.product as Record<string, unknown> | undefined)?.id as string | undefined) ||
      (subData?.product_id as string | undefined) ||
      "unknown";
    console.log("[Polar webhook] subscription.updated", {
      subscriptionId: (subData?.id as string | undefined) || (data.id as string | undefined),
      newProductId,
      detectedPlan: nextPlan,
      currentDbPlan: user.plan,
      status: nextStatus,
    });
  }

  if (eventType === "subscription.revoked" || eventType === "order.refunded") {
    nextPlan = "free";
    nextStatus = eventType === "order.refunded" ? "refunded" : "cancelled";
  }

  if (eventType === "subscription.canceled") {
    // Polar fires subscription.canceled when:
    //   1. User requests cancellation (cancel_at_period_end = true) — period still active
    //   2. Period has actually ended — subscription fully expired
    // Only set plan to "free" when the period has ended. Otherwise keep the
    // current plan so the user retains access until current_period_end.
    const periodEnd =
      (data.current_period_end as string | undefined) ||
      (subscription.current_period_end as string | undefined) ||
      null;
    const periodExpired =
      periodEnd ? new Date(periodEnd).getTime() <= Date.now() : false;

    if (periodExpired) {
      nextPlan = "free";
    } else {
      nextPlan = (user.plan as "free" | "pro" | "unlimited" | null) || "free";
    }
    nextStatus = "cancelled";
  }

  if (eventType === "order.paid" && nextPlan !== "free") {
    nextStatus = "active";
  }

  if (eventType === "subscription.uncanceled") {
    nextPlan = (user.plan as "free" | "pro" | "unlimited" | null) || nextPlan;
    nextStatus = "active";
  }

  const payload: Record<string, unknown> = {
    id: user.id,
    email:
      user.email ||
      ((data.customer as Record<string, unknown> | undefined)?.email as
        | string
        | undefined) ||
      null,
    plan: nextPlan,
    scans_limit: PLAN_SCANS_LIMITS[nextPlan],
    customer_id: customerId,
    subscription_id: subscriptionId,
    subscription_status: nextStatus,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("users").upsert(payload, { onConflict: "id" });
}

export async function POST(req: NextRequest) {
  if (!webhookHandler) {
    return new Response(
      JSON.stringify({ error: "Webhook route is not configured" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return webhookHandler(req);
}
