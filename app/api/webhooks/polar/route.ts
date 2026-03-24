import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = SUPABASE_URL && SUPABASE_SECRET_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
  : null

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET
const POLAR_IS_SANDBOX = process.env.POLAR_IS_SANDBOX === 'true'

interface PolarWebhookPayload {
  event?: string
  type?: string
  data: Record<string, unknown>
}

const PLAN_SCANS_LIMITS: Record<string, number> = {
  pro: 50,
  unlimited: 999999,
}

type HitWindow = { count: number; resetAt: number }
const webhookHits = new Map<string, HitWindow>()
const WEBHOOK_LIMIT_PER_MINUTE = 120

function findStringsByKeys(input: unknown, keys: Set<string>, out: string[] = []): string[] {
  if (!input) return out
  if (Array.isArray(input)) {
    for (const item of input) findStringsByKeys(item, keys, out)
    return out
  }
  if (typeof input !== 'object') return out

  const obj = input as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (keys.has(k) && typeof v === 'string' && v.trim()) {
      out.push(v.trim())
    }
    if (v && typeof v === 'object') {
      findStringsByKeys(v, keys, out)
    }
  }
  return out
}

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
    if (!supabase) {
      console.error('Webhook misconfigured: missing Supabase env vars')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

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
    const event = (payload.event || payload.type || '').toLowerCase().trim()
    const data = (payload.data ?? {}) as Record<string, unknown>

    if (!event) {
      console.error('Webhook missing event/type field', {
        topLevelKeys: Object.keys(payload || {}),
      })
      return NextResponse.json({ error: 'Invalid webhook payload: missing event type' }, { status: 400 })
    }

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

    const deepEmails = findStringsByKeys(data, new Set(['customer_email', 'email']))
    const resolvedCustomerEmail = (customerEmail || deepEmails[0] || '').trim().toLowerCase() || undefined

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
    if (!planId && proProductId && rawBody.includes(proProductId)) {
      planId = 'pro'
    }
    if (!planId && unlimitedProductId && rawBody.includes(unlimitedProductId)) {
      planId = 'unlimited'
    }
    if (!planId) {
      if (proProductId && detectedProductIds.has(proProductId)) {
        planId = 'pro'
      } else if (unlimitedProductId && detectedProductIds.has(unlimitedProductId)) {
        planId = 'unlimited'
      }
    }

    let userId = (metadata?.user_id as string | undefined) || undefined
    if (!userId && resolvedCustomerEmail) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id')
        .ilike('email', resolvedCustomerEmail)
        .maybeSingle()
      userId = userByEmail?.id
    }

    if (!userId) {
      console.error('Webhook user resolution failed', {
        event,
        customerEmail: resolvedCustomerEmail,
        hasMetadata: Boolean(metadata),
        metadataKeys: metadata ? Object.keys(metadata) : [],
        detectedProductIds: Array.from(detectedProductIds),
        rawEmail: customerEmail,
        deepEmails,
      })
      return NextResponse.json({ error: 'No user mapping found' }, { status: 400 })
    }

    const hasSubscription = subscriptionId && subscriptionId.trim().length > 0
    console.log(`Webhook ${event} - resolved user: ${userId}, email: ${resolvedCustomerEmail}, planId: ${planId}, subscriptionId: "${subscriptionId}", hasSubscription: ${hasSubscription}, status: ${status}, detectedProductIds: ${JSON.stringify(Array.from(detectedProductIds))}, envProId: ${proProductId}, envUnlimitedId: ${unlimitedProductId}`)

    // Basic idempotency guard: if event already applied, skip duplicate side effects.
    const { data: existingUser } = await supabase
      .from('users')
      .select('plan, subscription_id, subscription_status')
      .eq('id', userId)
      .single()

    console.log(`Existing user state: plan=${existingUser?.plan}, subId=${existingUser?.subscription_id}, subStatus=${existingUser?.subscription_status}`)

    if (
      existingUser?.subscription_id === subscriptionId &&
      existingUser?.subscription_status === status
    ) {
      console.log(`⏭️ Skipping duplicate webhook for user ${userId}`)
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Handle different event types
    switch (event) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.active':
      case 'order.created':
      case 'order.paid':
      case 'order.updated':
      case 'checkout.created':
      case 'checkout.updated': {
        if (
          subscriptionId &&
          existingUser?.subscription_id &&
          existingUser.subscription_id !== subscriptionId
        ) {
          const downStatus = status.toLowerCase()
          if (
            downStatus.includes('cancel') ||
            downStatus.includes('expired') ||
            downStatus.includes('revoke') ||
            downStatus.includes('refund') ||
            downStatus.includes('past_due')
          ) {
            console.log(
              `Ignoring status ${status} for non-current subscription ${subscriptionId} (current: ${existingUser.subscription_id})`
            )
            break
          }
        }

        // If planId couldn't be resolved but we have a subscription event, assume 'pro'
        // subscriptionId could be empty string '', so we check for truthy non-empty value
        const hasSubscription = subscriptionId && subscriptionId.trim().length > 0
        const resolvedPlan = planId || (hasSubscription ? 'pro' : existingUser?.plan) || 'pro'
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

        console.log(`✅ User ${userId} upgraded to ${resolvedPlan} (scans_limit: ${scansLimit})`)
        break
      }

      case 'subscription.cancelled':
      case 'subscription.canceled': {
        // Important: canceled usually means "cancel at period end", not immediate loss of access.
        // Keep current plan/limits and only update subscription status.
        if (
          subscriptionId &&
          existingUser?.subscription_id &&
          existingUser.subscription_id !== subscriptionId
        ) {
          console.log(
            `Ignoring cancellation for non-current subscription ${subscriptionId} (current: ${existingUser.subscription_id})`
          )
          break
        }

        const { error } = await supabase
          .from('users')
          .update({
            subscription_status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to mark subscription as cancelled:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} marked cancelled (plan retained)`)
        break
      }

      case 'subscription.expired':
      case 'subscription.revoked':
      case 'order.refunded':
      case 'refund.created':
      case 'refund.updated': {
        // Only downgrade if this event applies to the user's active subscription.
        if (
          subscriptionId &&
          existingUser?.subscription_id &&
          existingUser.subscription_id !== subscriptionId
        ) {
          console.log(
            `Ignoring downgrade for non-current subscription ${subscriptionId} (current: ${existingUser.subscription_id})`
          )
          break
        }

        const { error } = await supabase
          .from('users')
          .update({
            plan: 'free',
            scans_limit: 3,
            subscription_status: event.includes('refund') ? 'refunded' : 'cancelled',
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
        if (
          event.startsWith('subscription.') ||
          event.startsWith('order.') ||
          event.startsWith('checkout.')
        ) {
          // If planId couldn't be resolved but we have a subscription event, assume 'pro'
          const hasSubscription = subscriptionId && subscriptionId.trim().length > 0
          const resolvedPlan = planId || (hasSubscription ? 'pro' : existingUser?.plan) || 'pro'
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
            console.error('Failed to update user plan in generic webhook handler:', error)
            return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
          }

          console.log(`User ${userId} updated from generic handler for event ${event} to ${resolvedPlan}`)
          break
        }

        console.log(`Unhandled webhook event: ${event}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
