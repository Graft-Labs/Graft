export interface ToolOutputs {
  scan_id?: string
  trufflehog: unknown
  osv: unknown
  semgrep: unknown
  react_doctor: unknown
  file_checks: {
    env_example: string
    robots_txt: string
    sitemap_xml: string
    not_found_page: string
    pricing_page: string
    privacy_policy: string
    terms_of_service: string
    manifest_json: string
    has_stripe: string
    has_sentry: string
    has_plausible: string
    has_google_analytics: string
    has_posthog: string
    has_loading_tsx: string
    has_error_tsx: string
  }
  osv_skipped: boolean
  osv_skip_reason: string | null
}

export interface EnrichedIssue {
  guard: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  fix_suggestion: string
  code_snippet?: string
  file_path?: string
  line_number?: number
}

const SYSTEM_PROMPT = `You are ShipGuard AI, a production-readiness analyzer for indie hacker apps. Your job is to analyze tool outputs and provide actionable, non-technical explanations for founders.

IMPORTANT RULES:
1. Only analyze REAL findings from the tool outputs provided
2. Never invent or hallucinate issues
3. Be concise - founders are busy
4. Provide specific, copy-pasteable fix suggestions
5. Estimate revenue impact when relevant

For each finding, provide:
- Plain-English explanation (1-2 sentences, founder-focused)
- Severity: critical / high / medium / low
- Specific fix suggestion with code when possible
- Revenue/launch impact if applicable`

async function callOpenRouter(prompt: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      })

      if (response.status === 429) {
        const waitTime = Math.pow(2, i) * 1000
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenRouter error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      return data.choices[0].message.content
    } catch (error) {
      if (i === retries - 1) throw error
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000))
    }
  }

  throw new Error('Failed to call OpenRouter after retries')
}

function parseTruffleHog(trufflehog: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  // TruffleHog v3 outputs NDJSON — we already parse each line into an array upstream
  const findings = Array.isArray(trufflehog) ? trufflehog : []

  for (const finding of findings) {
    // TruffleHog v3 NDJSON schema:
    // { DetectorName, Raw, Verified, SourceMetadata: { Data: { Filesystem: { file, line } } } }
    const f = finding as {
      DetectorName?: string
      Verified?: boolean
      SourceMetadata?: {
        Data?: {
          Filesystem?: { file?: string; line?: number }
          Git?: { file?: string; line?: number }
        }
      }
    }

    if (!f.DetectorName) continue

    const loc = f.SourceMetadata?.Data?.Filesystem ?? f.SourceMetadata?.Data?.Git
    const fileName = loc?.file ?? null
    const lineNum = loc?.line ?? null
    const verified = f.Verified === true

    issues.push({
      guard: 'security',
      category: 'secrets',
      severity: 'critical',
      title: `Exposed ${f.DetectorName.replace(/_/g, ' ')} credential`,
      description: `A ${f.DetectorName.replace(/_/g, ' ')} secret was found${fileName ? ` in \`${fileName}\`` : ' in your code'}${verified ? ' and is **verified active**' : ''}. This allows attackers to access external services directly.`,
      fix_suggestion: 'Remove the secret immediately. Rotate it in the service dashboard, then reference it via process.env.YOUR_SECRET_NAME instead.',
      file_path: fileName ?? undefined,
      line_number: lineNum ?? undefined,
    })
  }

  return issues
}

function parseOSV(osv: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  // OSV-Scanner JSON output schema:
  // { results: [{ packages: [{ package: { name, version, ecosystem }, vulnerabilities: [{ id, summary, severity, affected }] }] }] }
  const osvData = osv as {
    results?: Array<{
      packages?: Array<{
        package?: { name?: string; version?: string; ecosystem?: string }
        vulnerabilities?: Array<{
          id?: string
          summary?: string
          severity?: Array<{ type?: string; score?: string }>
          affected?: Array<{
            ranges?: Array<{
              events?: Array<{ fixed?: string }>
            }>
          }>
        }>
      }>
    }>
  }

  const results = osvData?.results ?? []

  for (const result of results) {
    for (const pkg of result.packages ?? []) {
      const pkgName = pkg.package?.name ?? 'unknown'
      const pkgVersion = pkg.package?.version ?? '?'

      for (const vuln of pkg.vulnerabilities ?? []) {
        // Extract fix version from the first affected range
        const fixVersion = vuln.affected?.[0]?.ranges?.[0]?.events
          ?.find((e: { fixed?: string }) => e.fixed)?.fixed ?? null

        // Map CVSS severity to our scale
        const cvssScore = vuln.severity?.[0]?.score?.toUpperCase() ?? ''
        let severity: 'critical' | 'high' | 'medium' | 'low' = 'high'
        if (cvssScore === 'CRITICAL') severity = 'critical'
        else if (cvssScore === 'HIGH') severity = 'high'
        else if (cvssScore === 'MEDIUM') severity = 'medium'
        else if (cvssScore === 'LOW') severity = 'low'

        const fix = fixVersion
          ? `Update ${pkgName} to v${fixVersion}: npm install ${pkgName}@${fixVersion}`
          : `Update ${pkgName} to the latest version: npm update ${pkgName}`

        issues.push({
          guard: 'security',
          category: 'vulnerabilities',
          severity,
          title: `${vuln.id ?? 'CVE'} in ${pkgName}@${pkgVersion}`,
          description: `${vuln.summary ?? 'A known vulnerability'} in \`${pkgName}\` v${pkgVersion}.${fixVersion ? ` Fixed in v${fixVersion}.` : ''}`,
          fix_suggestion: fix,
        })
      }
    }
  }

  return issues
}

function parseSemgrep(semgrep: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  const results = semgrep && typeof semgrep === 'object' && 'results' in semgrep
    ? (semgrep as { results: unknown[] }).results
    : []

  for (const result of results) {
    const r = result as {
      check_id?: string
      extra?: {
        message?: string
        lines?: string
        severity?: string
        metadata?: { guard?: string; category?: string }
      }
      path?: string
      start?: { line?: number }
    }

    if (!r.check_id) continue

    // Derive guard from check_id prefix: "shipguard.distribution.xxx" → "distribution"
    // Also handles "shipguard-console-log" style legacy IDs
    let guard = 'security'
    const checkParts = r.check_id.toLowerCase().replace(/^shipguard[-.]/, '').split(/[.-]/)
    if (checkParts[0] === 'distribution' || r.check_id.includes('distribution') || r.check_id.includes('og') || r.check_id.includes('seo') || r.check_id.includes('meta') || r.check_id.includes('cookie')) {
      guard = 'distribution'
    } else if (checkParts[0] === 'monetization' || r.check_id.includes('monetization') || r.check_id.includes('stripe') || r.check_id.includes('checkout') || r.check_id.includes('webhook') || r.check_id.includes('trial')) {
      guard = 'monetization'
    } else if (checkParts[0] === 'scalability' || r.check_id.includes('scalability') || r.check_id.includes('console') || r.check_id.includes('sync') || r.check_id.includes('performance')) {
      guard = 'scalability'
    }
    // Override with explicit metadata if present
    if (r.extra?.metadata?.guard) {
      guard = r.extra.metadata.guard
    }

    const severityMap: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
      ERROR: 'critical',
      WARNING: 'high',
      INFO: 'low',
    }
    const severity = severityMap[r.extra?.severity?.toUpperCase() ?? 'WARNING'] ?? 'medium'

    // Use extra.message (full message) when available, fall back to check_id
    const message = r.extra?.message || r.check_id.replace(/[_.-]/g, ' ')
    const codeLines = r.extra?.lines?.trim()

    issues.push({
      guard,
      category: r.extra?.metadata?.category ?? guard,
      severity,
      title: r.check_id.split('.').pop()?.replace(/[-_]/g, ' ') ?? r.check_id,
      description: message,
      fix_suggestion: codeLines
        ? `Found in \`${r.path}\`:${r.start?.line ? ` line ${r.start.line}` : ''}\n\`\`\`\n${codeLines}\n\`\`\``
        : 'Review and fix the pattern identified by this rule.',
      file_path: r.path,
      line_number: r.start?.line,
      code_snippet: codeLines,
    })
  }

  return issues
}

function parseReactDoctor(reactDoctor: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  const data = reactDoctor as {
    issues?: Array<{
      type?: string
      message?: string
      file?: string
      fix?: string
    }>
  }

  if (!data.issues) return issues

  for (const issue of data.issues) {
    const category = issue.type?.includes('error') || issue.type?.includes('warning')
      ? 'scalability'
      : 'distribution'

    issues.push({
      guard: category,
      category,
      severity: 'medium',
      title: issue.type || 'React/Next.js Issue',
      description: issue.message || 'An issue with your React/Next.js setup was detected.',
      fix_suggestion: issue.fix || 'Review the React Doctor recommendations for this issue.',
      file_path: issue.file,
    })
  }

  return issues
}

function parseFileChecks(fileChecks: ToolOutputs['file_checks']): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  if (fileChecks.env_example === 'false') {
    issues.push({
      guard: 'scalability',
      category: 'configuration',
      severity: 'medium',
      title: 'Missing .env.example',
      description: 'You should provide a template file showing what environment variables are needed.',
      fix_suggestion: 'Create an .env.example file with placeholder values for all required environment variables.',
    })
  }

  if (fileChecks.robots_txt === 'false') {
    issues.push({
      guard: 'distribution',
      category: 'seo',
      severity: 'medium',
      title: 'Missing robots.txt',
      description: 'No robots.txt file found. Search engines may not be able to properly crawl your site.',
      fix_suggestion: 'Create public/robots.txt with: User-agent: *\\nDisallow:',
    })
  }

  if (fileChecks.sitemap_xml === 'false') {
    issues.push({
      guard: 'distribution',
      category: 'seo',
      severity: 'medium',
      title: 'Missing sitemap.xml',
      description: 'No sitemap.xml found. This helps search engines index your pages.',
      fix_suggestion: 'Generate a sitemap using next-sitemap or similar tool.',
    })
  }

  if (fileChecks.not_found_page === 'false' || fileChecks.not_found_page === '0') {
    issues.push({
      guard: 'distribution',
      category: 'ux',
      severity: 'low',
      title: 'Missing custom 404 page',
      description: 'No custom not-found.tsx or 404 page found.',
      fix_suggestion: 'Create app/not-found.tsx with a helpful error message.',
    })
  }

  if (fileChecks.pricing_page === 'false') {
    issues.push({
      guard: 'monetization',
      category: 'checkout',
      severity: 'high',
      title: 'No pricing page',
      description: 'No pricing page detected. You need to show users how to pay.',
      fix_suggestion: 'Create a pricing page with at least 2 tiers to enable upsells.',
    })
  }

  if (fileChecks.privacy_policy === 'false') {
    issues.push({
      guard: 'distribution',
      category: 'legal',
      severity: 'high',
      title: 'Missing privacy policy',
      description: 'No privacy policy page found. Required for GDPR and app store compliance.',
      fix_suggestion: 'Create a privacy policy page. Use a template from Termify or similar.',
    })
  }

  if (fileChecks.terms_of_service === 'false') {
    issues.push({
      guard: 'distribution',
      category: 'legal',
      severity: 'high',
      title: 'Missing terms of service',
      description: 'No terms of service page found.',
      fix_suggestion: 'Create a terms of service page to protect your business.',
    })
  }

  if (fileChecks.has_stripe === 'false') {
    issues.push({
      guard: 'monetization',
      category: 'payments',
      severity: 'high',
      title: 'No payment integration detected',
      description: 'No Stripe or payment library found in package.json.',
      fix_suggestion: 'Install Stripe: npm install stripe @stripe/stripe-js. Set up checkout sessions.',
    })
  }

  if (fileChecks.has_sentry === 'false') {
    issues.push({
      guard: 'scalability',
      category: 'monitoring',
      severity: 'high',
      title: 'No error tracking',
      description: 'No Sentry or error tracking detected. You won\'t know when your app breaks.',
      fix_suggestion: 'Install Sentry: npm install @sentry/nextjs. Set up error tracking.',
    })
  }

  const hasAnalytics =
    fileChecks.has_plausible === 'true' ||
    fileChecks.has_google_analytics === 'true' ||
    fileChecks.has_posthog === 'true'

  if (!hasAnalytics) {
    issues.push({
      guard: 'distribution',
      category: 'analytics',
      severity: 'high',
      title: 'No analytics installed',
      description: 'No analytics detected. You can\'t measure user behavior or optimize.',
      fix_suggestion: 'Install Plausible (privacy-friendly): npm install @plausible/next-js. Or use PostHog.',
    })
  }

  if (fileChecks.has_loading_tsx === '0') {
    issues.push({
      guard: 'scalability',
      category: 'performance',
      severity: 'medium',
      title: 'Missing loading.tsx',
      description: 'No loading.tsx found in app directory. Users will see blank screens during navigation.',
      fix_suggestion: 'Create loading.tsx files in your route segments for instant loading states.',
    })
  }

  if (fileChecks.has_error_tsx === '0') {
    issues.push({
      guard: 'scalability',
      category: 'error-handling',
      severity: 'medium',
      title: 'Missing error.tsx',
      description: 'No error.tsx found. Errors in route segments could crash the whole app.',
      fix_suggestion: 'Create error.tsx files with error boundaries to gracefully handle errors.',
    })
  }

  return issues
}

export async function analyzeToolOutputs(outputs: ToolOutputs): Promise<EnrichedIssue[]> {
  const allIssues: EnrichedIssue[] = []

  allIssues.push(...parseTruffleHog(outputs.trufflehog))

  if (!outputs.osv_skipped) {
    allIssues.push(...parseOSV(outputs.osv))
  }

  allIssues.push(...parseSemgrep(outputs.semgrep))
  allIssues.push(...parseReactDoctor(outputs.react_doctor))
  allIssues.push(...parseFileChecks(outputs.file_checks))

  return allIssues
}

export function calculateScores(issues: EnrichedIssue[]): {
  security: number
  scalability: number
  monetization: number
  distribution: number
  overall: number
} {
  const baseScore = 100

  const severityWeights = {
    critical: 15,
    high: 10,
    medium: 5,
    low: 2,
  }

  const guardWeights: Record<string, Record<string, number>> = {
    security: { critical: 15, high: 10, medium: 5, low: 2 },
    scalability: { critical: 12, high: 8, medium: 4, low: 1 },
    monetization: { critical: 10, high: 7, medium: 3, low: 1 },
    distribution: { critical: 10, high: 6, medium: 3, low: 1 },
  }

  const guardDeductions: Record<string, number> = {
    security: 0,
    scalability: 0,
    monetization: 0,
    distribution: 0,
  }

  for (const issue of issues) {
    const weight = guardWeights[issue.guard]?.[issue.severity] || severityWeights[issue.severity]
    guardDeductions[issue.guard] = (guardDeductions[issue.guard] || 0) + weight
  }

  const scores: {
    security: number
    scalability: number
    monetization: number
    distribution: number
    overall: number
  } = {
    security: Math.max(0, baseScore - guardDeductions.security),
    scalability: Math.max(0, baseScore - guardDeductions.scalability),
    monetization: Math.max(0, baseScore - guardDeductions.monetization),
    distribution: Math.max(0, baseScore - guardDeductions.distribution),
    overall: 0,
  }

  scores.overall = Math.round(
    (scores.security * 0.35 +
      scores.scalability * 0.25 +
      scores.monetization * 0.2 +
      scores.distribution * 0.2)
  )

  return scores
}
