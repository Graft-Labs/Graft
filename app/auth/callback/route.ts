import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const provider = data.session?.user?.app_metadata?.provider

      // Keep canonical profile info in users table for UI stability.
      // If a user logs in with multiple providers, preserve existing values
      // and only fill missing fields from current provider metadata.
      const userId = data.session?.user?.id
      if (userId) {
        const { data: existing } = await supabase
          .from('users')
          .select('name, email, avatar_url, plan, scans_used, scans_limit, github_token')
          .eq('id', userId)
          .single()

        const metadata = data.session?.user?.user_metadata ?? {}
        const resolvedName =
          existing?.name ??
          (metadata.full_name as string | undefined) ??
          (metadata.name as string | undefined) ??
          null

        const resolvedEmail = existing?.email ?? data.session?.user?.email ?? null
        const resolvedAvatar =
          existing?.avatar_url ??
          (metadata.avatar_url as string | undefined) ??
          (metadata.picture as string | undefined) ??
          null

        await supabase
          .from('users')
          .upsert(
            {
              id: userId,
              name: resolvedName,
              email: resolvedEmail,
              avatar_url: resolvedAvatar,
              plan: existing?.plan ?? 'free',
              scans_used: existing?.scans_used ?? 0,
              scans_limit: existing?.scans_limit ?? 3,
              github_token: existing?.github_token ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
      }

      // Persist the provider_token immediately — it disappears after session refresh
      // Only store it for GitHub; other OAuth providers should not overwrite github_token.
      const providerToken = data.session?.provider_token
      if (provider === 'github' && providerToken && userId) {
        await supabase
          .from('users')
          .update({ github_token: providerToken })
          .eq('id', userId)
      }

      return NextResponse.redirect(new URL(next, requestUrl.origin))
    }
  }

  return NextResponse.redirect(new URL('/auth/login?error=oauth_callback_failed', requestUrl.origin))
}
