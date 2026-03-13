// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolOutputs {
  scan_id?: string
  framework?: string
  // Gitleaks (replaces TruffleHog)
  gitleaks_fs:  unknown[]
  gitleaks_git: unknown[]
  // OSV-Scanner
  osv:          unknown
  // Semgrep (fixed config: p/nodejs + p/react + p/nextjs + custom rules)
  semgrep:      unknown
  // Bearer CLI (OWASP Top 10, PII, data flow)
  bearer:       unknown
  // njsscan (Node.js-specific: eval, prototype pollution, JWT none-alg)
  njsscan:      unknown
  // File-based checks
  file_checks: {
    env_example:          string
    robots_txt:           string
    sitemap_xml:          string
    not_found_page:       string
    pricing_page:         string
    privacy_policy:       string
    terms_of_service:     string
    manifest_json:        string
    has_stripe:           string
    has_paddle:           string
    has_lemonsqueezy:     string
    has_razorpay:         string
    has_sentry:           string
    has_plausible:        string
    has_google_analytics: string
    has_posthog:          string
    has_loading_tsx:      string
    has_error_tsx:        string
    has_security_headers: string
    has_og_meta:          string
    gitignore_covers_env: string
    has_auth_library:     string
    use_client_count:     string
    framework:            string
    hallucinated_packages: string
  }
  osv_skipped:      boolean
  osv_skip_reason:  string | null
}

export interface EnrichedIssue {
  guard:         string
  category:      string
  severity:      'critical' | 'high' | 'medium' | 'low'
  title:         string
  description:   string
  fix_suggestion: string
  code_snippet?: string
  file_path?:    string
  line_number?:  number
  confidence?:   'confirmed' | 'likely' | 'possible'
}

// ── Gitleaks parser ────────────────────────────────────────────────────────────
// Schema: [{ Description, File, StartLine, Secret, RuleID, Entropy, Match }]

function parseGitleaks(findings: unknown[], source: 'filesystem' | 'git'): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  for (const finding of findings) {
    const f = finding as {
      Description?: string
      File?:        string
      StartLine?:   number
      Secret?:      string
      RuleID?:      string
      Entropy?:     number
      Match?:       string
      Commit?:      string
    }

    if (!f.RuleID && !f.Description) continue

    const ruleId  = f.RuleID ?? 'unknown-secret'
    const desc    = f.Description ?? ruleId.replace(/-/g, ' ')
    const inGit   = source === 'git'
    const entropy = f.Entropy ?? 0

    // Redact the actual secret value from the title
    const secretPreview = f.Secret
      ? f.Secret.slice(0, 6) + '…'
      : null

    issues.push({
      guard:    'security',
      category: 'secrets',
      severity: 'critical',
      confidence: 'confirmed',
      title: `Exposed ${desc} secret`,
      description: `A ${desc} credential was found${f.File ? ` in \`${f.File}\`` : ''}${inGit ? ' in git history' : ''}${secretPreview ? ` (starts with \`${secretPreview}\`)` : ''}. Entropy: ${entropy.toFixed(2)}. Attackers with repo read access can use this key immediately.`,
      fix_suggestion: `1. Rotate this key NOW in the service dashboard — assume it is already compromised.\n2. Remove the secret from the file and replace with: process.env.${ruleId.toUpperCase().replace(/-/g, '_')}\n3. If found in git history, use \`git filter-repo\` or BFG Repo Cleaner to purge it from all commits.\n4. Add \`.env*\` to \`.gitignore\` to prevent future leaks.`,
      file_path:   f.File,
      line_number: f.StartLine,
    })
  }

  return issues
}

// ── OSV-Scanner parser ─────────────────────────────────────────────────────────
// Schema: { results: [{ packages: [{ package: { name, version }, vulnerabilities: [...] }] }] }

function parseOSV(osv: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

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

  for (const result of osvData?.results ?? []) {
    for (const pkg of result.packages ?? []) {
      const pkgName    = pkg.package?.name    ?? 'unknown'
      const pkgVersion = pkg.package?.version ?? '?'

      for (const vuln of pkg.vulnerabilities ?? []) {
        const fixVersion = vuln.affected?.[0]?.ranges?.[0]?.events
          ?.find((e: { fixed?: string }) => e.fixed)?.fixed ?? null

        const cvssScore = vuln.severity?.[0]?.score?.toUpperCase() ?? ''
        let severity: EnrichedIssue['severity'] = 'high'
        if (cvssScore === 'CRITICAL') severity = 'critical'
        else if (cvssScore === 'HIGH')   severity = 'high'
        else if (cvssScore === 'MEDIUM') severity = 'medium'
        else if (cvssScore === 'LOW')    severity = 'low'

        issues.push({
          guard:    'security',
          category: 'vulnerabilities',
          severity,
          confidence: 'confirmed',
          title: `${vuln.id ?? 'CVE'} in ${pkgName}@${pkgVersion}`,
          description: `${vuln.summary ?? 'A known vulnerability'} in \`${pkgName}\` v${pkgVersion}.${fixVersion ? ` Fixed in v${fixVersion}.` : ''}`,
          fix_suggestion: fixVersion
            ? `Update ${pkgName} to v${fixVersion}:\n\`npm install ${pkgName}@${fixVersion}\``
            : `Update ${pkgName} to the latest version:\n\`npm update ${pkgName}\``,
        })
      }
    }
  }

  return issues
}

// ── Semgrep parser ─────────────────────────────────────────────────────────────
// Schema: { results: [{ check_id, path, start: { line }, extra: { message, severity, lines, metadata } }] }

function parseSemgrep(semgrep: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  const results = semgrep && typeof semgrep === 'object' && 'results' in semgrep
    ? (semgrep as { results: unknown[] }).results
    : []

  for (const result of results) {
    const r = result as {
      check_id?: string
      extra?:    {
        message?:  string
        lines?:    string
        severity?: string
        metadata?: { guard?: string; category?: string; confidence?: string }
      }
      path?:  string
      start?: { line?: number }
    }

    if (!r.check_id) continue

    // Derive guard from check_id
    let guard = 'security'
    const id  = r.check_id.toLowerCase()
    if (id.includes('shipguard.distribution') || id.includes('.seo') || id.includes('.og') || id.includes('.meta') || id.includes('cookie-consent')) {
      guard = 'distribution'
    } else if (id.includes('shipguard.monetization') || id.includes('webhook') || id.includes('stripe') || id.includes('checkout') || id.includes('price') || id.includes('paddle') || id.includes('lemonsqueezy')) {
      guard = 'monetization'
    } else if (id.includes('shipguard.scalability') || id.includes('console') || id.includes('performance') || id.includes('prisma') || id.includes('pagination') || id.includes('use-client')) {
      guard = 'scalability'
    }
    if (r.extra?.metadata?.guard) guard = r.extra.metadata.guard

    const severityMap: Record<string, EnrichedIssue['severity']> = {
      ERROR:   'critical',
      WARNING: 'high',
      INFO:    'low',
    }
    const severity = severityMap[r.extra?.severity?.toUpperCase() ?? 'WARNING'] ?? 'medium'

    const confidence = (r.extra?.metadata?.confidence as EnrichedIssue['confidence']) ?? 'likely'
    const message    = r.extra?.message || r.check_id.replace(/[_.-]/g, ' ')
    const codeLines  = r.extra?.lines?.trim()

    // Clean up title: take the last segment of the check_id
    const rawTitle = r.check_id.split('.').pop() ?? r.check_id
    const title = rawTitle.replace(/[-_]/g, ' ')

    issues.push({
      guard,
      category:   r.extra?.metadata?.category ?? guard,
      severity,
      confidence,
      title,
      description: message,
      fix_suggestion: codeLines
        ? `Found in \`${r.path}\`:${r.start?.line ? ` line ${r.start.line}` : ''}\n\`\`\`\n${codeLines}\n\`\`\``
        : 'Review and fix the pattern identified by this rule.',
      file_path:    r.path,
      line_number:  r.start?.line,
      code_snippet: codeLines,
    })
  }

  return issues
}

// ── Bearer parser ──────────────────────────────────────────────────────────────
// Schema: { critical: [...], high: [...], medium: [...], low: [...] }
// Each finding: { id, title, line_number, full_filename, snippet, description }

function parseBearer(bearer: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  const data = bearer as Partial<Record<
    'critical' | 'high' | 'medium' | 'low',
    Array<{
      id?:            string
      title?:         string
      line_number?:   number
      full_filename?: string
      snippet?:       string
      description?:   string
    }>
  >>

  const SEVERITY_LEVELS: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low']

  for (const level of SEVERITY_LEVELS) {
    for (const finding of data[level] ?? []) {
      if (!finding.title && !finding.id) continue

      // Derive guard from Bearer rule ID prefix
      const id = (finding.id ?? '').toLowerCase()
      let guard = 'security'
      if (id.includes('ruby') || id.includes('python')) guard = 'security'
      // Bearer's OWASP mapping — most findings are security
      // A few patterns go to scalability (e.g. logging PII)

      const title = finding.title ?? finding.id ?? 'Unknown Bearer finding'
      const desc  = finding.description
        ? `${finding.description}${finding.full_filename ? ` Found in \`${finding.full_filename}\`.` : ''}`
        : `${title}${finding.full_filename ? ` in \`${finding.full_filename}\`` : ''}.`

      issues.push({
        guard,
        category:   'owasp',
        severity:   level,
        confidence: 'likely',
        title,
        description: desc,
        fix_suggestion: finding.snippet
          ? `Vulnerable code:\n\`\`\`\n${finding.snippet}\n\`\`\`\nReview and remediate this pattern.`
          : 'Review and remediate this pattern per OWASP guidelines.',
        file_path:   finding.full_filename,
        line_number: finding.line_number,
        code_snippet: finding.snippet,
      })
    }
  }

  return issues
}

// ── njsscan parser ─────────────────────────────────────────────────────────────
// Schema: { nodejs: { rule_id: { files: [{ file_path, match_lines, match_string }], metadata: { severity, description, owasp, cwe } } }, errors: [] }

function parseNjsscan(njsscan: unknown): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []

  const data = njsscan as {
    nodejs?: Record<string, {
      files?: Array<{ file_path?: string; match_lines?: number[]; match_string?: string }>
      metadata?: { severity?: string; description?: string; owasp?: string; cwe?: string }
    }>
  }

  const nodeRules = data?.nodejs ?? {}

  for (const [ruleId, ruleData] of Object.entries(nodeRules)) {
    const meta       = ruleData.metadata ?? {}
    const desc       = meta.description ?? ruleId.replace(/_/g, ' ')
    const cwe        = meta.cwe ?? ''
    const owasp      = meta.owasp ?? ''

    const rawSev = (meta.severity ?? 'WARNING').toUpperCase()
    let severity: EnrichedIssue['severity'] = 'high'
    if (rawSev === 'ERROR' || rawSev === 'CRITICAL') severity = 'critical'
    else if (rawSev === 'WARNING')                   severity = 'high'
    else if (rawSev === 'INFO')                      severity = 'low'

    // Map specific njsscan rules to guards
    let guard = 'security'
    const idLower = ruleId.toLowerCase()
    if (idLower.includes('console') || idLower.includes('sync') || idLower.includes('blocking')) {
      guard = 'scalability'
    }

    const fixHint = buildNjsscanFix(ruleId)

    for (const file of ruleData.files ?? []) {
      issues.push({
        guard,
        category:   'nodejs-security',
        severity,
        confidence: 'confirmed',
        title: ruleId.replace(/_/g, ' '),
        description: `${desc}${cwe ? ` (${cwe})` : ''}${owasp ? ` — OWASP ${owasp}` : ''}${file.file_path ? `. Found in \`${file.file_path}\`` : ''}.`,
        fix_suggestion: fixHint,
        file_path:    file.file_path,
        line_number:  file.match_lines?.[0],
        code_snippet: file.match_string,
      })
    }
  }

  return issues
}

function buildNjsscanFix(ruleId: string): string {
  const id = ruleId.toLowerCase()
  if (id.includes('eval'))           return 'Remove eval() — use JSON.parse() for data, or a proper AST parser for code. eval() allows arbitrary code execution.'
  if (id.includes('prototype'))      return 'Validate and sanitize user input before merging into objects. Use Object.create(null) for dictionaries or a library like deepmerge with prototype pollution protection.'
  if (id.includes('jwt_none'))       return 'Reject JWTs with algorithm "none". Always specify allowed algorithms explicitly: jwt.verify(token, secret, { algorithms: ["HS256"] })'
  if (id.includes('sqli') || id.includes('sql_injection')) return 'Use parameterized queries or an ORM (Prisma, Drizzle) instead of string concatenation in SQL queries.'
  if (id.includes('path_traversal')) return 'Sanitize file paths with path.resolve() and verify the result starts with your expected base directory.'
  if (id.includes('nosqli'))         return 'Sanitize MongoDB query operators. Use mongoose-sanitize or express-mongo-sanitize middleware.'
  if (id.includes('xxe'))            return 'Disable external entity processing in your XML parser: parser.resolveExternalEntities = false.'
  if (id.includes('hardcoded'))      return 'Move the hardcoded secret to an environment variable: process.env.YOUR_SECRET_NAME'
  return 'Review this security pattern and follow OWASP guidelines for secure Node.js development.'
}

// ── File-checks parser ─────────────────────────────────────────────────────────

function parseFileChecks(fileChecks: ToolOutputs['file_checks']): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []
  const framework = fileChecks.framework ?? 'unknown'
  const isNextJs  = framework === 'nextjs'

  // ── Security ────────────────────────────────────────────────────────────────

  if (fileChecks.gitignore_covers_env === 'false') {
    issues.push({
      guard: 'security', category: 'secrets', severity: 'high', confidence: 'confirmed',
      title: '.env files not in .gitignore',
      description: 'Your .gitignore does not include .env patterns. Any .env file accidentally committed will be permanently visible in git history.',
      fix_suggestion: 'Add these lines to .gitignore:\n```\n.env\n.env.*\n!.env.example\n```',
    })
  }

  if (isNextJs && fileChecks.has_security_headers === 'false') {
    issues.push({
      guard: 'security', category: 'headers', severity: 'high', confidence: 'confirmed',
      title: 'No HTTP security headers configured',
      description: 'next.config.js/ts does not set security headers like Content-Security-Policy, X-Frame-Options, or HSTS. Without these, your app is vulnerable to clickjacking, XSS, and MIME-type attacks.',
      fix_suggestion: 'Add a headers() function to next.config.ts with at minimum:\n- `X-Frame-Options: DENY`\n- `X-Content-Type-Options: nosniff`\n- `Referrer-Policy: strict-origin-when-cross-origin`\n- `Permissions-Policy: camera=(), microphone=(), geolocation=()`',
    })
  }

  // ── Monetization ───────────────────────────────────────────────────────────

  const hasAnyPayment =
    fileChecks.has_stripe === 'true' ||
    fileChecks.has_paddle === 'true' ||
    fileChecks.has_lemonsqueezy === 'true' ||
    fileChecks.has_razorpay === 'true'

  if (!hasAnyPayment) {
    issues.push({
      guard: 'monetization', category: 'payments', severity: 'high', confidence: 'confirmed',
      title: 'No payment integration detected',
      description: 'No Stripe, Paddle, LemonSqueezy, or Razorpay library found in package.json. You cannot charge users without a payment provider.',
      fix_suggestion: 'Install Stripe (recommended for most apps):\n```\nnpm install stripe @stripe/stripe-js\n```\nSet up checkout sessions and webhook handlers.',
    })
  }

  if (fileChecks.pricing_page === 'false') {
    issues.push({
      guard: 'monetization', category: 'checkout', severity: 'high', confidence: 'confirmed',
      title: 'No pricing page',
      description: 'No pricing page detected. Without a clear pricing page, conversion rates drop significantly — users cannot find out how to pay.',
      fix_suggestion: 'Create `app/pricing/page.tsx` with at least 2 tiers (free + paid). Include price, features, and a clear CTA.',
    })
  }

  // ── Distribution ───────────────────────────────────────────────────────────

  if (fileChecks.robots_txt === 'false') {
    issues.push({
      guard: 'distribution', category: 'seo', severity: 'medium', confidence: 'confirmed',
      title: 'Missing robots.txt',
      description: 'No robots.txt found. Search engines may over-crawl or under-crawl your site.',
      fix_suggestion: 'Create `public/robots.txt`:\n```\nUser-agent: *\nAllow: /\nSitemap: https://yourapp.com/sitemap.xml\n```',
    })
  }

  if (fileChecks.sitemap_xml === 'false') {
    issues.push({
      guard: 'distribution', category: 'seo', severity: 'medium', confidence: 'confirmed',
      title: 'Missing sitemap',
      description: 'No sitemap.xml or sitemap.ts found. Sitemaps speed up search engine indexing, especially for new pages.',
      fix_suggestion: isNextJs
        ? 'Create `app/sitemap.ts` using the Next.js Metadata API:\n```ts\nexport default async function sitemap() {\n  return [{ url: "https://yourapp.com", lastModified: new Date() }]\n}\n```'
        : 'Generate a sitemap.xml file with all your public URLs.',
    })
  }

  if (isNextJs && fileChecks.has_og_meta === 'false') {
    issues.push({
      guard: 'distribution', category: 'seo', severity: 'high', confidence: 'confirmed',
      title: 'Missing Open Graph metadata',
      description: 'No Open Graph (og:title, og:image) tags detected in your root layout. Links shared on Twitter/X, Slack, LinkedIn, etc. will show an empty preview — killing social referral traffic.',
      fix_suggestion: 'Add to `app/layout.tsx`:\n```ts\nexport const metadata = {\n  openGraph: {\n    title: "Your App",\n    description: "Your description",\n    images: ["/og-image.png"],\n  },\n}\n```',
    })
  }

  if (fileChecks.privacy_policy === 'false') {
    issues.push({
      guard: 'distribution', category: 'legal', severity: 'high', confidence: 'confirmed',
      title: 'Missing privacy policy',
      description: 'No privacy policy page found. Required by GDPR, CCPA, and App Store / Play Store policies. Missing this can result in app removal or fines.',
      fix_suggestion: 'Create `app/privacy/page.tsx`. Use a generator like Termify or Iubenda for a quick draft.',
    })
  }

  if (fileChecks.terms_of_service === 'false') {
    issues.push({
      guard: 'distribution', category: 'legal', severity: 'high', confidence: 'confirmed',
      title: 'Missing terms of service',
      description: 'No terms of service page found. Without ToS you have no legal recourse against abuse and cannot enforce refund policies.',
      fix_suggestion: 'Create `app/terms/page.tsx`. Include acceptable use, refund policy, and DMCA notice.',
    })
  }

  if (fileChecks.not_found_page === 'false' || fileChecks.not_found_page === '0') {
    issues.push({
      guard: 'distribution', category: 'ux', severity: 'low', confidence: 'confirmed',
      title: 'Missing custom 404 page',
      description: 'No custom not-found page. Users hitting a broken link see a generic error and leave.',
      fix_suggestion: isNextJs
        ? 'Create `app/not-found.tsx` with a helpful message and a link back to the homepage.'
        : 'Create a custom 404 page.',
    })
  }

  const hasAnalytics =
    fileChecks.has_plausible === 'true' ||
    fileChecks.has_google_analytics === 'true' ||
    fileChecks.has_posthog === 'true'

  if (!hasAnalytics) {
    issues.push({
      guard: 'distribution', category: 'analytics', severity: 'high', confidence: 'confirmed',
      title: 'No analytics installed',
      description: 'No analytics library detected. You cannot measure traffic, conversion funnels, or feature adoption without analytics.',
      fix_suggestion: 'Install Plausible (privacy-friendly, no cookie banner needed):\n```\nnpm install @plausible/next-js\n```\nOr PostHog for product analytics.',
    })
  }

  // ── Scalability ─────────────────────────────────────────────────────────────

  if (fileChecks.has_sentry === 'false') {
    issues.push({
      guard: 'scalability', category: 'monitoring', severity: 'high', confidence: 'confirmed',
      title: 'No error tracking',
      description: 'No Sentry or error tracking detected. When your app crashes in production, you will not know until users tell you.',
      fix_suggestion: 'Install Sentry:\n```\nnpm install @sentry/nextjs\nnpx @sentry/wizard@latest -i nextjs\n```',
    })
  }

  if (fileChecks.env_example === 'false') {
    issues.push({
      guard: 'scalability', category: 'configuration', severity: 'medium', confidence: 'confirmed',
      title: 'Missing .env.example',
      description: 'No .env.example file. Collaborators and future deployments need to know which environment variables are required.',
      fix_suggestion: 'Create `.env.example` with all required variable names and placeholder values:\n```\nNEXT_PUBLIC_SUPABASE_URL=your-project-url\nSUPABASE_SECRET_KEY=your-secret-key\n```',
    })
  }

  if (isNextJs && fileChecks.has_loading_tsx === '0') {
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'medium', confidence: 'confirmed',
      title: 'Missing loading.tsx boundaries',
      description: 'No loading.tsx found in the app directory. Users see blank screens during data fetching — hurts perceived performance and increases bounce rate.',
      fix_suggestion: 'Add `app/loading.tsx` with a skeleton or spinner:\n```tsx\nexport default function Loading() {\n  return <div className="animate-pulse">Loading…</div>\n}\n```',
    })
  }

  if (isNextJs && fileChecks.has_error_tsx === '0') {
    issues.push({
      guard: 'scalability', category: 'error-handling', severity: 'medium', confidence: 'confirmed',
      title: 'Missing error.tsx boundaries',
      description: 'No error.tsx found. Unhandled errors in route segments crash the entire page instead of showing a recoverable error UI.',
      fix_suggestion: 'Add `app/error.tsx`:\n```tsx\n"use client"\nexport default function Error({ reset }: { reset: () => void }) {\n  return <button onClick={reset}>Try again</button>\n}\n```',
    })
  }

  // use client overuse
  const useClientCount = parseInt(fileChecks.use_client_count ?? '0', 10)
  if (isNextJs && useClientCount >= 10) {
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'medium', confidence: 'likely',
      title: `High "use client" usage (${useClientCount} files)`,
      description: `${useClientCount} files have the "use client" directive. Each one ships its full dependency tree to the browser, increasing bundle size and slowing page load. Next.js Server Components are free — they never hit the client bundle.`,
      fix_suggestion: 'Audit each "use client" file. Remove the directive from components that do not use browser APIs, event handlers, useState, or useEffect. Keep it only where interactivity is required.',
    })
  }

  // Hallucinated packages
  if (fileChecks.hallucinated_packages) {
    const pkgs = fileChecks.hallucinated_packages.split(',').filter(Boolean)
    for (const pkg of pkgs) {
      issues.push({
        guard: 'security', category: 'supply-chain', severity: 'critical', confidence: 'possible',
        title: `Suspicious package: ${pkg}`,
        description: `\`${pkg}\` has very few (or zero) downloads on npm, suggesting it may be an AI-hallucinated package name. Attackers register fake packages with plausible names (typosquatting / dependency confusion) to inject malware into your build.`,
        fix_suggestion: `1. Verify \`${pkg}\` exists and is legitimate: visit https://www.npmjs.com/package/${pkg}\n2. Check the repository and publisher.\n3. If the package was suggested by an AI, replace it with a verified alternative.\n4. Consider using \`npm audit\` and \`socket.dev\` to monitor for suspicious packages.`,
      })
    }
  }

  return issues
}

// ── Main analyzer ──────────────────────────────────────────────────────────────

export async function analyzeToolOutputs(outputs: ToolOutputs): Promise<EnrichedIssue[]> {
  const allIssues: EnrichedIssue[] = []

  // Secrets — Gitleaks filesystem scan (highest confidence)
  allIssues.push(...parseGitleaks(outputs.gitleaks_fs,  'filesystem'))
  // Secrets — Gitleaks git history scan
  allIssues.push(...parseGitleaks(outputs.gitleaks_git, 'git'))

  // CVEs in dependencies
  if (!outputs.osv_skipped) {
    allIssues.push(...parseOSV(outputs.osv))
  }

  // SAST — Semgrep (p/nodejs + p/react + p/nextjs + custom rules)
  allIssues.push(...parseSemgrep(outputs.semgrep))

  // OWASP / PII / data flow — Bearer
  allIssues.push(...parseBearer(outputs.bearer))

  // Node.js-specific patterns — njsscan
  allIssues.push(...parseNjsscan(outputs.njsscan))

  // File-based checks (always run — no tool required)
  allIssues.push(...parseFileChecks(outputs.file_checks))

  // Deduplicate: same title + file_path + line_number
  return deduplicateIssues(allIssues)
}

function deduplicateIssues(issues: EnrichedIssue[]): EnrichedIssue[] {
  const seen = new Set<string>()
  return issues.filter(issue => {
    const key = `${issue.title}|${issue.file_path ?? ''}|${issue.line_number ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Score calculator ───────────────────────────────────────────────────────────

export function calculateScores(issues: EnrichedIssue[]): {
  security:     number
  scalability:  number
  monetization: number
  distribution: number
  overall:      number
} {
  const baseScore = 100

  // Weights per guard per severity — higher for security since consequences are worse
  const guardWeights: Record<string, Record<string, number>> = {
    security:     { critical: 18, high: 12, medium: 6,  low: 2 },
    scalability:  { critical: 14, high: 9,  medium: 4,  low: 1 },
    monetization: { critical: 16, high: 10, medium: 4,  low: 1 },
    distribution: { critical: 12, high: 7,  medium: 3,  low: 1 },
  }

  // Confidence multiplier — possible findings ding less
  const confidenceMultiplier: Record<string, number> = {
    confirmed: 1.0,
    likely:    0.7,
    possible:  0.4,
  }

  const guardDeductions: Record<string, number> = {
    security: 0, scalability: 0, monetization: 0, distribution: 0,
  }

  for (const issue of issues) {
    const weight = guardWeights[issue.guard]?.[issue.severity] ?? 5
    const mult   = confidenceMultiplier[issue.confidence ?? 'likely'] ?? 0.7
    guardDeductions[issue.guard] = (guardDeductions[issue.guard] ?? 0) + (weight * mult)
  }

  const scores = {
    security:     Math.max(0, Math.round(baseScore - guardDeductions.security)),
    scalability:  Math.max(0, Math.round(baseScore - guardDeductions.scalability)),
    monetization: Math.max(0, Math.round(baseScore - guardDeductions.monetization)),
    distribution: Math.max(0, Math.round(baseScore - guardDeductions.distribution)),
    overall: 0,
  }

  scores.overall = Math.round(
    scores.security     * 0.35 +
    scores.scalability  * 0.25 +
    scores.monetization * 0.20 +
    scores.distribution * 0.20
  )

  return scores
}
