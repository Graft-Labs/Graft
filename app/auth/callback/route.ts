import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Service-role client bypasses RLS — used for user upsert so it always succeeds
// regardless of whether the users row already exists or not.
const adminSupabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        (process.env.SUPABASE_SECRET_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY)!,
      )
    : null;

function withClearedConnectCookies(response: NextResponse) {
  response.cookies.set("graft_next", "", { path: "/", maxAge: 0 });
  response.cookies.set("graft_connecting_provider", "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("graft_connecting_user_id", "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("graft_connecting_github", "", { path: "/", maxAge: 0 });
  response.cookies.set("shipguard_next", "", { path: "/", maxAge: 0 });
  response.cookies.set("shipguard_connecting_provider", "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("shipguard_connecting_user_id", "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("shipguard_connecting_github", "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}

function resolveConnectingProvider(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): "github" | "google" | null {
  const provider =
    cookieStore.get("graft_connecting_provider")?.value ??
    cookieStore.get("shipguard_connecting_provider")?.value;
  if (provider === "github" || provider === "google") return provider;
  if (cookieStore.get("graft_connecting_github")?.value === "1")
    return "github";
  if (cookieStore.get("shipguard_connecting_github")?.value === "1")
    return "github";
  return null;
}

function mapIntegrationError(
  provider: "github" | "google",
  errorCode: string | null,
) {
  if (errorCode === "identity_already_exists")
    return `${provider}_already_linked`;
  return `${provider}_oauth_failed`;
}

function redirectUsingHashError(origin: string, provider: "github" | "google") {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connecting GitHub...</title>
  </head>
  <body>
    <script>
      (function () {
        var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        var code = hash.get('error_code');
        var integrationError = code === 'identity_already_exists' ? '${provider}_already_linked' : '${provider}_oauth_failed';
        window.location.replace('${origin}/dashboard/settings?tab=integrations&integration_error=' + integrationError);
      })();
    </script>
  </body>
</html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  return withClearedConnectCookies(response);
}

async function getGithubUserId(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return String(data.id);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const cookieStore = await cookies();
  const nextFromCookie =
    requestUrl.searchParams.get("next") ??
    cookieStore.get("graft_next")?.value ??
    cookieStore.get("shipguard_next")?.value;
  const safeNextDecoded = nextFromCookie
    ? decodeURIComponent(nextFromCookie)
    : "/dashboard";
  const next = safeNextDecoded.startsWith("/") ? safeNextDecoded : "/dashboard";
  const connectingProvider = resolveConnectingProvider(cookieStore);
  const isConnectingProvider = Boolean(connectingProvider);
  const connectingUserId =
    cookieStore.get("graft_connecting_user_id")?.value ??
    cookieStore.get("shipguard_connecting_user_id")?.value ??
    null;
  const oauthErrorCode = requestUrl.searchParams.get("error_code");

  if (!code && connectingProvider) {
    return redirectUsingHashError(requestUrl.origin, connectingProvider);
  }

  if (code) {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const provider = data.session?.user?.app_metadata?.provider;
      const userId = data.session?.user?.id;
      const providerToken = data.session?.provider_token;

      if (
        isConnectingProvider &&
        connectingUserId &&
        userId !== connectingUserId
      ) {
        const redirect = NextResponse.redirect(
          new URL(
            "/dashboard/settings?tab=integrations&integration_error=oauth_user_mismatch",
            requestUrl.origin,
          ),
        );
        return withClearedConnectCookies(redirect);
      }

      if (userId) {
        const { data: existingUser } = await supabase
          .from("users")
          .select(
            "id, github_user_id, name, email, avatar_url, plan, scans_used, scans_limit, github_token",
          )
          .eq("id", userId)
          .maybeSingle();

        // Track the verified GitHub credentials so the final upsert can use the
        // freshly-obtained token rather than the stale existingUser snapshot.
        let resolvedGithubToken: string | null =
          existingUser?.github_token ?? null;
        let resolvedGithubUserId: string | null =
          existingUser?.github_user_id ?? null;

        if (provider === "github") {
          const tokenToUse = providerToken ?? resolvedGithubToken;
          if (tokenToUse) {
            const githubUserId = await getGithubUserId(tokenToUse);

            if (githubUserId) {
              const conflictUser = await supabase
                .from("users")
                .select("id")
                .eq("github_user_id", githubUserId)
                .neq("id", userId)
                .limit(1)
                .maybeSingle();

              if (conflictUser.data) {
                const redirect = NextResponse.redirect(
                  new URL(
                    "/dashboard/settings?tab=integrations&integration_error=github_already_linked",
                    requestUrl.origin,
                  ),
                );
                return withClearedConnectCookies(redirect);
              }

              if (isConnectingProvider && connectingProvider === "github") {
                await supabase
                  .from("users")
                  .update({
                    github_token: tokenToUse,
                    github_user_id: githubUserId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", userId);

                const redirect = NextResponse.redirect(
                  new URL(next, requestUrl.origin),
                );
                return withClearedConnectCookies(redirect);
              }

              resolvedGithubToken = tokenToUse;
              resolvedGithubUserId = githubUserId;

              await supabase
                .from("users")
                .update({
                  github_token: tokenToUse,
                  github_user_id: githubUserId,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", userId);
            }
          }
        }

        if (isConnectingProvider && connectingProvider === "google") {
          const redirect = NextResponse.redirect(
            new URL(next, requestUrl.origin),
          );
          return withClearedConnectCookies(redirect);
        }

        const metadata = data.session?.user?.user_metadata ?? {};

        const resolvedName =
          existingUser?.name ??
          (metadata.full_name as string | undefined) ??
          (metadata.name as string | undefined) ??
          null;

        const resolvedEmail =
          existingUser?.email ?? data.session?.user?.email ?? null;
        const resolvedAvatar =
          existingUser?.avatar_url ??
          (metadata.avatar_url as string | undefined) ??
          (metadata.picture as string | undefined) ??
          null;

        const isNewUser = !existingUser;
        const userData: Record<string, unknown> = {
          id: userId,
          name: resolvedName,
          email: resolvedEmail,
          avatar_url: resolvedAvatar,
          github_token: resolvedGithubToken,
          github_user_id: resolvedGithubUserId,
          updated_at: new Date().toISOString(),
        };

        if (isNewUser) {
          userData.plan = "free";
          userData.scans_used = 0;
          userData.scans_limit = 3;
        }

        // Prefer the service-role client so the upsert bypasses RLS and always
        // succeeds even on first sign-in when no public.users row exists yet.
        const upsertClient = adminSupabase ?? supabase;
        const { error: upsertError } = await upsertClient
          .from("users")
          .upsert(userData, { onConflict: "id" });
        if (upsertError) {
          console.error("[auth/callback] Failed to upsert user profile:", {
            userId,
            error: upsertError.message,
            code: upsertError.code,
          });
        }
      }

      const redirect = NextResponse.redirect(new URL(next, requestUrl.origin));
      return withClearedConnectCookies(redirect);
    }

    if (connectingProvider) {
      const integrationError = mapIntegrationError(
        connectingProvider,
        oauthErrorCode,
      );
      const redirect = NextResponse.redirect(
        new URL(
          `/dashboard/settings?tab=integrations&integration_error=${integrationError}`,
          requestUrl.origin,
        ),
      );
      return withClearedConnectCookies(redirect);
    }
  }

  const errorRedirect = NextResponse.redirect(
    new URL("/auth/login?error=oauth_callback_failed", requestUrl.origin),
  );
  return withClearedConnectCookies(errorRedirect);
}
