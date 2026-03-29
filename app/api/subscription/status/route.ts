import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import {
  planScansLimit,
  type UserBillingRow,
  createAdminClient,
  fetchBestSubscriptionForUser,
  persistSubscriptionState,
} from "@/lib/subscription-core";

export async function GET() {
  try {
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
      scansLimit: planScansLimit(persisted.plan),
      subscriptionStatus: persisted.subscriptionStatus,
      subscriptionId:
        (subscription?.id as string | undefined) ||
        ((userRow?.subscription_id as string | undefined) ?? null),
      customerId:
        (subscription?.customer_id as string | undefined) ||
        ((userRow?.customer_id as string | undefined) ?? null),
      cancellationScheduled:
        persisted.subscriptionStatus === "cancelled" ||
        persisted.subscriptionStatus === "canceled",
      currentPeriodEnd:
        typeof subscription?.current_period_end === "string"
          ? subscription.current_period_end
          : null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Subscription status error:", message);
    return NextResponse.json(
      { message: "Internal server error", error: message },
      { status: 500 },
    );
  }
}
