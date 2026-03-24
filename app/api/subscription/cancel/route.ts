import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === "true";

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? "https://sandbox-api.polar.sh/v1"
  : "https://api.polar.sh/v1";

export async function POST() {
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
      .select("subscription_id, plan")
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
          cancel_at_period_end: true,
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      console.error("Failed to cancel Polar subscription", {
        status: response.status,
        details,
      });

      if (response.status === 403) {
        return NextResponse.json(
          {
            message:
              "Your subscription is already canceled for the current period.",
          },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { message: "Failed to cancel subscription. Please try again." },
        { status: 500 },
      );
    }

    const subscription = await response.json();

    await supabase
      .from("users")
      .update({
        subscription_status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      subscription,
      message: "Subscription cancellation scheduled.",
    });
  } catch (error) {
    console.error("Subscription cancel API error", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
