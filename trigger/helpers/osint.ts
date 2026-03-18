import { promises as dns } from 'node:dns'
import { ExternalIssueInput } from '@/lib/ai/analyzer'

export interface OsintInput {
  repoOwner: string
  repoName: string
  candidateDomains: string[]
  cloneDir: string
}

export interface OsintResult {
  issues: ExternalIssueInput[]
  metadata: {
    checkedDomains: string[]
    unresolvedDomains: string[]
    suspiciousFindings: number
  }
}

interface SearchProviderResult {
  source: 'shodan' | 'censys'
  query: string
  matches: number
}

async function resolveDomain(domain: string): Promise<{ a: string[]; cname: string[] }> {
  try {
    const [a, cname] = await Promise.all([
      dns.resolve4(domain).catch(() => []),
      dns.resolveCname(domain).catch(() => []),
    ])
    return { a, cname }
  } catch {
    return { a: [], cname: [] }
  }
}

export async function runOsintChecks(input: OsintInput): Promise<OsintResult> {
  const checkedDomains: string[] = []
  const unresolvedDomains: string[] = []
  const issues: ExternalIssueInput[] = []
  const searchResults: SearchProviderResult[] = []

  for (const domain of input.candidateDomains) {
    checkedDomains.push(domain)
    const { a, cname } = await resolveDomain(domain)

    if (a.length === 0 && cname.length === 0) {
      unresolvedDomains.push(domain)
      continue
    }

    const pointsToParking = cname.some((c) =>
      /github\.io|herokudns|azurewebsites\.net|s3-website|netlify/.test(c)
    )

    if (pointsToParking && a.length === 0) {
      issues.push({
        guard: 'security',
        category: 'osint',
        severity: 'medium',
        confidence: 'possible',
        title: 'Potential subdomain takeover exposure',
        description: `Domain \`${domain}\` resolves to a hosting CNAME but has no direct A record. This can indicate dangling DNS depending on provider claim status.`,
        fix_suggestion: `Verify ownership of \`${domain}\` in your hosting provider, remove stale DNS records for retired apps, and enforce DNS inventory checks in CI.`,
      })
    }
  }

  const shodanKey = process.env.SHODAN_API_KEY
  const censysId = process.env.CENSYS_API_ID
  const censysSecret = process.env.CENSYS_API_SECRET

  if (shodanKey) {
    const provider = await queryShodan(shodanKey, `${input.repoName} ${input.repoOwner}`)
    if (provider) searchResults.push(provider)
  }

  if (censysId && censysSecret) {
    const provider = await queryCensys(censysId, censysSecret, `${input.repoName} ${input.repoOwner}`)
    if (provider) searchResults.push(provider)
  }

  for (const result of searchResults) {
    if (result.matches > 0) {
      issues.push({
        guard: 'security',
        category: 'osint',
        severity: 'medium',
        confidence: 'possible',
        title: `External footprint discovered via ${result.source}`,
        description: `${result.source.toUpperCase()} query returned ${result.matches} match(es) for potential exposed services related to this repo owner/name.`,
        fix_suggestion: `Review ${result.source} search results for stale assets, exposed admin surfaces, and non-production environments. Decommission or restrict access where applicable.`,
      })
    }
  }

  return {
    issues,
    metadata: {
      checkedDomains,
      unresolvedDomains,
      suspiciousFindings: issues.length,
    },
  }
}

async function queryShodan(apiKey: string, query: string): Promise<SearchProviderResult | null> {
  try {
    const url = `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&facets=org`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json() as { total?: number }
    return {
      source: 'shodan',
      query,
      matches: typeof data.total === 'number' ? data.total : 0,
    }
  } catch {
    return null
  }
}

async function queryCensys(apiId: string, apiSecret: string, query: string): Promise<SearchProviderResult | null> {
  try {
    const auth = Buffer.from(`${apiId}:${apiSecret}`).toString('base64')
    const res = await fetch('https://search.censys.io/api/v2/hosts/search', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, per_page: 1 }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json() as { result?: { total?: number } }
    return {
      source: 'censys',
      query,
      matches: typeof data.result?.total === 'number' ? data.result.total : 0,
    }
  } catch {
    return null
  }
}
