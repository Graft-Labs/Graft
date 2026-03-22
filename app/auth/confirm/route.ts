import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

type VerifyType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as VerifyType | null;
  const next = requestUrl.searchParams.get("next") || "/dashboard";
  const safeNext = next.startsWith("/") ? next : "/dashboard";

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/auth/login?error=invalid_confirmation_link", requestUrl.origin));
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return NextResponse.redirect(new URL("/auth/login?error=email_verification_failed", requestUrl.origin));
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
