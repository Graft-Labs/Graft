import { NextRequest, NextResponse } from 'next/server'
import { Polar } from '@polar-sh/sdk'
import { createServerClient } from '@/lib/supabase-server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

function buildPolarClient() {
  if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') return null
  return new Polar({
    accessToken: POLAR_ACCESS_TOKEN,
    server: POLAR_IS_SANDBOX ? 'sandbox' : 'production',
  })
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 portal requests per minute per IP
  const ip = getClientIp(req)
  if (!checkRateLimit(`portal:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const polar = buildPolarClient()
    if (!polar) {
      return NextResponse.json({ 
        error: 'Payment not configured',
        message: 'Polar.sh is not configured. Please contact support.'
      }, { status: 500 })
    }

    // Get customer_id from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('customer_id, subscription_id')
      .eq('id', user.id)
      .single()

    if (userError) {
      console.error('User lookup error:', userError)
      return NextResponse.json({ error: 'Failed to load account data' }, { status: 500 })
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`

    // Prefer the stored Polar customer_id; fall back to external user ID so
    // the portal works even when the database row is missing customer_id.
    const session = userData?.customer_id
      ? await polar.customerSessions.create({ customerId: userData.customer_id, returnUrl })
      : await polar.customerSessions.create({ externalCustomerId: user.id, returnUrl })

    return NextResponse.json({ url: session.customerPortalUrl })
  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
