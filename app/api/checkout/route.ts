import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN
const POLAR_ORGANIZATION = process.env.NEXT_PUBLIC_POLAR_ORGANIZATION

const PLAN_PRICES: Record<string, { priceId: string; scansLimit: number }> = {
  pro: { priceId: 'pro_monthly_price_id', scansLimit: 30 },
  unlimited: { priceId: 'unlimited_monthly_price_id', scansLimit: 999999 },
  lifetime: { priceId: 'lifetime_price_id', scansLimit: 999999 },
}

export async function POST(req: NextRequest) {
  try {
    const { planId, userId, email } = await req.json()

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!POLAR_ACCESS_TOKEN || !POLAR_ORGANIZATION || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') {
      return NextResponse.json({ 
        error: 'Payment not configured',
        message: 'Polar.sh is not configured. Please contact support or set up Polar.sh integration.'
      }, { status: 500 })
    }

    const plan = PLAN_PRICES[planId]
    if (!plan) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Create Polar checkout session
    const response = await fetch('https://api.polar.sh/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [{ price_id: plan.priceId, quantity: 1 }],
        customer_email: email,
        metadata: {
          user_id: userId,
          plan: planId,
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgrade=success`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?upgrade=cancelled`,
      }),
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
