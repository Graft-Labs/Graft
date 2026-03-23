import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET

interface PolarWebhookPayload {
  event: string
  data: {
    id: string
    customer_email?: string
    metadata?: {
      user_id?: string
      plan?: string
    }
    status?: string
    created_at?: string
  }
}

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
  lifetime: 999999,
}

type HitWindow = { count: number; resetAt: number }
const webhookHits = new Map<string, HitWindow>()
const WEBHOOK_LIMIT_PER_MINUTE = 120

function allowWebhookRequest(ip: string): boolean {
  const now = Date.now()
  const current = webhookHits.get(ip)

  if (!current || now > current.resetAt) {
    webhookHits.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }

  if (current.count >= WEBHOOK_LIMIT_PER_MINUTE) {
    return false
  }

  current.count += 1
  webhookHits.set(ip, current)
  return true
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!allowWebhookRequest(ip)) {
      return NextResponse.json({ error: 'Too many webhook requests' }, { status: 429 })
    }

    const rawBody = await req.text()
    const signature = req.headers.get('polar-signature')

    // Verify webhook signature
    if (POLAR_WEBHOOK_SECRET && POLAR_WEBHOOK_SECRET !== 'your_polar_webhook_secret_here') {
      if (!signature) {
        return NextResponse.json({ error: 'No signature' }, { status: 401 })
      }

      const expectedSignature = crypto
        .createHmac('sha256', POLAR_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex')

      if (!timingSafeEqual(signature, expectedSignature)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const payload: PolarWebhookPayload = JSON.parse(rawBody)
    const { event, data } = payload

    const userId = data.metadata?.user_id
    const planId = data.metadata?.plan

    if (!userId) {
      console.error('No user_id in webhook metadata')
      return NextResponse.json({ error: 'No user_id' }, { status: 400 })
    }

    // Basic idempotency guard: if event already applied, skip duplicate side effects.
    const { data: existingUser } = await supabase
      .from('users')
      .select('subscription_id, subscription_status')
      .eq('id', userId)
      .single()

    if (existingUser?.subscription_id === data.id && existingUser?.subscription_status === (data.status || existingUser.subscription_status)) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Handle different event types
    switch (event) {
      case 'subscription.created':
      case 'subscription.updated': {
        const scansLimit = planId ? (PLAN_SCANS_LIMITS[planId] ?? 30) : 30
        
        const { error } = await supabase
          .from('users')
          .update({
            plan: planId || 'pro',
            scans_limit: scansLimit,
            subscription_id: data.id,
            subscription_status: data.status || 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to update user plan:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} upgraded to ${planId}`)
        break
      }

      case 'subscription.cancelled':
      case 'subscription.expired': {
        const { error } = await supabase
          .from('users')
          .update({
            plan: 'free',
            scans_limit: 3,
            subscription_status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to downgrade user:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} downgraded to free`)
        break
      }

      default:
        console.log(`Unhandled webhook event: ${event}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
