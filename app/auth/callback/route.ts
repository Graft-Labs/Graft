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
      // Persist the provider_token immediately — it disappears after session refresh
      // Only store it for GitHub; other OAuth providers should not overwrite github_token.
      const providerToken = data.session?.provider_token
      const userId = data.session?.user?.id
      const provider = data.session?.user?.app_metadata?.provider
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
