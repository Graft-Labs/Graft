import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import {
  planScansLimit,
  type UserBillingRow,
  createAdminClient,
  fetchBestSubscriptionForUser,
  persistSubscriptionState,
} from "@/lib/subscription-core";

export async function POST() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select(
        "id, email, plan, scans_limit, subscription_id, subscription_status, customer_id",
      )
      .eq("id", user.id)
      .maybeSingle();

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        {
          error: "Server misconfiguration",
          message: "Supabase service role key is required for repair.",
        },
        { status: 500 },
      );
    }

    const subscription = await fetchBestSubscriptionForUser({
      userId: user.id,
      customerId: (userRow?.customer_id as string | undefined) || null,
      subscriptionId: (userRow?.subscription_id as string | undefined) || null,
    });

    if (!subscription) {
      return NextResponse.json(
        {
          error: "No subscription found",
          message:
            "Could not find any subscription associated with your account on Polar.",
        },
        { status: 404 },
      );
    }

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
      subscriptionId:
        (subscription.id as string | undefined) ||
        ((userRow?.subscription_id as string | undefined) ?? null),
      customerId:
        (subscription.customer_id as string | undefined) ||
        ((userRow?.customer_id as string | undefined) ?? null),
      message: `Successfully repaired. Your plan is now ${persisted.plan}.`,
    });
  } catch (error) {
    console.error("Subscription repair error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
