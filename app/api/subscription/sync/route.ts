import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import {
  type UserBillingRow,
  createAdminClient,
  fetchBestSubscriptionForUser,
  persistSubscriptionState,
  resolvePlanFromSubscription,
  fetchSubscriptionById,
} from "@/lib/subscription-core";
import { getPlanFromProductIds } from "@/lib/polar-adapter";

const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";
const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

function scansForPlan(plan: "free" | "pro" | "unlimited"): number {
  return plan === "free" ? 3 : plan === "pro" ? 50 : 999999;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { checkoutId?: string }
      | null;

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select(
        "id, email, plan, scans_limit, subscription_id, subscription_status, customer_id",
      )
      .eq("id", user.id)
      .maybeSingle();

    const admin = createAdminClient() || supabase;

    if (body?.checkoutId) {
      const token = process.env.POLAR_ACCESS_TOKEN;
      if (token && token !== "your_polar_access_token_here") {
        const checkoutResponse = await fetch(
          `${POLAR_API_URL}/checkouts/${encodeURIComponent(body.checkoutId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (checkoutResponse.ok) {
          const checkout = (await checkoutResponse.json()) as Record<string, unknown>;
          const checkoutStatus =
            typeof checkout.status === "string" ? checkout.status.toLowerCase() : "";

          const checkoutProduct = checkout.product as Record<string, unknown> | undefined;
          const products = checkout.products as Array<Record<string, unknown>> | undefined;
          const productId =
            (checkout.product_id as string | undefined) ||
            (checkoutProduct?.id as string | undefined) ||
            (products?.[0]?.id as string | undefined) ||
            (products?.[0]?.product_id as string | undefined) ||
            null;

          const plan =
            getPlanFromProductIds([productId]) ||
            ((checkout.metadata as Record<string, unknown> | undefined)?.plan as
              | "pro"
              | "unlimited"
              | undefined) ||
            null;

          const subscription =
            ((checkout.subscription as Record<string, unknown> | undefined) || null) as
              | Record<string, unknown>
              | null;
          const subscriptionId =
            (checkout.subscription_id as string | undefined) ||
            (subscription?.id as string | undefined) ||
            null;

          const completedStatuses = new Set([
            "succeeded",
            "paid",
            "completed",
            "active",
            "confirmed",
          ]);

          if (plan && completedStatuses.has(checkoutStatus)) {
            const payload: Record<string, unknown> = {
              id: user.id,
              email: user.email || (userRow?.email as string | null) || null,
              plan,
              scans_limit: scansForPlan(plan),
              subscription_status: "active",
              customer_id:
                (checkout.customer_id as string | undefined) ||
                ((checkout.customer as Record<string, unknown> | undefined)?.id as
                  | string
                  | undefined) ||
                (userRow?.customer_id as string | undefined) ||
                null,
              subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            };
            if (!userRow) payload.scans_used = 0;

            await admin.from("users").upsert(payload, { onConflict: "id" });

            if (subscriptionId) {
              const fullSubscription = await fetchSubscriptionById(subscriptionId);
              const planFromSub = fullSubscription
                ? resolvePlanFromSubscription(fullSubscription)
                : plan;

              return NextResponse.json({
                success: true,
                plan: planFromSub,
                subscriptionStatus: "active",
                message: `Synced from checkout ${body.checkoutId}.`,
              });
            }

            return NextResponse.json({
              success: true,
              plan,
              subscriptionStatus: "active",
              message: `Synced from checkout ${body.checkoutId}.`,
            });
          }
        }
      }
    }

    const subscription = await fetchBestSubscriptionForUser({
      userId: user.id,
      customerId: (userRow?.customer_id as string | undefined) || null,
      subscriptionId: (userRow?.subscription_id as string | undefined) || null,
    });

    const persisted = await persistSubscriptionState({
      admin,
      userId: user.id,
      email: user.email || (userRow?.email as string | null) || null,
      subscription,
      fallback: (userRow as UserBillingRow | null) || undefined,
    });

    return NextResponse.json({
      success: true,
      plan: persisted.plan,
      subscriptionStatus: persisted.subscriptionStatus,
      cancelAtPeriodEnd:
        persisted.subscriptionStatus === "cancelled" ||
        persisted.subscriptionStatus === "canceled",
      currentPeriodEnd:
        typeof subscription?.current_period_end === "string"
          ? subscription.current_period_end
          : null,
      message: `Synced to ${persisted.plan} plan.`,
    });
  } catch (error) {
    console.error("Subscription sync error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
