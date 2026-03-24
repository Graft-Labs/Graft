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

    // Create Polar checkout session
    const checkoutBody: Record<string, unknown> = {
      products: [plan.productId],
      customer_email: user.email,
      metadata: {
        user_id: user.id,
        plan: planId,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgrade=success`,
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
