import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { UserIdentity } from '@supabase/supabase-js'

type DisconnectPayload = {
  provider?: 'github' | 'google'
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DisconnectPayload
    const provider = body.provider

    if (provider !== 'github' && provider !== 'google') {
      return NextResponse.json({ error: 'invalid_provider', message: 'Provider must be github or google.' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: identitiesResponse, error: identitiesError } = await supabase.auth.getUserIdentities()

    if (identitiesError) {
      return NextResponse.json({ error: 'identities_error', message: identitiesError.message }, { status: 500 })
    }

    const identities = identitiesResponse?.identities ?? []
    const targetIdentity = identities.find((identity) => identity.provider === provider)

    if (!targetIdentity) {
      if (provider === 'github') {
        await supabase.from('users').update({ github_token: null, github_user_id: null }).eq('id', user.id)
      }
      return NextResponse.json({ success: true, already_disconnected: true })
    }

    if (identities.length <= 1) {
      return NextResponse.json(
        {
          error: 'primary_identity',
          message: `Cannot disconnect ${provider === 'github' ? 'GitHub' : 'Google'} because this account has no other sign-in method. Add another sign-in first.`,
        },
        { status: 409 }
      )
    }

    const { error: unlinkError } = await supabase.auth.unlinkIdentity(targetIdentity as UserIdentity)

    if (unlinkError) {
      return NextResponse.json({ error: 'unlink_failed', message: unlinkError.message }, { status: 500 })
    }

    if (provider === 'github') {
      const { error: updateError } = await supabase
        .from('users')
        .update({ github_token: null, github_user_id: null })
        .eq('id', user.id)

      if (updateError) {
        return NextResponse.json({ error: 'db_error', message: updateError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
  }
}
