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
      const providerToken = data.session?.provider_token
      const userId = data.session?.user?.id
      if (providerToken && userId) {
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
