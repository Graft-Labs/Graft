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

  // Ensure the users table row exists for email/password sign-ups.
  // OAuth users are handled in /auth/callback, but email-verified users
  // land here and need their row created to avoid PGRST116 errors.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const metadata = user.user_metadata ?? {};
      const resolvedName =
        (metadata.full_name as string | undefined) ??
        (metadata.name as string | undefined) ??
        null;

      await supabase.from('users').upsert(
        {
          id: user.id,
          email: user.email ?? null,
          name: resolvedName,
          avatar_url: (metadata.avatar_url as string | undefined) ?? (metadata.picture as string | undefined) ?? null,
          plan: 'free',
          scans_used: 0,
          scans_limit: 3,
          updated_at: new Date().toISOString(),
        },
        // ignoreDuplicates: true means "INSERT … ON CONFLICT DO NOTHING".
        // We never overwrite an existing row here — we only want to create
        // the row for email/password users who have no row yet.
        { onConflict: 'id', ignoreDuplicates: true },
      );
    }
  } catch (upsertErr) {
    console.error('confirm: failed to upsert users row', upsertErr);
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
