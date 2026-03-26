import { NextRequest, NextResponse } from 'next/server'
import { Polar } from '@polar-sh/sdk'
import { createServerClient } from '@/lib/supabase-server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

const POLAR_API_URL = POLAR_IS_SANDBOX
  ? 'https://sandbox-api.polar.sh/v1'
  : 'https://api.polar.sh/v1'

function buildPolarClient() {
  if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') return null
  return new Polar({
    accessToken: POLAR_ACCESS_TOKEN,
    server: POLAR_IS_SANDBOX ? 'sandbox' : 'production',
  })
}

function extractPortalUrl(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const obj = session as Record<string, unknown>

  // Direct fields
  const direct =
    (obj.customerPortalUrl as string | undefined) ||
    (obj.customer_portal_url as string | undefined) ||
    (obj.url as string | undefined)

  if (direct) return direct

  // Nested in .value (SDK ok/value pattern)
  const value = obj.value as Record<string, unknown> | undefined
  if (value) {
    return (
      (value.customerPortalUrl as string | undefined) ||
      (value.customer_portal_url as string | undefined) ||
      (value.url as string | undefined) ||
      null
    )
  }

  return null
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

    if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') {
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

    // --- Attempt 1: SDK with customerId ---
    try {
      const polar = buildPolarClient()
      if (polar && userData?.customer_id) {
        const session = await polar.customerSessions.create({
          customerId: userData.customer_id,
          returnUrl,
        })
        const portalUrl = extractPortalUrl(session)
        if (portalUrl) {
          return NextResponse.json({ url: portalUrl })
        }
      }
    } catch (sdkErr1) {
      console.error('Portal SDK (customerId) failed:', sdkErr1)
    }

    // --- Attempt 2: SDK with externalCustomerId ---
    try {
      const polar = buildPolarClient()
      if (polar) {
        const session = await polar.customerSessions.create({
          externalCustomerId: user.id,
          returnUrl,
        })
        const portalUrl = extractPortalUrl(session)
        if (portalUrl) {
          return NextResponse.json({ url: portalUrl })
        }
      }
    } catch (sdkErr2) {
      console.error('Portal SDK (externalCustomerId) failed:', sdkErr2)
    }

    // --- Attempt 3: Raw HTTP ---
    try {
      const portalBody: Record<string, unknown> = userData?.customer_id
        ? { customer_id: userData.customer_id, return_url: returnUrl }
        : { external_customer_id: user.id, return_url: returnUrl }

      const resp = await fetch(`${POLAR_API_URL}/customer-portal/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(portalBody),
      })

      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>
        const portalUrl =
          (data.customer_portal_url as string | undefined) ||
          (data.url as string | undefined) ||
          (data.customerPortalUrl as string | undefined)

        if (portalUrl) {
          return NextResponse.json({ url: portalUrl })
        }
      } else {
        console.error('Portal HTTP failed:', resp.status, await resp.text())
      }
    } catch (httpErr) {
      console.error('Portal HTTP error:', httpErr)
    }

    return NextResponse.json({
      error: 'Failed to open billing portal',
      message: 'Could not open billing portal. Please try upgrading again or contact support.',
    }, { status: 500 })
  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
