import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { patchSubscription } from "@/lib/subscription-core";
import { getSubscriptionStatus } from "@/lib/polar-adapter";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`subscription-uncancel:${ip}`, 10, 60_000)) {
    return NextResponse.json({ message: "Too many requests" }, { status: 429 });
  }

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
      .select("subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    const subscriptionId = (userRow?.subscription_id as string | undefined) || null;
    if (!subscriptionId) {
      return NextResponse.json(
        { message: "No active subscription found for this account." },
        { status: 404 },
      );
    }

    const patched = await patchSubscription(subscriptionId, {
      cancel_at_period_end: false,
      cancelAtPeriodEnd: false,
    });

    if (!patched) {
      return NextResponse.json(
        {
          message:
            "Failed to keep subscription active. Please open Billing Portal to manage your subscription.",
        },
        { status: 500 },
      );
    }

    const status = getSubscriptionStatus(patched);
    await supabase
      .from("users")
      .update({
        subscription_status: status.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      subscriptionStatus: status.status,
      cancellationScheduled: status.cancellationScheduled,
      currentPeriodEnd:
        typeof patched.current_period_end === "string"
          ? patched.current_period_end
          : null,
      message: "Subscription will remain active.",
    });
  } catch (error) {
    console.error("Subscription uncancel error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
