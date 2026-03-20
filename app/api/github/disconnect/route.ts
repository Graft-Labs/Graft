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

    const { error: updateError } = await supabase
      .from('users')
      .update({ github_token: null, github_user_id: null })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'db_error', message: updateError.message }, { status: 500 })
    }

    const { data: identity } = await supabase
      .from('identities')
      .select('id, user_id, provider')
      .eq('provider', 'github')
      .eq('user_id', user.id)
      .single()

    if (identity) {
      await supabase.auth.unlinkIdentity(identity as unknown as UserIdentity)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
  }
}
