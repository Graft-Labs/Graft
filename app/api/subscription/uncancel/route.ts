import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

function getCancellationScheduled(subscription: Record<string, unknown>) {
  if (subscription.cancel_at_period_end === true) return true;
  if (subscription.cancelAtPeriodEnd === true) return true;

  const status =
    typeof subscription.status === "string"
      ? subscription.status.toLowerCase()
      : "";

  return status === "cancelled" || status === "canceled";
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 uncancel requests per minute per IP
  const ip = getClientIp(req)
  if (!checkRateLimit(`subscription-uncancel:${ip}`, 10, 60_000)) {
    return NextResponse.json({ message: "Too many requests" }, { status: 429 })
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json(
        {
          message:
            "Subscriptions are not configured right now. Please contact support.",
        },
        { status: 500 },
      );
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("subscription_id")
      .eq("id", user.id)
      .single();

    if (userError || !userData?.subscription_id) {
      return NextResponse.json(
        { message: "No active subscription found for this account." },
        { status: 404 },
      );
    }

    const response = await fetch(
      `${POLAR_API_URL}/subscriptions/${userData.subscription_id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cancel_at_period_end: false,
          cancelAtPeriodEnd: false,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      console.error("Failed to uncancel Polar subscription", {
        status: response.status,
        details,
      });

      return NextResponse.json(
        {
          message:
            "Failed to keep subscription active. Please open Billing Portal to manage your subscription.",
          details,
        },
        { status: 500 },
      );
    }

    const subscription = (await response.json()) as Record<string, unknown>;
    const cancellationScheduled = getCancellationScheduled(subscription);
    const subscriptionStatus =
      typeof subscription.status === "string"
        ? subscription.status
        : cancellationScheduled
          ? "cancelled"
          : "active";

    const { error: updateError } = await supabase
      .from("users")
      .update({
        subscription_status: cancellationScheduled
          ? "cancelled"
          : subscriptionStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Failed to persist subscription status after uncancel", {
        userId: user.id,
        updateError,
      });

      return NextResponse.json(
        {
          message:
            "Update was sent but we could not refresh account status. Please refresh and try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      subscription,
      subscriptionStatus,
      cancellationScheduled,
      currentPeriodEnd:
        typeof subscription.current_period_end === "string"
          ? subscription.current_period_end
          : null,
      message: "Subscription will remain active.",
    });
  } catch (error) {
    console.error("Subscription uncancel API error", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
