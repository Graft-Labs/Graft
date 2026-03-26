import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

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

export async function POST(req: NextRequest) {
  try {
    const { planId } = await req.json()

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

    // If user has active subscription, always send them to the billing portal for upgrades
    if (hasActiveSubscription) {
      console.log('User has active subscription, attempting portal session for upgrade')
      
      let customerId = userData?.customer_id

      // If customer_id is missing from database, try to fetch it from Polar using subscription_id
      if (!customerId && userData?.subscription_id) {
        console.log('customer_id missing, fetching from Polar using subscription_id:', userData.subscription_id)
        
        const subResponse = await fetch(`${POLAR_API_URL}/subscriptions/${userData.subscription_id}`, {
          headers: {
            'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        })

        if (subResponse.ok) {
          const subData = await subResponse.json()
          customerId = subData.customer_id
          console.log('Fetched customer_id from Polar:', customerId)

          // Optionally update the database with the fetched customer_id
          if (customerId) {
            await supabase
              .from('users')
              .update({ customer_id: customerId })
              .eq('id', user.id)
          }
        } else {
          console.error('Failed to fetch subscription from Polar:', await subResponse.text())
        }
      }

      // If we still don't have customer_id, do not create a new checkout.
      // Polar will reject it with "already have an active subscription".
      if (!customerId) {
        console.error('No customer_id available for active subscription user')
        return NextResponse.json(
          {
            error: 'Active subscription found',
            message: 'You already have an active subscription. Please manage upgrades in billing.'
          },
          { status: 409 }
        )
      } else {
        const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success`

        const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
          {
            url: `${POLAR_API_URL}/customer/sessions`,
            body: { customer_id: customerId, return_url: returnUrl },
          },
          {
            url: `${POLAR_API_URL}/customer/sessions`,
            body: { customer_id: customerId, redirect_url: returnUrl },
          },
          {
            url: `${POLAR_API_URL}/customer-sessions`,
            body: { customer_id: customerId, return_url: returnUrl },
          },
          {
            url: `${POLAR_API_URL}/customer-sessions`,
            body: { customer_id: customerId, redirect_url: returnUrl },
          },
          {
            url: `${POLAR_API_URL}/portals`,
            body: { customer_id: customerId, return_url: returnUrl },
          },
          {
            url: `${POLAR_API_URL}/customers/${customerId}/portal-session`,
            body: { return_url: returnUrl },
          },
        ]

        for (const attempt of attempts) {
          const portalResponse = await fetch(attempt.url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(attempt.body),
          })

          if (!portalResponse.ok) {
            const errorText = await portalResponse.text()
            console.error('Polar portal attempt failed:', attempt.url, portalResponse.status, errorText)
            continue
          }

          const portal = await portalResponse.json()
          const portalUrl = portal?.url || portal?.customer_portal_url || portal?.portal_url || portal?.session_url

          if (portalUrl) {
            return NextResponse.json({
              url: portalUrl,
              isPortal: true,
            })
          }

          console.error('Polar portal attempt succeeded without URL:', attempt.url, portal)
        }

        return NextResponse.json(
          {
            error: 'Failed to open billing portal',
            message: 'Could not open billing portal for your active subscription.'
          },
          { status: 500 }
        )
      }
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
