import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Polar } from "@polar-sh/sdk";
import {
  PLAN_PRODUCT_IDS,
  getPolarAccessToken,
  getPolarServer,
} from "@/lib/polar-adapter";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(req: NextRequest) {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read from DB
  const { data: dbRow } = await supabase
    .from("users")
    .select("plan, scans_limit, subscription_id, subscription_status, customer_id")
    .eq("id", user.id)
    .maybeSingle();

  // Fetch from Polar directly
  const polar = new Polar({
    accessToken: getPolarAccessToken(),
    server: getPolarServer(),
  });

  let polarState = null;
  let polarError = null;

  try {
    // Try by subscription ID first
    if (dbRow?.subscription_id) {
      const sub = await polar.subscriptions.get({
        id: dbRow.subscription_id,
      });
      polarState = {
        source: "subscription_by_id",
        id: sub.id,
        productId: sub.productId,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
    } else {
      // Try by external customer ID
      const state = await polar.customers.getStateExternal({
        externalId: user.id,
      });
      polarState = {
        source: "external_state",
        customerId: state.id,
        subscriptions: state.activeSubscriptions.map((s) => ({
          id: s.id,
          productId: s.productId,
          status: s.status,
        })),
      };
    }
  } catch (err) {
    polarError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    userId: user.id,
    db: {
      plan: dbRow?.plan,
      scansLimit: dbRow?.scans_limit,
      subscriptionId: dbRow?.subscription_id,
      subscriptionStatus: dbRow?.subscription_status,
      customerId: dbRow?.customer_id,
    },
    polar: polarState,
    polarError,
    envVars: {
      POLAR_PRO_PRODUCT_ID: PLAN_PRODUCT_IDS.pro,
      POLAR_UNLIMITED_PRODUCT_ID: PLAN_PRODUCT_IDS.unlimited,
      POLAR_IS_SANDBOX: process.env.POLAR_IS_SANDBOX,
      POLAR_WEBHOOK_SECRET_SET:
        !!process.env.POLAR_WEBHOOK_SECRET &&
        process.env.POLAR_WEBHOOK_SECRET !== "your_polar_webhook_secret_here",
    },
  });
}
