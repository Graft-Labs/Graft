import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

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

export async function GET() {
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
      .select("subscription_id, subscription_status, plan")
      .eq("id", user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json(
        { message: "Could not load subscription status." },
        { status: 500 },
      );
    }

    if (!userData.subscription_id) {
      return NextResponse.json({
        success: true,
        subscriptionStatus: userData.subscription_status,
        cancellationScheduled: false,
        currentPeriodEnd: null,
      });
    }

    if (
      !POLAR_ACCESS_TOKEN ||
      POLAR_ACCESS_TOKEN === "your_polar_access_token_here"
    ) {
      return NextResponse.json({
        success: true,
        subscriptionStatus: userData.subscription_status,
        cancellationScheduled:
          userData.subscription_status === "cancelled" ||
          userData.subscription_status === "canceled",
        currentPeriodEnd: null,
      });
    }

    const response = await fetch(
      `${POLAR_API_URL}/subscriptions/${userData.subscription_id}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const details = await response.text();
      console.error("Failed to fetch Polar subscription status", {
        status: response.status,
        details,
      });

      return NextResponse.json({
        success: true,
        subscriptionStatus: userData.subscription_status,
        cancellationScheduled:
          userData.subscription_status === "cancelled" ||
          userData.subscription_status === "canceled",
        currentPeriodEnd: null,
      });
    }

    const subscription = (await response.json()) as Record<string, unknown>;
    const cancellationScheduledFromPolar = getCancellationScheduled(subscription);
    const subscriptionStatusFromPolar =
      typeof subscription.status === "string"
        ? subscription.status
        : cancellationScheduledFromPolar
          ? "cancelled"
          : "active";

    const cancellationScheduled = cancellationScheduledFromPolar;

    const subscriptionStatus = cancellationScheduled
      ? "cancelled"
      : subscriptionStatusFromPolar;

    if (subscriptionStatus !== userData.subscription_status) {
      await supabase
        .from("users")
        .update({
          subscription_status: cancellationScheduled
            ? "cancelled"
            : subscriptionStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }

    return NextResponse.json({
      success: true,
      subscriptionStatus,
      cancellationScheduled,
      currentPeriodEnd:
        typeof subscription.current_period_end === "string"
          ? subscription.current_period_end
          : null,
    });
  } catch (error) {
    console.error("Subscription status API error", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
