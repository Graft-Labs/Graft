/**
 * Simple in-memory sliding-window rate limiter for API routes.
 * Suitable for single-instance deployments (Vercel serverless); for
 * multi-region setups replace the store with @upstash/ratelimit + Redis.
 */

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

/**
 * Returns true when the request should be allowed, false when the caller
 * has exceeded the limit.
 *
 * @param key    Unique key per rate-limited entity (e.g. `"ip:1.2.3.4"`)
 * @param limit  Maximum requests allowed within the window
 * @param windowMs  Duration of the window in milliseconds (default: 60 000)
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): boolean {
  const now = Date.now()
  const current = store.get(key)

  if (!current || now > current.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (current.count >= limit) {
    return false
  }

  current.count += 1
  return true
}

/**
 * Extract the best client IP from a Next.js request.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}
