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

const PLAN_PRODUCT_MAP: Record<string, string> = {}
if (process.env.POLAR_PRO_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_PRO_PRODUCT_ID] = 'pro'
if (process.env.POLAR_UNLIMITED_PRODUCT_ID) PLAN_PRODUCT_MAP[process.env.POLAR_UNLIMITED_PRODUCT_ID] = 'unlimited'

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing'])

const FREE_PLAN = 'free'
const FREE_SCANS_LIMIT = 3

function buildPolarClient() {
  if (!POLAR_ACCESS_TOKEN || POLAR_ACCESS_TOKEN === 'your_polar_access_token_here') return null
  return new Polar({
    accessToken: POLAR_ACCESS_TOKEN,
    server: POLAR_IS_SANDBOX ? 'sandbox' : 'production',
  })
}

type PolarSubscription = Record<string, unknown>

function extractPortalUrl(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const obj = session as Record<string, unknown>
  const direct =
    (obj.customerPortalUrl as string | undefined) ||
    (obj.customer_portal_url as string | undefined) ||
    (obj.url as string | undefined)
  if (direct) return direct
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

function findBestSubscription(subs: PolarSubscription[]): PolarSubscription | null {
  if (!subs.length) return null
  // Prefer active/trialing
  const active = subs.find((s) => {
    const st = typeof s.status === 'string' ? s.status.toLowerCase() : ''
    return st === 'active' || st === 'trialing'
  })
  if (active) return active
  // Then cancelled (cancel-at-period-end is still active in Polar)
  const cancelled = subs.find((s) => {
    const st = typeof s.status === 'string' ? s.status.toLowerCase() : ''
    return st === 'cancelled' || st === 'canceled'
  })
  if (cancelled) return cancelled
  return subs[0]
}

function getPlanFromSubscription(sub: PolarSubscription): string | null {
  const productId =
    (sub.product_id as string | undefined) ||
    ((sub.product as Record<string, unknown> | undefined)?.id as string | undefined)
  if (productId && PLAN_PRODUCT_MAP[productId]) return PLAN_PRODUCT_MAP[productId]
  const items = sub.items as Array<Record<string, unknown>> | undefined
  if (Array.isArray(items)) {
    for (const item of items) {
      const id =
        (item.product_id as string | undefined) ||
        ((item.product as Record<string, unknown> | undefined)?.id as string | undefined)
      if (id && PLAN_PRODUCT_MAP[id]) return PLAN_PRODUCT_MAP[id]
    }
  }
  return null
}

/** Extract subscription list from various Polar response shapes */
function extractSubscriptions(payload: Record<string, unknown>): PolarSubscription[] {
  const direct = payload.subscriptions
  if (Array.isArray(direct)) return direct as PolarSubscription[]
  const cs = payload.customer_state as Record<string, unknown> | undefined
  const nested = cs?.subscriptions
  if (Array.isArray(nested)) return nested as PolarSubscription[]
  const data = payload.data
  if (Array.isArray(data)) return data as PolarSubscription[]
  return []
}

async function clearStaleBillingState(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string) {
  await supabase
    .from('users')
    .update({
      plan: FREE_PLAN,
      scans_limit: FREE_SCANS_LIMIT,
      subscription_id: null,
      subscription_status: 'inactive',
      customer_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
}

const VALID_PLAN_IDS = new Set(Object.keys(PLAN_PRICES))

export async function POST(req: NextRequest) {
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

    // Read user row from DB
    const { data: userData } = await supabase
      .from('users')
      .select('plan, subscription_id, subscription_status, customer_id')
      .eq('id', user.id)
      .maybeSingle()

    // -----------------------------------------------------------
    // Step 1: Determine if user has an active subscription.
    // Check our DB first, then verify against Polar if uncertain.
    // -----------------------------------------------------------
    let hasActiveSubscription =
      Boolean(userData?.subscription_id) &&
      ACTIVE_SUB_STATUSES.has(userData?.subscription_status ?? '')

    let resolvedCustomerId: string | null = userData?.customer_id ?? null
    let resolvedSubscriptionId: string | null = userData?.subscription_id ?? null
    let resolvedPlan: string | null = userData?.plan ?? null

    // If DB says no active subscription, double-check with Polar
    // using external customer ID (Supabase user ID set on checkout).
    if (!hasActiveSubscription) {
      const stateResp = await fetch(
        `${POLAR_API_URL}/customers/external/${encodeURIComponent(user.id)}/state`,
        {
          headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        },
      )

      if (stateResp.ok) {
        const statePayload = (await stateResp.json()) as Record<string, unknown>
        const subs = extractSubscriptions(statePayload)
        const picked = findBestSubscription(subs)

        if (picked) {
          const pickedStatus = typeof picked.status === 'string' ? picked.status.toLowerCase() : ''
          if (ACTIVE_SUB_STATUSES.has(pickedStatus)) {
            hasActiveSubscription = true
            resolvedSubscriptionId = (picked.id as string | undefined) || resolvedSubscriptionId
            resolvedCustomerId =
              (picked.customer_id as string | undefined) ||
              ((statePayload.customer as Record<string, unknown> | undefined)?.id as string | undefined) ||
              ((statePayload.customer_state as Record<string, unknown> | undefined)?.customer_id as string | undefined) ||
              resolvedCustomerId
            resolvedPlan = getPlanFromSubscription(picked) || resolvedPlan

            // Persist what we learned so next time it's faster
            await supabase
              .from('users')
              .update({
                subscription_id: resolvedSubscriptionId,
                subscription_status: ACTIVE_SUB_STATUSES.has(pickedStatus)
                  ? (pickedStatus === 'active' || pickedStatus === 'trialing' ? 'active' : 'cancelled')
                  : 'active',
                customer_id: resolvedCustomerId,
                plan: resolvedPlan || userData?.plan || 'pro',
                scans_limit: PLAN_PRICES[resolvedPlan || 'pro']?.scansLimit ?? 50,
                updated_at: new Date().toISOString(),
              })
              .eq('id', user.id)
          }
        }
      } else if (stateResp.status === 404 && (resolvedCustomerId || resolvedSubscriptionId)) {
        console.warn('billing.stale_state.cleared_from_external_lookup', {
          userId: user.id,
          status: stateResp.status,
          hadCustomerId: Boolean(resolvedCustomerId),
          hadSubscriptionId: Boolean(resolvedSubscriptionId),
        })
        await clearStaleBillingState(supabase, user.id)
        resolvedCustomerId = null
        resolvedSubscriptionId = null
        resolvedPlan = FREE_PLAN
      }
    }

    // -----------------------------------------------------------
    // Step 2: If user has active subscription, upgrade or open portal
    // -----------------------------------------------------------
    if (hasActiveSubscription) {
      let shouldForceFreshCheckout = false

      console.log('User has active subscription', {
        userId: user.id,
        currentPlan: resolvedPlan,
        targetPlan: planId,
        customerId: resolvedCustomerId,
        subscriptionId: resolvedSubscriptionId,
      })

      // Attempt 0: Create a checkout for the upgrade so the user confirms payment.
      // Using a checkout (not a direct PATCH) ensures billing is collected properly
      // and the user explicitly confirms the plan change before it takes effect.
      if (resolvedSubscriptionId && planId !== resolvedPlan) {
        const upgradeCheckoutBody: Record<string, unknown> = {
          products: [plan.productId],
          subscription_id: resolvedSubscriptionId,
          metadata: {
            user_id: user.id,
            plan: planId,
          },
          success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success&target_plan=${planId}&checkout_id={CHECKOUT_ID}`,
          return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
        }

        if (plan.productId) upgradeCheckoutBody.product_id = plan.productId
        if (plan.priceId) upgradeCheckoutBody.product_price_id = plan.priceId

        // Important: pass subscription_id for plan changes on an existing subscription.
        // Creating a checkout with only customer_id can be interpreted as a new
        // subscription attempt and trigger "already active subscription" errors.

        try {
          const upgradeCheckoutResp = await fetch(`${POLAR_API_URL}/checkouts`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(upgradeCheckoutBody),
          })

          if (upgradeCheckoutResp.ok) {
            const upgradeCheckout = (await upgradeCheckoutResp.json()) as Record<string, unknown>
            if (upgradeCheckout.url) {
              return NextResponse.json({
                url: upgradeCheckout.url as string,
                checkoutId: upgradeCheckout.id as string,
              })
            }
          } else {
            const errBody = await upgradeCheckoutResp.text()
            console.error('Upgrade checkout creation failed, will try portal:', upgradeCheckoutResp.status, errBody)
            console.error('billing.upgrade_checkout.request_context', {
              userId: user.id,
              subscriptionId: resolvedSubscriptionId,
              customerId: resolvedCustomerId,
              targetPlan: planId,
            })

            const customerMissing =
              upgradeCheckoutResp.status === 422 &&
              (errBody.includes('Customer does not exist') || errBody.includes('customer_id'))

            if (customerMissing) {
              console.warn('billing.stale_customer.cleared', {
                userId: user.id,
                customerId: resolvedCustomerId,
                subscriptionId: resolvedSubscriptionId,
              })
              await clearStaleBillingState(supabase, user.id)
              shouldForceFreshCheckout = true
              hasActiveSubscription = false
              resolvedCustomerId = null
              resolvedSubscriptionId = null
              resolvedPlan = FREE_PLAN
            }
          }
        } catch (upgradeCheckoutErr) {
          console.error('Upgrade checkout creation error, will try portal:', upgradeCheckoutErr)
          // Fall through to portal
        }
      }

      if (shouldForceFreshCheckout) {
        console.log('billing.checkout.fallback_to_fresh_checkout', {
          userId: user.id,
          reason: 'stale_customer_or_subscription',
          targetPlan: planId,
        })
      } else {

        const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success`

        let lastError: unknown = null

      // Helper: try all portal approaches with a given customerId
        async function tryPortalWithCustomerId(customerId: string): Promise<string | null> {
        // SDK — hits POST /v1/customer-sessions/ (from @polar-sh/sdk source)
        try {
          const polar = buildPolarClient()
          if (polar) {
            const session = await polar.customerSessions.create({ customerId, returnUrl })
            const url = extractPortalUrl(session)
            if (url) return url
          }
        } catch (e) {
          lastError = e
          console.error('Portal SDK failed:', e)
        }

        // Raw HTTP — correct endpoint per SDK source: /v1/customer-sessions/
        try {
          const resp = await fetch(`${POLAR_API_URL}/customer-sessions/`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ customer_id: customerId, return_url: returnUrl }),
          })
          if (resp.ok) {
            const data = (await resp.json()) as Record<string, unknown>
            return (
              (data.customer_portal_url as string | undefined) ||
              (data.customerPortalUrl as string | undefined) ||
              (data.url as string | undefined) ||
              null
            )
          } else {
            const errText = await resp.text()
            lastError = { status: resp.status, body: errText }
            console.error('Portal HTTP failed:', resp.status, errText)
          }
        } catch (e) {
          lastError = e
          console.error('Portal HTTP failed:', e)
        }

        return null
      }

      // Attempt A: use stored customer_id
        if (resolvedCustomerId) {
          const portalUrl = await tryPortalWithCustomerId(resolvedCustomerId)
          if (portalUrl) {
            return NextResponse.json({ url: portalUrl, isPortal: true })
          }
        }

        // Attempt B: recover customer_id from subscription_id via Polar API
        if (resolvedSubscriptionId) {
          const subResp = await fetch(
            `${POLAR_API_URL}/subscriptions/${resolvedSubscriptionId}`,
            {
              headers: {
                Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
            },
          )
          if (subResp.ok) {
            const subData = (await subResp.json()) as Record<string, unknown>
            const customerIdFromSub =
              (subData.customer_id as string | undefined) ||
              ((subData.customer as Record<string, unknown> | undefined)?.id as string | undefined)

            if (customerIdFromSub) {
              // Save recovered customer_id to DB
              await supabase
                .from('users')
                .update({ customer_id: customerIdFromSub, updated_at: new Date().toISOString() })
                .eq('id', user.id)

              resolvedCustomerId = customerIdFromSub
              const portalUrl = await tryPortalWithCustomerId(customerIdFromSub)
              if (portalUrl) {
                return NextResponse.json({ url: portalUrl, isPortal: true })
              }
            }
          } else if (subResp.status === 404) {
            console.warn('billing.stale_state.cleared_from_subscription_lookup', {
              userId: user.id,
              subscriptionId: resolvedSubscriptionId,
            })
            await clearStaleBillingState(supabase, user.id)
            hasActiveSubscription = false
            resolvedCustomerId = null
            resolvedSubscriptionId = null
            resolvedPlan = FREE_PLAN
            shouldForceFreshCheckout = true
          }
        }

        if (shouldForceFreshCheckout) {
          console.log('billing.checkout.fallback_to_fresh_checkout', {
            userId: user.id,
            reason: 'stale_subscription_lookup',
            targetPlan: planId,
          })
        } else {
          // Attempt C: try externalCustomerId via SDK (last resort for portal)
          try {
            const polar = buildPolarClient()
            if (polar) {
              const session = await polar.customerSessions.create({
                externalCustomerId: user.id,
                returnUrl,
              })
              const url = extractPortalUrl(session)
              if (url) {
                return NextResponse.json({ url, isPortal: true })
              }
            }
          } catch (e) {
            lastError = e
            console.error('Portal SDK (externalCustomerId) failed:', e)
          }

          // All portal attempts failed. Do NOT fall through to checkout creation —
          // Polar will reject it because the user already has an active subscription.
          // Return a helpful error with Polar details for debugging.
          console.error('All portal creation attempts failed for active subscriber', {
            userId: user.id,
            subscriptionId: resolvedSubscriptionId,
            customerId: resolvedCustomerId,
            lastError: lastError instanceof Error ? lastError.message : JSON.stringify(lastError),
          })

          const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError)
          const isScopeError = lastErrorMessage.includes('insufficient_scope')

          return NextResponse.json(
            {
              error: 'Could not open billing portal',
              message: isScopeError
                ? 'Billing portal permissions are missing in Polar access token. Please add customer_sessions:write and web:write scopes.'
                : 'Unable to open your billing portal right now. Please try again in a moment or contact support.',
              polarError: lastErrorMessage,
            },
            { status: 503 },
          )
        }
      }
    }

    // -----------------------------------------------------------
    // Step 3: No active subscription — create a new checkout
    // -----------------------------------------------------------
    const checkoutBody: Record<string, unknown> = {
      products: [plan.productId],
      customer_email: user.email,
      external_customer_id: user.id,
      metadata: {
        user_id: user.id,
        plan: planId,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing&upgrade=success&target_plan=${planId}&checkout_id={CHECKOUT_ID}`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
    }

    if (plan.productId) checkoutBody.product_id = plan.productId
    if (plan.priceId) checkoutBody.product_price_id = plan.priceId

    const response = await fetch(`${POLAR_API_URL}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
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
