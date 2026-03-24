import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

interface PolarWebhookPayload {
  event: string
  data: Record<string, unknown>
}

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
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

    // Skip signature verification in sandbox mode (for testing)
    if (!POLAR_IS_SANDBOX && POLAR_WEBHOOK_SECRET && POLAR_WEBHOOK_SECRET !== 'your_polar_webhook_secret_here') {
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
    const { event } = payload
    const data = (payload.data ?? {}) as Record<string, unknown>

    const metadata = (
      (data.metadata as Record<string, unknown> | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined) ||
      ((data.customer as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined) ||
      ((data.checkout as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined)
    )

    const subscriptionId =
      (data.id as string | undefined) ||
      (data.subscription_id as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.id as string | undefined) ||
      ''

    const status =
      (data.status as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.status as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.state as string | undefined) ||
      'active'

    const customerEmail =
      (data.customer_email as string | undefined) ||
      ((data.customer as Record<string, unknown> | undefined)?.email as string | undefined) ||
      (data.email as string | undefined)

    const detectedProductIds = new Set<string>()
    const productIdFromData = data.product_id as string | undefined
    const productIdFromProduct = ((data.product as Record<string, unknown> | undefined)?.id as string | undefined)
    const productIdFromSubscription = ((data.subscription as Record<string, unknown> | undefined)?.product_id as string | undefined)
    if (productIdFromData) detectedProductIds.add(productIdFromData)
    if (productIdFromProduct) detectedProductIds.add(productIdFromProduct)
    if (productIdFromSubscription) detectedProductIds.add(productIdFromSubscription)

    const products = data.products as Array<Record<string, unknown>> | undefined
    products?.forEach((product) => {
      const id = (product.id as string | undefined) || (product.product_id as string | undefined)
      if (id) detectedProductIds.add(id)
    })

    const items = data.items as Array<Record<string, unknown>> | undefined
    items?.forEach((item) => {
      const id = (item.product_id as string | undefined) || ((item.product as Record<string, unknown> | undefined)?.id as string | undefined)
      if (id) detectedProductIds.add(id)
    })

    const proProductId = process.env.POLAR_PRO_PRODUCT_ID
    const unlimitedProductId = process.env.POLAR_UNLIMITED_PRODUCT_ID

    let planId = (metadata?.plan as string | undefined) || undefined
    if (!planId) {
      if (proProductId && detectedProductIds.has(proProductId)) {
        planId = 'pro'
      } else if (unlimitedProductId && detectedProductIds.has(unlimitedProductId)) {
        planId = 'unlimited'
      }
    }

    let userId = (metadata?.user_id as string | undefined) || undefined
    if (!userId && customerEmail) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id')
        .eq('email', customerEmail)
        .maybeSingle()
      userId = userByEmail?.id
    }

    if (!userId) {
      console.error('Webhook user resolution failed', { event, customerEmail })
      return NextResponse.json({ error: 'No user mapping found' }, { status: 400 })
    }

    // Basic idempotency guard: if event already applied, skip duplicate side effects.
    const { data: existingUser } = await supabase
      .from('users')
      .select('plan, subscription_id, subscription_status')
      .eq('id', userId)
      .single()

    if (
      existingUser?.subscription_id === subscriptionId &&
      existingUser?.subscription_status === status
    ) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Handle different event types
    switch (event) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'order.created':
      case 'order.paid':
      case 'checkout.created':
      case 'checkout.updated': {
        const resolvedPlan = planId || existingUser?.plan || 'pro'
        const scansLimit = PLAN_SCANS_LIMITS[resolvedPlan] ?? 50
        
        const { error } = await supabase
          .from('users')
          .update({
            plan: resolvedPlan,
            scans_limit: scansLimit,
            subscription_id: subscriptionId || existingUser?.subscription_id,
            subscription_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to update user plan:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} upgraded to ${resolvedPlan}`)
        break
      }

      case 'subscription.cancelled':
      case 'subscription.canceled':
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
