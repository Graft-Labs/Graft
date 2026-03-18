import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: "server_config_error", message: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      secretKey,
      { auth: { persistSession: false } }
    );

    const { data: userScans, error: scansError } = await admin
      .from("scans")
      .select("id")
      .eq("user_id", user.id);

    if (scansError) {
      return NextResponse.json({ error: "scan_fetch_failed", message: scansError.message }, { status: 500 });
    }

    const scanIds = (userScans || []).map((row) => row.id);
    if (scanIds.length > 0) {
      await admin.from("issues").delete().in("scan_id", scanIds);
    }

    await admin.from("scans").delete().eq("user_id", user.id);
    await admin.from("users").delete().eq("id", user.id);

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      return NextResponse.json({ error: "auth_delete_failed", message: deleteAuthError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[account-delete] failed", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
