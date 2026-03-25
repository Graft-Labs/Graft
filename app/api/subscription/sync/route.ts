import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
};

const PLAN_PRODUCT_MAP: Record<string, string> = {};
const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
const unlimitedProductId = process.env.POLAR_UNLIMITED_PRODUCT_ID;
if (proProductId) PLAN_PRODUCT_MAP[proProductId] = "pro";
if (unlimitedProductId) PLAN_PRODUCT_MAP[unlimitedProductId] = "unlimited";

export async function POST() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, email, plan, subscription_id, subscription_status, customer_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json(
        { message: "Could not load user data." },
        { status: 500 },
      );
    }

    // If user has no subscription_id, force free plan
    if (!userData.subscription_id) {
      if (userData.plan !== "free" || userData.subscription_status) {
        await supabase
          .from("users")
          .update({
            plan: "free",
            scans_limit: 3,
            subscription_id: null,
            subscription_status: null,
            customer_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);
      }

      return NextResponse.json({
        success: true,
        plan: "free",
        subscriptionStatus: null,
        message: "No active subscription.",
      });
    }

    // If Polar is not configured, return what we have
    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json({
        success: true,
        plan: userData.plan || "free",
        subscriptionStatus: userData.subscription_status,
        message: "Payment provider not configured.",
      });
    }

    // Fetch subscription from Polar
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

    if (!polarResponse.ok) {
      // Subscription not found in Polar (deleted customer, etc.)
      // Reset user to free plan
      if (polarResponse.status === 404) {
        await supabase
          .from("users")
          .update({
            plan: "free",
            scans_limit: 3,
            subscription_id: null,
            subscription_status: null,
            customer_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);

        return NextResponse.json({
          success: true,
          plan: "free",
          subscriptionStatus: null,
          message: "Subscription not found. Reset to free plan.",
        });
      }

      const errorText = await polarResponse.text();
      console.error("Failed to fetch Polar subscription for sync:", {
        status: polarResponse.status,
        details: errorText,
      });

      // Return what we have from DB, don't corrupt state
      return NextResponse.json({
        success: true,
        plan: userData.plan || "free",
        subscriptionStatus: userData.subscription_status,
        message: "Could not sync with payment provider.",
      });
    }

    const subscription = await polarResponse.json();
    const polarStatus: string = subscription.status || "";
    const cancelAtPeriodEnd: boolean =
      subscription.cancel_at_period_end === true ||
      subscription.cancelAtPeriodEnd === true;

    // Determine plan from product_id
    const productId: string = subscription.product_id || "";
    let plan = PLAN_PRODUCT_MAP[productId] || null;

    // Fallback: check items array
    if (!plan && Array.isArray(subscription.items)) {
      for (const item of subscription.items) {
        const itemId = item.product_id || item?.product?.id;
        if (itemId && PLAN_PRODUCT_MAP[itemId]) {
          plan = PLAN_PRODUCT_MAP[itemId];
          break;
        }
      }
    }

    // Fallback: check products array
    if (!plan && Array.isArray(subscription.products)) {
      for (const product of subscription.products) {
        const productId = product.id || product.product_id;
        if (productId && PLAN_PRODUCT_MAP[productId]) {
          plan = PLAN_PRODUCT_MAP[productId];
          break;
        }
      }
    }

    // If still no plan found and subscription is active, default to pro
    if (!plan && polarStatus === "active") {
      plan = "pro";
    }

    // Determine effective plan and status
    const isActive = polarStatus === "active" || polarStatus === "trialing";
    const isCancelled = cancelAtPeriodEnd || polarStatus === "canceled" || polarStatus === "cancelled";

    const effectivePlan = isActive ? (plan || "pro") : "free";
    const scansLimit = PLAN_SCANS_LIMITS[effectivePlan] ?? 3;
    const effectiveStatus = isCancelled ? "cancelled" : (isActive ? "active" : polarStatus);
    const customerId: string = subscription.customer_id || "";

    // Update DB
    await supabase
      .from("users")
      .update({
        plan: effectivePlan,
        scans_limit: scansLimit,
        subscription_id: userData.subscription_id,
        subscription_status: effectiveStatus,
        customer_id: customerId || userData.customer_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

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
