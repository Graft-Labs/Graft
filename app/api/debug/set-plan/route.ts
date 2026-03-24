import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = SUPABASE_URL && SUPABASE_SECRET_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
  : null

export async function POST(req: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const body = await req.json()
    const { user_id, plan, scans_limit, email } = body

    let targetUserId = user_id

    // If email provided but no user_id, look up user by email
    if (!targetUserId && email) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id')
        .ilike('email', email)
        .maybeSingle()
      
      if (!userByEmail?.id) {
        return NextResponse.json({ error: 'User not found with that email' }, { status: 404 })
      }
      targetUserId = userByEmail.id
    }

    if (!targetUserId || !plan) {
      return NextResponse.json({ error: 'Missing user_id/email or plan' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      plan,
      updated_at: new Date().toISOString(),
    }

    if (scans_limit !== undefined) {
      updates.scans_limit = scans_limit
    } else if (plan === 'pro') {
      updates.scans_limit = 50
    } else if (plan === 'unlimited') {
      updates.scans_limit = 999999
    } else {
      updates.scans_limit = 3
    }

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', targetUserId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, plan, scans_limit: updates.scans_limit })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
