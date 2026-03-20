import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { UserIdentity } from '@supabase/supabase-js'

export async function POST() {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: identitiesResponse } = await supabase.auth.getUserIdentities()
    const identities = identitiesResponse?.identities ?? []
    const githubIdentity = identities.find((identity) => identity.provider === 'github')

    if (githubIdentity) {
      if (identities.length <= 1) {
        return NextResponse.json(
          {
            error: 'primary_identity',
            message:
              'Cannot disconnect GitHub because this account is signed in only with GitHub. Add another sign-in method first.',
          },
          { status: 409 }
        )
      }

      const { error: unlinkError } = await supabase.auth.unlinkIdentity(githubIdentity as UserIdentity)
      if (unlinkError) {
        return NextResponse.json({ error: 'unlink_failed', message: unlinkError.message }, { status: 500 })
      }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ github_token: null, github_user_id: null })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'db_error', message: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
  }
}
