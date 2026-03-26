import { NextRequest, NextResponse } from 'next/server'
import { Polar } from '@polar-sh/sdk'
import { createServerClient } from '@/lib/supabase-server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN
const POLAR_ORGANIZATION = process.env.NEXT_PUBLIC_POLAR_ORGANIZATION
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

const POLAR_API_URL = POLAR_IS_SANDBOX 
  ? 'https://sandbox-api.polar.sh/v1' 
  : 'https://api.polar.sh/v1'

const PLAN_PRICES: Record<string, { productId: string; priceId: string; scansLimit: number }> = {
  pro: { productId: process.env.POLAR_PRO_PRODUCT_ID || '', priceId: process.env.POLAR_PRO_PRICE_ID || '', scansLimit: 50 },
  unlimited: { productId: process.env.POLAR_UNLIMITED_PRODUCT_ID || '', priceId: process.env.POLAR_UNLIMITED_PRICE_ID || '', scansLimit: 999999 },
}

function buildPolarClient() {
  if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') return null
  return new Polar({
    accessToken: POLAR_ACCESS_TOKEN,
    server: POLAR_IS_SANDBOX ? 'sandbox' : 'production',
  })
}

const VALID_PLAN_IDS = new Set(Object.keys(PLAN_PRICES))

export async function POST(req: NextRequest) {
  // Rate limit: 20 checkout requests per minute per IP
  const ip = getClientIp(req)
  if (!checkRateLimit(`checkout:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const planId = (body as Record<string, unknown>).planId
    if (typeof planId !== 'string' || !VALID_PLAN_IDS.has(planId)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!POLAR_ACCESS_TOKEN || !POLAR_ORGANIZATION || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') {
      return NextResponse.json({ 
        error: 'Payment not configured',
        message: 'Polar.sh is not configured. Please contact support or set up Polar.sh integration.'
      }, { status: 500 })
    }

    const plan = PLAN_PRICES[planId]
    if (!plan || !plan.productId) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Check if user already has an active subscription - redirect to customer portal for upgrades
    const { data: userData } = await supabase
      .from('users')
      .select('plan, subscription_id, subscription_status, customer_id')
      .eq('id', user.id)
      .single()

    // 'cancelled' means cancel-at-period-end: the subscription is still active in Polar
    // so we must redirect to the portal rather than create a duplicate checkout.
    const hasActiveSubscription = Boolean(userData?.subscription_id) &&
      (userData?.subscription_status === 'active' || userData?.subscription_status === 'cancelled')

    // If user has active subscription, redirect to customer portal for plan upgrades/changes.
    if (hasActiveSubscription) {
      console.log('User has active subscription, creating customer portal session for upgrade', {
        userId: user.id,
        currentPlan: userData?.plan,
        targetPlan: planId,
        hasCustomerId: Boolean(userData?.customer_id),
      })

      const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success`

      // --- Attempt 1: Polar SDK with customerId ---
      try {
        const polar = buildPolarClient()
        if (polar && userData?.customer_id) {
          const session = await polar.customerSessions.create({
            customerId: userData.customer_id,
            returnUrl,
          })
          // SDK returns { ok, value } or plain object depending on version
          const portalUrl =
            (session as Record<string, unknown>).customerPortalUrl as
              | string
              | undefined ??
            ((session as Record<string, unknown>).value as
              | Record<string, unknown>
              | undefined)?.customerPortalUrl as string | undefined ??
            ((session as Record<string, unknown>).value as
              | Record<string, unknown>
              | undefined)?.url as string | undefined

          if (portalUrl) {
            return NextResponse.json({ url: portalUrl, isPortal: true })
          }
        }
      } catch (sdkCustomerErr) {
        console.error('Polar SDK portal (customerId) failed:', sdkCustomerErr)
      }

      // --- Attempt 2: Polar SDK with externalCustomerId ---
      try {
        const polar = buildPolarClient()
        if (polar) {
          const session = await polar.customerSessions.create({
            externalCustomerId: user.id,
            returnUrl,
          })
          const portalUrl =
            (session as Record<string, unknown>).customerPortalUrl as
              | string
              | undefined ??
            ((session as Record<string, unknown>).value as
              | Record<string, unknown>
              | undefined)?.customerPortalUrl as string | undefined ??
            ((session as Record<string, unknown>).value as
              | Record<string, unknown>
              | undefined)?.url as string | undefined

          if (portalUrl) {
            return NextResponse.json({ url: portalUrl, isPortal: true })
          }
        }
      } catch (sdkExtErr) {
        console.error('Polar SDK portal (externalCustomerId) failed:', sdkExtErr)
      }

      // --- Attempt 3: Raw HTTP POST to Polar customer portal sessions API ---
      // Per Polar docs: POST /v1/customer-portal/sessions with customer_id or external_customer_id
      try {
        const portalBody: Record<string, unknown> = userData?.customer_id
          ? { customer_id: userData.customer_id, return_url: returnUrl }
          : { external_customer_id: user.id, return_url: returnUrl }

        const portalResp = await fetch(
          `${POLAR_API_URL}/customer-portal/sessions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(portalBody),
          },
        )

        if (portalResp.ok) {
          const portalData = (await portalResp.json()) as Record<string, unknown>
          const portalUrl =
            (portalData.customer_portal_url as string | undefined) ||
            (portalData.url as string | undefined) ||
            (portalData.customerPortalUrl as string | undefined)

          if (portalUrl) {
            return NextResponse.json({ url: portalUrl, isPortal: true })
          }
        } else {
          console.error(
            'Polar HTTP portal session failed:',
            portalResp.status,
            await portalResp.text(),
          )
        }
      } catch (httpErr) {
        console.error('Polar HTTP portal session error:', httpErr)
      }

      // --- Fallback: All portal attempts failed, create a fresh checkout session ---
      // This avoids the user being stuck with "could not open portal" error.
      console.log('Portal creation failed for active subscriber, falling back to checkout', {
        userId: user.id,
        subscriptionId: userData?.subscription_id,
        customerId: userData?.customer_id,
        targetPlan: planId,
      })
      // Fall through to checkout creation below.
    }

    // No active subscription - create a new checkout session
    const checkoutBody: Record<string, unknown> = {
      products: [plan.productId],
      customer_email: user.email,
      external_customer_id: user.id,
      metadata: {
        user_id: user.id,
        plan: planId,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success&checkout_id={CHECKOUT_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/#pricing`,
    }

    // Add product_id and product_price_id only if priceId is provided (sandbox may not have price IDs)
    if (plan.productId) checkoutBody.product_id = plan.productId
    if (plan.priceId) checkoutBody.product_price_id = plan.priceId

    const response = await fetch(`${POLAR_API_URL}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutBody),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Polar checkout error:', error)
      return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 })
    }

    const checkout = await response.json()

    return NextResponse.json({ 
      url: checkout.url,
      checkoutId: checkout.id
    })
  } catch (error) {
    console.error('Checkout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
