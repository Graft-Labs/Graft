import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Webhook as StandardWebhook, WebhookVerificationError } from 'standardwebhooks'

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

function hasScheduledCancellation(data: Record<string, unknown>): boolean {
  const direct = data.cancel_at_period_end
  const nested =
    (data.subscription as Record<string, unknown> | undefined)
      ?.cancel_at_period_end

  if (direct === true || nested === true) return true

  const status =
    (typeof data.status === 'string' ? data.status : '') ||
    (typeof (data.subscription as Record<string, unknown> | undefined)?.status ===
    'string'
      ? ((data.subscription as Record<string, unknown>).status as string)
      : '')

  const normalizedStatus = status.toLowerCase()
  return normalizedStatus === 'cancelled' || normalizedStatus === 'canceled'
}

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

/**
 * Verify a Polar webhook using the Standard Webhooks specification.
 * Polar signs webhooks using HMAC-SHA256 with headers:
 *   webhook-id, webhook-timestamp, webhook-signature
 * The signature is `v1,<base64(hmac_sha256(secret, "{id}.{ts}.{body}"))>`
 */
function verifyWebhookSignature(
  rawBody: string,
  req: NextRequest,
  secret: string,
): boolean {
  const webhookId = req.headers.get('webhook-id')
  const webhookTimestamp = req.headers.get('webhook-timestamp')
  const webhookSignature = req.headers.get('webhook-signature')

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false
  }

  try {
    // StandardWebhooks expects the secret as base64 of the raw secret bytes.
    const base64Secret = Buffer.from(secret, 'utf-8').toString('base64')
    const wh = new StandardWebhook(base64Secret)
    wh.verify(rawBody, {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': webhookSignature,
    })
    return true
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return false
    }
    throw err
  }
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

    // Verify signature using Standard Webhooks (Polar's signing scheme).
    // Skip in sandbox mode to simplify local/test setup.
    if (!POLAR_IS_SANDBOX && POLAR_WEBHOOK_SECRET && POLAR_WEBHOOK_SECRET !== 'your_polar_webhook_secret_here') {
      const valid = verifyWebhookSignature(rawBody, req, POLAR_WEBHOOK_SECRET)
      if (!valid) {
        console.error('Webhook signature verification failed')
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
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

    // For order/refund events data.id is the order/refund id, not a subscription id.
    // Always prefer data.subscription_id when available.
    const isOrderOrRefundEvent = event.startsWith('order.') || event.startsWith('refund.')
    const isCheckoutEvent = event.startsWith('checkout.')
    const subscriptionId =
      (data.subscription_id as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.id as string | undefined) ||
      ((!isOrderOrRefundEvent && !isCheckoutEvent) ? (data.id as string | undefined) : undefined) ||
      ''

    const status =
      (data.status as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.status as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.state as string | undefined) ||
      'active'
    const cancellationScheduled = hasScheduledCancellation(data)

    const customerEmail =
      (data.customer_email as string | undefined) ||
      ((data.customer as Record<string, unknown> | undefined)?.email as string | undefined) ||
      (data.email as string | undefined)

    const customerId =
      (data.customer_id as string | undefined) ||
      ((data.customer as Record<string, unknown> | undefined)?.id as string | undefined) ||
      ((data.subscription as Record<string, unknown> | undefined)?.customer_id as string | undefined)

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

    // Fallback 1: use customer.external_id (set via external_customer_id on checkout)
    if (!userId) {
      const externalId = (data.customer as Record<string, unknown> | undefined)?.external_id as string | undefined
      if (externalId?.trim()) {
        userId = externalId.trim()
      }
    }

    // Fallback 2: email lookup in users table
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
      .select('plan, subscription_id, subscription_status, customer_id, email')
      .eq('id', userId)
      .maybeSingle()

    console.log(`Existing user state: plan=${existingUser?.plan}, subId=${existingUser?.subscription_id}, subStatus=${existingUser?.subscription_status}`)

    // Idempotency: skip if this exact subscription + normalized status is already recorded.
    // Use our normalized status values ('active'/'cancelled') for comparison.
    const incomingNormalizedStatus = cancellationScheduled ? 'cancelled' : (status || 'active')
    if (
      subscriptionId &&
      existingUser?.subscription_id === subscriptionId &&
      existingUser?.subscription_status === incomingNormalizedStatus
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
      case 'order.updated': {
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

        // For order events without a linked subscription (one-time orders), skip plan changes.
        if (isOrderOrRefundEvent && !subscriptionId) {
          console.log(`Skipping plan update for order event without subscription_id`)
          break
        }

        // Fall back to existing plan to avoid accidental downgrades, then 'pro' as last resort.
        const resolvedPlan = planId || existingUser?.plan || (hasSubscription ? 'pro' : 'free')
        const scansLimit = PLAN_SCANS_LIMITS[resolvedPlan] ?? 50

        // Use upsert so the update works even if the users row doesn't exist yet
        // (e.g. email/password users who haven't visited the dashboard).
        // For existing rows: all specified fields are merged. scans_used is only
        // set on INSERT (new rows) to avoid resetting usage for existing users.
        const upsertPayload: Record<string, unknown> = {
          id: userId,
          email: resolvedCustomerEmail || existingUser?.email || null,
          plan: resolvedPlan,
          scans_limit: scansLimit,
          subscription_id: subscriptionId || existingUser?.subscription_id,
          subscription_status: cancellationScheduled ? 'cancelled' : 'active',
          customer_id: customerId || existingUser?.customer_id,
          updated_at: new Date().toISOString(),
        }
        if (!existingUser) {
          upsertPayload.scans_used = 0
        }

        const { error } = await supabase
          .from('users')
          .upsert(upsertPayload, { onConflict: 'id' })

        if (error) {
          console.error('Failed to update user plan:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`✅ User ${userId} upgraded to ${resolvedPlan} (scans_limit: ${scansLimit})`)
        break
      }

      case 'subscription.cancelled':
      case 'subscription.canceled': {
        // Canceled means "cancel at period end" - keep current plan, only update status.
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

        if (!existingUser) {
          console.warn(`Received ${event} for user ${userId} with no existing DB row — skipping status-only update`)
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

      case 'subscription.uncanceled': {
        // User reversed cancellation - restore active status.
        if (
          subscriptionId &&
          existingUser?.subscription_id &&
          existingUser.subscription_id !== subscriptionId
        ) {
          console.log(
            `Ignoring uncancel for non-current subscription ${subscriptionId} (current: ${existingUser.subscription_id})`
          )
          break
        }

        if (!existingUser) {
          console.warn(`Received ${event} for user ${userId} with no existing DB row — skipping status-only update`)
          break
        }

        const { error } = await supabase
          .from('users')
          .update({
            subscription_status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to mark subscription as active after uncancel:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} uncancel - subscription restored to active`)
        break
      }

      case 'subscription.past_due': {
        // Payment failed but subscription not yet revoked - keep plan, update status only.
        if (
          subscriptionId &&
          existingUser?.subscription_id &&
          existingUser.subscription_id !== subscriptionId
        ) {
          break
        }

        if (!existingUser) {
          console.warn(`Received ${event} for user ${userId} with no existing DB row — skipping status-only update`)
          break
        }

        const { error } = await supabase
          .from('users')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (error) {
          console.error('Failed to mark subscription as past_due:', error)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        console.log(`User ${userId} subscription marked past_due`)
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

        if (!existingUser) {
          console.warn(`Received ${event} for user ${userId} with no existing DB row — skipping downgrade`)
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
        // Handle any future subscription events generically, but skip checkout events
        // (checkout.created/updated fire before payment is confirmed).
        if (event.startsWith('subscription.') || event.startsWith('order.')) {
          const resolvedPlan = planId || existingUser?.plan || (hasSubscription ? 'pro' : 'free')
          const scansLimit = PLAN_SCANS_LIMITS[resolvedPlan] ?? 50

          const genericUpsertPayload: Record<string, unknown> = {
            id: userId,
            email: resolvedCustomerEmail || existingUser?.email || null,
            plan: resolvedPlan,
            scans_limit: scansLimit,
            subscription_id: subscriptionId || existingUser?.subscription_id,
            subscription_status: cancellationScheduled ? 'cancelled' : incomingNormalizedStatus,
            customer_id: customerId || existingUser?.customer_id,
            updated_at: new Date().toISOString(),
          }
          if (!existingUser) {
            genericUpsertPayload.scans_used = 0
          }

          const { error } = await supabase
            .from('users')
            .upsert(genericUpsertPayload, { onConflict: 'id' })

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
