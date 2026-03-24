import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

const POLAR_API_URL = POLAR_IS_SANDBOX 
  ? 'https://sandbox-api.polar.sh/v1' 
  : 'https://api.polar.sh/v1'

export async function POST(req: NextRequest) {
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

    if (userError || !userData?.customer_id) {
      console.error('User subscription lookup error:', userError)
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    // Create Polar billing portal session
    const response = await fetch(`${POLAR_API_URL}/portals`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: userData.customer_id,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Polar portal error:', error, 'Status:', response.status)
      // Provide more specific error messages
      if (response.status === 404) {
        return NextResponse.json({ error: 'Customer not found in Polar', details: 'Your subscription may have expired' }, { status: 500 })
      }
      if (response.status === 403) {
        return NextResponse.json({ error: 'Polar API access denied', details: 'Check Polar API key permissions' }, { status: 500 })
      }
      return NextResponse.json({ error: 'Failed to create portal session', details: error }, { status: 500 })
    }

    const portal = await response.json()

    return NextResponse.json({ 
      url: portal.url,
    })
  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
