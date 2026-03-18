import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ExternalIssueInput } from '@/lib/ai/analyzer'

export interface DastInput {
  cloneDir: string
  framework: string
  stagingUrl?: string
  authHeader?: string
}

export interface DastResult {
  issues: ExternalIssueInput[]
  metadata: {
    checksExecuted: string[]
    checksFailed: string[]
  }
}

async function readSafe(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

export async function runDastChecks(input: DastInput): Promise<DastResult> {
  const checksExecuted: string[] = []
  const checksFailed: string[] = []
  const issues: ExternalIssueInput[] = []

  const middlewareTs = await readSafe(join(input.cloneDir, 'middleware.ts'))
  const middlewareJs = await readSafe(join(input.cloneDir, 'middleware.js'))
  const middleware = middlewareTs || middlewareJs
  checksExecuted.push('auth-middleware-protection')

  if (input.framework === 'nextjs') {
    const hasMatcher = /matcher\s*:\s*\[/.test(middleware)
    const protectsDashboard = /dashboard|admin|scan/.test(middleware)
    const hasNoopMiddleware = /return\s+NextResponse\.next\(\)/.test(middleware) && !/redirect\(|rewrite\(|auth\.|getUser\(|getSession\(/.test(middleware)

    if ((!hasMatcher || !protectsDashboard) && !hasNoopMiddleware) {
      issues.push({
        guard: 'security',
        category: 'dast',
        severity: 'high',
        confidence: 'likely',
        title: 'Sensitive routes may be missing middleware protection',
        description: 'Could not verify robust middleware matcher coverage for dashboard/admin routes. This can allow direct route access if API checks are inconsistent.',
        fix_suggestion: 'Add a strict middleware matcher for all sensitive route groups and enforce authz checks server-side in each API handler.',
      })
    }
  }

  const scanApiRoute = await readSafe(join(input.cloneDir, 'app/api/scan/route.ts'))
  checksExecuted.push('api-rate-limit-presence')
  if (!scanApiRoute || !/rate|limit|429|Too Many Requests/i.test(scanApiRoute)) {
    issues.push({
      guard: 'scalability',
      category: 'dast',
      severity: 'high',
      confidence: 'likely',
      title: 'API rate limiting not confidently enforced',
      description: 'No clear rate-limit enforcement markers were found in key API route checks.',
      fix_suggestion: 'Apply a shared rate limiter to all mutation-heavy API endpoints and return 429 on threshold exceedance.',
    })
  }

  if (input.stagingUrl) {
    checksExecuted.push('staging-safe-probes')
    const probeHeaders: Record<string, string> = {
      Accept: 'application/json',
    }
    if (input.authHeader) {
      probeHeaders.Authorization = input.authHeader
    }

    const targets = [
      '/api/scan',
      '/api/scan/non-existent-id',
      '/api/github/repos',
    ]

    for (const target of targets) {
      try {
        const res = await fetch(`${input.stagingUrl}${target}`, {
          method: 'GET',
          headers: probeHeaders,
          signal: AbortSignal.timeout(6000),
        })

        if (res.status === 500) {
          issues.push({
            guard: 'security',
            category: 'dast',
            severity: 'medium',
            confidence: 'possible',
            title: 'Staging probe returned 500 on public-safe endpoint',
            description: `GET ${target} returned 500. This can expose stack traces or unstable handlers under malformed input.`,
            fix_suggestion: 'Harden error handling for this endpoint, return sanitized errors, and add request validation guards.',
          })
        }

        if (res.status === 200 && target.includes('non-existent-id')) {
          issues.push({
            guard: 'security',
            category: 'dast',
            severity: 'high',
            confidence: 'possible',
            title: 'Unexpected success response for invalid resource probe',
            description: `GET ${target} returned 200 for an intentionally invalid ID, suggesting weak resource validation or permissive fallback behavior.`,
            fix_suggestion: 'Enforce strict resource existence checks and return 404/403 consistently for invalid or unauthorized access attempts.',
          })
        }
      } catch {
        checksFailed.push(target)
      }
    }
  }

  return {
    issues,
    metadata: {
      checksExecuted,
      checksFailed,
    },
  }
}
