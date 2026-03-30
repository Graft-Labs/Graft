import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  isPolarConfigured,
  getPolarAccessToken,
  getPolarServer,
  resolveCustomerFromPolarExternalId,
} from "@/lib/polar-adapter";
import { Polar } from "@polar-sh/sdk";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`portal:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    if (!isPolarConfigured()) {
      return NextResponse.json(
        {
          error: "Payment not configured",
          message: "Polar is not configured. Please contact support.",
        },
        { status: 500 },
      );
    }

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = (userRow?.customer_id as string | undefined) || null;

    if (!customerId) {
      const resolved = await resolveCustomerFromPolarExternalId(user.id);
      customerId = resolved.customerId;
      if (customerId) {
        await supabase
          .from("users")
          .update({ customer_id: customerId, updated_at: new Date().toISOString() })
          .eq("id", user.id);
      }
    }

    if (!customerId) {
      return NextResponse.json(
        {
          error: "No active customer",
          message: "No Polar customer was found for your account.",
        },
        { status: 404 },
      );
    }

    const polar = new Polar({
      accessToken: getPolarAccessToken(),
      server: getPolarServer(),
    });

    const session = await polar.customerSessions.create({
      customerId,
      returnUrl: `${req.nextUrl.origin}/dashboard/settings?tab=billing`,
    });

    return NextResponse.json({ url: session.customerPortalUrl });
  } catch (error) {
    console.error("Portal route error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
