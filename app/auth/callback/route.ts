import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { cookies } from 'next/headers'

async function getGithubUserId(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    return String(data.id)
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const cookieStore = await cookies()
  const nextFromCookie = requestUrl.searchParams.get('next') ?? cookieStore.get('shipguard_next')?.value
  const safeNextDecoded = nextFromCookie ? decodeURIComponent(nextFromCookie) : '/dashboard'
  const next = safeNextDecoded.startsWith('/') ? safeNextDecoded : '/dashboard'
  const isConnectingGithub = cookieStore.get('shipguard_connecting_github')?.value === '1'
  const connectingUserId = cookieStore.get('shipguard_connecting_user_id')?.value ?? null

  if (code) {
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const provider = data.session?.user?.app_metadata?.provider
      const userId = data.session?.user?.id
      const providerToken = data.session?.provider_token

      if (isConnectingGithub && connectingUserId && userId !== connectingUserId) {
        const redirect = NextResponse.redirect(
          new URL('/dashboard/settings?integration_error=oauth_user_mismatch', requestUrl.origin)
        )
        redirect.cookies.set('shipguard_next', '', { path: '/', maxAge: 0 })
        redirect.cookies.set('shipguard_connecting_github', '', { path: '/', maxAge: 0 })
        redirect.cookies.set('shipguard_connecting_user_id', '', { path: '/', maxAge: 0 })
        return redirect
      }

      if (userId) {
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, github_user_id, name, email, avatar_url, plan, scans_used, scans_limit, github_token')
          .eq('id', userId)
          .single()

        if (provider === 'github' && providerToken) {
          const githubUserId = await getGithubUserId(providerToken)

          if (githubUserId) {
            const conflictUser = await supabase
              .from('users')
              .select('id')
              .eq('github_user_id', githubUserId)
              .neq('id', userId)
              .limit(1)
              .single()

            if (conflictUser.data) {
              const redirect = NextResponse.redirect(
                new URL('/dashboard/settings?integration_error=github_already_linked', requestUrl.origin)
              )
              redirect.cookies.set('shipguard_next', '', { path: '/', maxAge: 0 })
              redirect.cookies.set('shipguard_connecting_github', '', { path: '/', maxAge: 0 })
              redirect.cookies.set('shipguard_connecting_user_id', '', { path: '/', maxAge: 0 })
              return redirect
            }

            if (isConnectingGithub) {
              await supabase
                .from('users')
                .update({
                  github_token: providerToken,
                  github_user_id: githubUserId,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', userId)

              const redirect = NextResponse.redirect(new URL(next, requestUrl.origin))
              redirect.cookies.set('shipguard_next', '', { path: '/', maxAge: 0 })
              redirect.cookies.set('shipguard_connecting_github', '', { path: '/', maxAge: 0 })
              redirect.cookies.set('shipguard_connecting_user_id', '', { path: '/', maxAge: 0 })
              return redirect
            }

            await supabase
              .from('users')
              .update({
                github_token: providerToken,
                github_user_id: githubUserId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', userId)
          }
        }

        const metadata = data.session?.user?.user_metadata ?? {}

        const resolvedName =
          existingUser?.name ??
          (metadata.full_name as string | undefined) ??
          (metadata.name as string | undefined) ??
          null

        const resolvedEmail = existingUser?.email ?? data.session?.user?.email ?? null
        const resolvedAvatar =
          existingUser?.avatar_url ??
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
              plan: existingUser?.plan ?? 'free',
              scans_used: existingUser?.scans_used ?? 0,
              scans_limit: existingUser?.scans_limit ?? 3,
              github_token: existingUser?.github_token ?? null,
              github_user_id: existingUser?.github_user_id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
      }

      const redirect = NextResponse.redirect(new URL(next, requestUrl.origin))
      redirect.cookies.set('shipguard_next', '', { path: '/', maxAge: 0 })
      redirect.cookies.set('shipguard_connecting_github', '', { path: '/', maxAge: 0 })
      redirect.cookies.set('shipguard_connecting_user_id', '', { path: '/', maxAge: 0 })
      return redirect
    }
  }

  const errorRedirect = NextResponse.redirect(new URL('/auth/login?error=oauth_callback_failed', requestUrl.origin))
  errorRedirect.cookies.set('shipguard_next', '', { path: '/', maxAge: 0 })
  errorRedirect.cookies.set('shipguard_connecting_github', '', { path: '/', maxAge: 0 })
  errorRedirect.cookies.set('shipguard_connecting_user_id', '', { path: '/', maxAge: 0 })
  return errorRedirect
}
