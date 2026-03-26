// ── Types ──────────────────────────────────────────────────────────────────────

// Results from the grep-based source code checks.
// Each field is either the raw grep output (non-empty string = match found)
// or a boolean/count serialized as string.
export interface GrepCheckResults {
  // Security
  vite_secret_env_vars:    string  // VITE_* prefix on DB URLs, API keys, tokens
  next_public_secret_vars: string  // NEXT_PUBLIC_* on secret-looking vars
  hardcoded_api_keys:      string  // Literal API key patterns in source
  client_side_db_import:   string  // ORM/DB client imported in src/ (browser code)
  console_log_secrets:     string  // console.log(env/key/token/password)
  debug_mode_enabled:      string  // DEBUG=true / debug: true in non-dev config
  window_node_polyfill:    string  // window.Buffer / window.process polyfills
  predictable_jwt_secrets: string  // common placeholder JWT/session secrets
  cors_wildcard:           string  // Access-Control-Allow-Origin: * in API routes
  sql_injection_template:  string  // Backtick template-string SQL queries
  dangerously_set_html:    string  // dangerouslySetInnerHTML usage
  // Scalability
  img_tag_not_next_image:  string  // <img> instead of next/image
  images_unoptimized:      string  // images.unoptimized: true in next.config
  sync_file_io:            string  // readFileSync/writeFileSync in API handlers
  interval_not_cleared:    string  // setInterval() never cleared
  console_log_count:       string  // count of console.log lines in source
  // Distribution
  default_app_title:       string  // "Vite App" / "Create React App" title still set
  // Dep-based flags
  has_rate_limiting:       string  // 'true' | 'false'
  has_auth_library:        string  // 'true' | 'false'
  has_middleware:          string  // 'true' | 'false'
  has_input_validation:    string  // 'true' | 'false' — zod/joi/yup/valibot
  has_structured_logging:  string  // 'true' | 'false' — pino/winston/bunyan
  framework:               string
  // SaaS-specific checks
  jwt_in_localstorage:     string  // localStorage.setItem with token/jwt/accessToken
  live_api_keys_in_source: string  // sk_live_, pk_live_, whsec_ in source (not .env)
  vite_meta_env_secrets:   string  // import.meta.env.VITE_* secret vars
}

// Vibe issue from the in-process vibe-leak-detector
export interface VibeIssueInput {
  file:        string
  line:        number
  severity:    'critical' | 'high' | 'medium' | 'low'
  guard:       string
  title:       string
  description: string
  snippet:     string
  fix:         string
  confidence:  'confirmed' | 'likely' | 'possible'
}

export interface ToolOutputs {
  scan_id?: string
  framework?: string
  // Gitleaks (replaces TruffleHog)
  gitleaks_fs:  unknown[]
  gitleaks_git: unknown[]
  // OSV-Scanner
  osv:          unknown
  // Semgrep (local custom rules only)
  semgrep:      unknown
  // Grep-based source code checks
  grep_checks:  GrepCheckResults
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
    has_polar:            string
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
    // Pre-production checklist additions
    has_db_migrations:      string  // migrations/ or supabase/migrations directory
  }
  // Vibe-leak-detector issues (in-process regex/AST scanner)
  vibe_issues?:     VibeIssueInput[]
  // External phased scans
  osint_issues?:    ExternalIssueInput[]
  dast_issues?:     ExternalIssueInput[]
  osv_skipped:      boolean
  osv_skip_reason:  string | null
}

export interface ExternalIssueInput {
  guard: string
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  fix_suggestion: string
  confidence?: 'confirmed' | 'likely' | 'possible'
  file_path?: string
  line_number?: number
  code_snippet?: string
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
    if (id.includes('graft.distribution') || id.includes('shipguard.distribution') || id.includes('.seo') || id.includes('.og') || id.includes('.meta') || id.includes('cookie-consent')) {
      guard = 'distribution'
    } else if (id.includes('graft.monetization') || id.includes('shipguard.monetization') || id.includes('webhook') || id.includes('stripe') || id.includes('checkout') || id.includes('price') || id.includes('paddle') || id.includes('lemonsqueezy')) {
      guard = 'monetization'
    } else if (id.includes('graft.scalability') || id.includes('shipguard.scalability') || id.includes('console') || id.includes('performance') || id.includes('prisma') || id.includes('pagination') || id.includes('use-client')) {
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

// ── Grep-checks parser ─────────────────────────────────────────────────────────
//
// Each check: if the grep output is non-empty → issue found.
// We extract the first matching line as the code_snippet / file hint where relevant.

function parseGrepChecks(g: GrepCheckResults): EnrichedIssue[] {
  const issues: EnrichedIssue[] = []
  const framework = g.framework ?? 'unknown'
  const isNextJs  = framework === 'nextjs'
  const isVite    = framework === 'react-vite'

  // Helper: first line of grep output → used as snippet
  const firstLine = (raw: string) => raw.split('\n')[0]?.trim() ?? ''
  // Helper: extract file:line from grep output like "src/db.ts:5:import..."
  const extractFile = (raw: string): { file?: string; line?: number } => {
    const match = raw.match(/^([^:]+):(\d+):/)
    if (match) return { file: match[1], line: parseInt(match[2], 10) }
    return {}
  }

  // ── S1.1 VITE_ secret env vars ────────────────────────────────────────────────
  if (g.vite_secret_env_vars && isVite) {
    const { file, line } = extractFile(g.vite_secret_env_vars)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'critical', confidence: 'confirmed',
      title: 'VITE_ prefix exposes secrets to the browser',
      description: 'Environment variables prefixed with `VITE_` are embedded into the JavaScript bundle at build time and are visible to anyone who opens DevTools. Database URLs, API keys, and tokens with this prefix are fully exposed to end users.',
      fix_suggestion: 'Move all secret env vars (DB URLs, API keys, tokens) to a backend API route. Only `VITE_APP_TITLE`, `VITE_PUBLIC_URL`, and similar non-secret vars should use the `VITE_` prefix.\n\nCreate an API endpoint:\n```ts\n// src/api/data.ts (server-side only)\nimport { db } from "./db" // uses DATABASE_URL (no VITE_ prefix)\n```',
      code_snippet: firstLine(g.vite_secret_env_vars),
      file_path: file,
      line_number: line,
    })
  }

  // ── S1.2 NEXT_PUBLIC_ secret vars ─────────────────────────────────────────────
  if (g.next_public_secret_vars && isNextJs) {
    const { file, line } = extractFile(g.next_public_secret_vars)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'critical', confidence: 'likely',
      title: 'NEXT_PUBLIC_ prefix exposes secret to browser',
      description: 'Variables prefixed `NEXT_PUBLIC_` are inlined into the client-side bundle. A secret-looking variable (API key, token, password) with this prefix is visible to all users in the browser.',
      fix_suggestion: 'Remove the `NEXT_PUBLIC_` prefix from any secret variable. Access it only in Server Components, API routes (`app/api/`), or server actions — never in client components.',
      code_snippet: firstLine(g.next_public_secret_vars),
      file_path: file,
      line_number: line,
    })
  }

  // ── S1.3 Hardcoded API key pattern in source ───────────────────────────────────
  if (g.hardcoded_api_keys) {
    const { file, line } = extractFile(g.hardcoded_api_keys)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'critical', confidence: 'likely',
      title: 'API key hardcoded in source code',
      description: 'A raw API key or token pattern was found directly in source code (not via an environment variable). Anyone with read access to the repository — including public GitHub — can use this key.',
      fix_suggestion: '1. Rotate the key immediately in the service dashboard — assume it is compromised.\n2. Replace the hardcoded value with `process.env.YOUR_KEY_NAME`.\n3. Add `.env` to `.gitignore` and use `.env.example` with placeholder values.',
      code_snippet: firstLine(g.hardcoded_api_keys),
      file_path: file,
      line_number: line,
    })
  }

  // ── S1.6 DB client imported in frontend/browser source ─────────────────────────
  if (g.client_side_db_import) {
    const { file, line } = extractFile(g.client_side_db_import)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'critical', confidence: 'confirmed',
      title: 'Database client imported in browser-side code',
      description: 'A database ORM or client (`drizzle-orm`, `@neondatabase/serverless`, `@prisma/client`, `pg`) is imported in `src/` — code that runs in the browser. This means any user can execute arbitrary database queries directly from DevTools using your connection credentials.',
      fix_suggestion: 'Move ALL database access to a server-side API route or server action:\n```ts\n// app/api/data/route.ts (server only)\nimport { db } from "@/lib/db"\nexport async function GET() {\n  const rows = await db.select().from(table)\n  return Response.json(rows)\n}\n```\nThe `src/` directory should never import database clients.',
      code_snippet: firstLine(g.client_side_db_import),
      file_path: file,
      line_number: line,
    })
  }

  // ── S1.7 console.log printing secrets ──────────────────────────────────────────
  if (g.console_log_secrets) {
    const { file, line } = extractFile(g.console_log_secrets)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'high', confidence: 'likely',
      title: 'console.log printing sensitive values',
      description: 'A `console.log` statement appears to print env vars, API keys, tokens, or passwords. In browser code this is visible in DevTools; in server code it may appear in log aggregation services accessible to attackers.',
      fix_suggestion: 'Remove all `console.log` statements that print secret values. Use a structured logger (e.g. `pino`) that can redact sensitive fields, and never log full credentials — at most log truncated prefixes for debugging.',
      code_snippet: firstLine(g.console_log_secrets),
      file_path: file,
      line_number: line,
    })
  }

  // ── S2.3 Hardcoded default credentials — now handled by LLM ──────────────────
  // ── S2.6 userId from request body — now handled by LLM ───────────────────────
  // ── S3.1 SQL template literal injection — now handled by LLM ─────────────────
  // ── S3.2 eval() usage — now handled by LLM ───────────────────────────────────
  // ── S3.3 dangerouslySetInnerHTML — now handled by LLM ────────────────────────
  // ── S4.1/S4.2 CORS wildcard — now handled by LLM ─────────────────────────────

  // ── S4.4 DEBUG=true in production config ──────────────────────────────────────────
  if (g.debug_mode_enabled) {
    const { file, line } = extractFile(g.debug_mode_enabled)
    issues.push({
      guard: 'security', category: 'configuration', severity: 'medium', confidence: 'likely',
      title: 'Debug mode enabled in production config',
      description: '`DEBUG=true` or `debug: true` found in a non-dev config file. Debug mode typically enables full stack traces in HTTP error responses, verbose logging, and sometimes disables auth checks — all useful to attackers.',
      fix_suggestion: 'Ensure debug mode is disabled in production:\n```python\n# Python / FastAPI\nDEBUG=False  # in .env or config\n```\n```ts\n// Node.js\nconst isDev = process.env.NODE_ENV === "development"\n```\nNever commit `DEBUG=true` to `.env.example`.',
      code_snippet: firstLine(g.debug_mode_enabled),
      file_path: file,
      line_number: line,
    })
  }

  // ── S4.6 Node.js globals polyfilled onto window ───────────────────────────────────
  if (g.window_node_polyfill) {
    const { file, line } = extractFile(g.window_node_polyfill)
    issues.push({
      guard: 'security', category: 'configuration', severity: 'medium', confidence: 'confirmed',
      title: 'Node.js globals (Buffer/process) polyfilled onto window',
      description: '`window.Buffer` or `window.process` is being set globally. This means any third-party script, browser extension, or XSS payload can read `window.process.env` — potentially exposing all environment variables that were bundled at build time.',
      fix_suggestion: 'Remove the global polyfill. Instead, import `Buffer` directly where needed:\n```ts\nimport { Buffer } from "buffer"\n// Use it locally, not via window\n```\nIf a library requires `Buffer` globally, use Vite\'s `define` config instead:\n```ts\n// vite.config.ts\ndefine: { global: "globalThis" }\n```',
      code_snippet: firstLine(g.window_node_polyfill),
      file_path: file,
      line_number: line,
    })
  }

  // ── S4.8 predictable JWT/session secrets ───────────────────────────────────────
  if (g.predictable_jwt_secrets) {
    const { file, line } = extractFile(g.predictable_jwt_secrets)
    issues.push({
      guard: 'security', category: 'authentication', severity: 'critical', confidence: 'confirmed',
      title: 'Predictable JWT/session secret detected',
      description: 'A known placeholder secret (`supersecretkey`, `your-secret-key-here`, etc.) appears in source or env files. Attackers can forge valid session/JWT tokens if this value is used in production.',
      fix_suggestion: 'Replace with a strong random secret (at least 32 bytes), rotate all active tokens/sessions, and move the value to a server-only environment variable.\n\nExample:\n```bash\nopenssl rand -base64 48\n```',
      code_snippet: firstLine(g.predictable_jwt_secrets),
      file_path: file,
      line_number: line,
    })
  }

  // ── SaaS: JWT stored in localStorage ──────────────────────────────────────────
  if (g.jwt_in_localstorage) {
    const { file, line } = extractFile(g.jwt_in_localstorage)
    issues.push({
      guard: 'security', category: 'authentication', severity: 'high', confidence: 'confirmed',
      title: 'Auth token stored in localStorage (XSS-stealable)',
      description: '`localStorage.setItem` is used to store a JWT or auth token. `localStorage` is readable by any JavaScript on the page — any XSS injection can steal the token and fully impersonate the user with no interaction required.',
      fix_suggestion: 'Store auth tokens in `httpOnly` cookies (inaccessible to JavaScript):\n```ts\n// Server-side:\ncookies().set("token", value, { httpOnly: true, secure: true, sameSite: "lax" })\n```\nOr use NextAuth / Clerk / Supabase Auth which manage secure cookie sessions automatically.',
      code_snippet: firstLine(g.jwt_in_localstorage),
      file_path: file,
      line_number: line,
    })
  }

  // ── SaaS: Live API keys hardcoded in source ────────────────────────────────────
  if (g.live_api_keys_in_source) {
    const { file, line } = extractFile(g.live_api_keys_in_source)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'critical', confidence: 'confirmed',
      title: 'Live Stripe/payment API key hardcoded in source',
      description: 'A live Stripe key (`sk_live_`, `pk_live_`) or webhook secret (`whsec_`) was found directly in source code. This key is fully functional — it grants complete access to your payment account and is likely already compromised if the repo is public.',
      fix_suggestion: '1. **Rotate the key immediately** in the Stripe dashboard.\n2. Move to environment variable: `process.env.STRIPE_SECRET_KEY`.\n3. Audit your git history — the key may still be in older commits.',
      code_snippet: firstLine(g.live_api_keys_in_source),
      file_path: file,
      line_number: line,
    })
  }

  // ── SaaS: import.meta.env.VITE_* secrets in client bundle ────────────────────
  if (g.vite_meta_env_secrets) {
    const { file, line } = extractFile(g.vite_meta_env_secrets)
    issues.push({
      guard: 'security', category: 'secrets', severity: 'high', confidence: 'confirmed',
      title: 'Secret variable exposed via import.meta.env.VITE_ in client bundle',
      description: 'A `VITE_*` env variable with a secret-looking name (KEY, SECRET, TOKEN, DATABASE) is accessed in frontend code. All `VITE_*` variables are inlined at build time into the browser bundle — anyone can read them in the page source.',
      fix_suggestion: 'Remove the `VITE_` prefix from secret variables. Access them only in server-side code (API routes, server functions). Only truly public values (e.g. `VITE_PUBLIC_APP_NAME`) should use the `VITE_` prefix.',
      code_snippet: firstLine(g.vite_meta_env_secrets),
      file_path: file,
      line_number: line,
    })
  }

  // ── CORS wildcard ─────────────────────────────────────────────────────────────
  if (g.cors_wildcard) {
    const { file, line } = extractFile(g.cors_wildcard)
    issues.push({
      guard: 'security', category: 'cors', severity: 'high', confidence: 'confirmed',
      title: 'CORS wildcard allows requests from any origin',
      description: '`Access-Control-Allow-Origin: *` found in an API route. This allows any website to make cross-origin requests to your API — including reading authenticated responses if the route does not also check cookies/auth headers.',
      fix_suggestion: 'Restrict CORS to your own origin:\n```ts\nreturn new Response(body, {\n  headers: {\n    "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL ?? "",\n    "Access-Control-Allow-Methods": "GET,POST",\n    "Access-Control-Allow-Headers": "Content-Type,Authorization",\n  },\n})\n```\nFor Next.js, configure this in `next.config.ts` `headers()` using the `/api/(.*)` source pattern.',
      code_snippet: firstLine(g.cors_wildcard),
      file_path: file,
      line_number: line,
    })
  }

  // ── SQL injection via template string ────────────────────────────────────────
  if (g.sql_injection_template) {
    const { file, line } = extractFile(g.sql_injection_template)
    issues.push({
      guard: 'security', category: 'injection', severity: 'critical', confidence: 'likely',
      title: 'Possible SQL injection via template string query',
      description: 'A database query appears to use a template literal (`\`SELECT … ${var}\``) to interpolate user-supplied or external values directly into SQL. An attacker can manipulate the query to read, modify, or delete arbitrary data.',
      fix_suggestion: 'Always use parameterized queries or a query builder:\n```ts\n// Dangerous:\ndb.query(`SELECT * FROM users WHERE id = ${userId}`)\n\n// Safe (parameterized):\ndb.query("SELECT * FROM users WHERE id = $1", [userId])\n\n// Safe (ORM):\ndb.select().from(users).where(eq(users.id, userId))\n```',
      code_snippet: firstLine(g.sql_injection_template),
      file_path: file,
      line_number: line,
    })
  }

  // ── dangerouslySetInnerHTML XSS ──────────────────────────────────────────────
  if (g.dangerously_set_html) {
    const { file, line } = extractFile(g.dangerously_set_html)
    issues.push({
      guard: 'security', category: 'xss', severity: 'high', confidence: 'likely',
      title: 'dangerouslySetInnerHTML may enable XSS',
      description: '`dangerouslySetInnerHTML` renders raw HTML into the DOM. If the HTML string comes from user input or an external source without sanitization, an attacker can inject `<script>` tags to execute arbitrary JavaScript in your users\' browsers.',
      fix_suggestion: 'Sanitize HTML before rendering with DOMPurify:\n```ts\nimport DOMPurify from "dompurify"\n\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />\n```\nOr avoid `dangerouslySetInnerHTML` entirely and use a Markdown renderer (`react-markdown`) with a content security policy.',
      code_snippet: firstLine(g.dangerously_set_html),
      file_path: file,
      line_number: line,
    })
  }

  // ── Input validation missing ──────────────────────────────────────────────────
  if (g.has_input_validation === 'false') {
    issues.push({
      guard: 'security', category: 'input-validation', severity: 'high', confidence: 'confirmed',
      title: 'No input validation library detected',
      description: 'No schema validation library (`zod`, `joi`, `yup`, `valibot`) found in dependencies. Without validation, API routes accept any shape of input — attackers can send unexpected types, missing fields, or oversized payloads that crash or corrupt your application.',
      fix_suggestion: 'Add Zod to validate all API inputs:\n```ts\nnpm install zod\n```\n```ts\nimport { z } from "zod"\n\nconst schema = z.object({\n  email: z.string().email(),\n  planId: z.enum(["pro", "unlimited"]),\n})\n\nexport async function POST(req: Request) {\n  const parsed = schema.safeParse(await req.json())\n  if (!parsed.success) {\n    return Response.json({ error: parsed.error.flatten() }, { status: 400 })\n  }\n  // use parsed.data safely\n}\n```',
    })
  }

  // ── Structured logging missing ────────────────────────────────────────────────
  if (g.has_structured_logging === 'false') {
    issues.push({
      guard: 'scalability', category: 'logging', severity: 'medium', confidence: 'confirmed',
      title: 'No structured logging library detected',
      description: 'No structured logging library (`pino`, `winston`, `bunyan`) found. Without structured logs, debugging production issues requires manually grepping through unformatted console output — making it nearly impossible to correlate events across requests or filter by severity.',
      fix_suggestion: 'Add Pino (fastest Node.js logger):\n```ts\nnpm install pino\n```\n```ts\nimport pino from "pino"\nconst logger = pino({ level: process.env.LOG_LEVEL ?? "info" })\n\n// Usage:\nlogger.info({ userId, scanId }, "scan started")\nlogger.error({ err, traceId }, "scan failed")\n```\nPino outputs JSON that integrates with Datadog, Logflare, and other log aggregators.',
    })
  }
  // ── SC1.4 N+1 query pattern — now handled by LLM ─────────────────────────────
  // ── SC1.5 select() with no .where() — now handled by LLM ────────────────────

  // ── SC2.1 <img> instead of next/image ────────────────────────────────────────────
  if (g.img_tag_not_next_image && isNextJs) {
    const { file, line } = extractFile(g.img_tag_not_next_image)
    // Count occurrences for context
    const count = g.img_tag_not_next_image.split('\n').filter(Boolean).length
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'medium', confidence: 'confirmed',
      title: `Raw <img> tags instead of next/image (${count} found)`,
      description: `${count} raw \`<img>\` tag(s) found. Next.js \`<Image>\` from \`next/image\` automatically optimizes images (WebP/AVIF conversion, responsive sizes, lazy loading, blur placeholder). Using raw \`<img>\` ships full-size PNGs/JPEGs, significantly slowing load times.`,
      fix_suggestion: '```tsx\nimport Image from "next/image"\n\n// Replace:\n<img src="/hero.png" width={800} height={400} alt="Hero" />\n\n// With:\n<Image src="/hero.png" width={800} height={400} alt="Hero" />\n```',
      code_snippet: firstLine(g.img_tag_not_next_image),
      file_path: file,
      line_number: line,
    })
  }

  // ── SC2.6 images.unoptimized: true ────────────────────────────────────────────────
  if (g.images_unoptimized && isNextJs) {
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'medium', confidence: 'confirmed',
      title: 'Image optimization disabled (images.unoptimized: true)',
      description: '`images.unoptimized: true` is set in `next.config`. This disables Next.js image optimization globally — all images ship as full-size originals with no WebP conversion, no responsive sizes, and no lazy loading optimization.',
      fix_suggestion: 'Remove `unoptimized: true` from `next.config.ts`. If you are deploying to a static export, use a CDN or image optimization service instead.',
      code_snippet: firstLine(g.images_unoptimized),
    })
  }

  // ── SC3.2 Synchronous file I/O in request handlers ────────────────────────────────
  if (g.sync_file_io) {
    const { file, line } = extractFile(g.sync_file_io)
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'high', confidence: 'confirmed',
      title: 'Synchronous file I/O in API handler',
      description: '`readFileSync` or `writeFileSync` is used in an API route. Synchronous I/O blocks Node.js\'s event loop — while the file is being read, no other requests can be processed. Under load this causes all requests to queue up.',
      fix_suggestion: 'Use async file I/O:\n```ts\nimport { readFile, writeFile } from "node:fs/promises"\n\nconst content = await readFile(path, "utf-8")\n```',
      code_snippet: firstLine(g.sync_file_io),
      file_path: file,
      line_number: line,
    })
  }

  // ── SC3.6 setInterval not cleared ────────────────────────────────────────────────
  if (g.interval_not_cleared) {
    const { file, line } = extractFile(g.interval_not_cleared)
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'medium', confidence: 'likely',
      title: 'setInterval() without clearInterval() (memory leak)',
      description: '`setInterval()` is used without a corresponding `clearInterval()`. In React components, this creates a new interval on every render and never clears old ones — causing memory leaks and duplicate callbacks that accumulate over the session.',
      fix_suggestion: 'Always clean up intervals in a useEffect cleanup:\n```ts\nuseEffect(() => {\n  const id = setInterval(() => { /* ... */ }, 1000)\n  return () => clearInterval(id) // cleanup on unmount\n}, [])\n```',
      code_snippet: firstLine(g.interval_not_cleared),
      file_path: file,
      line_number: line,
    })
  }

  // ── SC3.3 Excessive console.log ──────────────────────────────────────────────────
  const consoleLogCount = parseInt(g.console_log_count ?? '0', 10)
  if (consoleLogCount >= 20) {
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'low', confidence: 'confirmed',
      title: `Excessive console.log usage (${consoleLogCount} statements)`,
      description: `${consoleLogCount} \`console.log\` statements found in source. In production, these add noise to server logs (making real errors harder to find), slow down hot paths with string serialization, and may accidentally log sensitive data to browser consoles.`,
      fix_suggestion: 'Remove debug `console.log` statements before deploying. Use a structured logger:\n```ts\nimport pino from "pino"\nconst logger = pino()\nlogger.info({ userId }, "user logged in") // structured, filterable\n```\nOr set `console.log = () => {}` in production as a last resort.',
    })
  }

  // ── D1.6 Default app title ───────────────────────────────────────────────────────
  if (g.default_app_title) {
    const { file, line } = extractFile(g.default_app_title)
    issues.push({
      guard: 'distribution', category: 'seo', severity: 'medium', confidence: 'confirmed',
      title: 'Default framework title still set ("Vite App" / "React App")',
      description: 'The page title is still set to the scaffolded default ("Vite App", "Create React App", etc.). This appears in browser tabs, search engine results, and social shares — making the app look unfinished and hurting SEO.',
      fix_suggestion: 'Update the `<title>` in `index.html` (Vite) or the metadata in `app/layout.tsx` (Next.js) to your actual app name and a short value proposition.',
      code_snippet: firstLine(g.default_app_title),
      file_path: file,
      line_number: line,
    })
  }

  // ── M1.2 Price/amount from request body — now handled by LLM ────────────────
  // ── M1.5 Floating point for money — now handled by LLM ───────────────────────
  // ── Auth: API routes without auth check — now handled by LLM ─────────────────

  // ── SC: No rate limiting ───────────────────────────────────────────────────────────
  if (g.has_rate_limiting === 'false' && isNextJs) {
    issues.push({
      guard: 'scalability', category: 'performance', severity: 'high', confidence: 'confirmed',
      title: 'No rate limiting on API endpoints',
      description: 'No rate limiting library detected (`@upstash/ratelimit`, `rate-limiter-flexible`, `express-rate-limit`). Without rate limiting, a single user can make unlimited requests — crashing your server, running up API bills, or brute-forcing auth endpoints.',
      fix_suggestion: 'Add rate limiting with Upstash (works on Vercel edge/serverless):\n```ts\nnpm install @upstash/ratelimit @upstash/redis\n```\n```ts\nimport { Ratelimit } from "@upstash/ratelimit"\nimport { Redis } from "@upstash/redis"\n\nconst ratelimit = new Ratelimit({\n  redis: Redis.fromEnv(),\n  limiter: Ratelimit.slidingWindow(10, "10 s"),\n})\n\nexport async function POST(req: Request) {\n  const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1"\n  const { success } = await ratelimit.limit(ip)\n  if (!success) return new Response("Too Many Requests", { status: 429 })\n  // ...\n}\n```',
    })
  }

  // ── Security: No auth library + no middleware ──────────────────────────────────────
  // (Complement to file_checks.has_auth_library — covers the React-Vite SPA case)
  if (g.has_auth_library === 'false' && isVite) {
    issues.push({
      guard: 'security', category: 'authentication', severity: 'high', confidence: 'confirmed',
      title: 'No authentication library detected (Vite SPA)',
      description: 'No auth library (`@clerk/react`, `firebase`, `@supabase/supabase-js`, `lucia`, `@auth0/auth0-react`) found in dependencies. A public SPA with no auth means any user can access all routes and any backend calls are unauthenticated.',
      fix_suggestion: 'Add an auth provider. For a Vite React SPA, Clerk or Supabase Auth are easiest:\n```bash\nnpm install @clerk/react\n```\nWrap your app in `<ClerkProvider>` and protect routes with `<SignedIn>` / `<SignedOut>` components.',
    })
  }

  return issues
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
    fileChecks.has_razorpay === 'true' ||
    fileChecks.has_polar === 'true'

  if (!hasAnyPayment) {
    issues.push({
      guard: 'monetization', category: 'payments', severity: 'high', confidence: 'confirmed',
      title: 'No payment integration detected',
      description: 'No Stripe, Paddle, LemonSqueezy, Razorpay, or Polar library found in package.json. You cannot charge users without a payment provider.',
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

  const shouldCheckNotFound = framework !== 'nuxt'
  if (shouldCheckNotFound && (fileChecks.not_found_page === 'false' || fileChecks.not_found_page === '0')) {
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

  // ── Pre-production checklist: Database Migrations / Indexing ─────────────────
  if (fileChecks.has_db_migrations === 'false') {
    issues.push({
      guard: 'scalability', category: 'database', severity: 'medium', confidence: 'possible',
      title: 'No database migration directory detected',
      description: 'No `migrations/`, `supabase/migrations/`, or `drizzle/` directory found. Without tracked migrations, schema changes are applied ad-hoc — making it impossible to reproduce the database schema in a new environment, or roll back after a bad deployment.',
      fix_suggestion: 'Track all schema changes as versioned migration files:\n- **Supabase**: use `supabase migration new <name>` and commit the generated SQL under `supabase/migrations/`\n- **Drizzle**: use `drizzle-kit generate` and commit the output\n- **Prisma**: use `prisma migrate dev` and commit `prisma/migrations/`\n\nAdd database indexes on frequently queried columns:\n```sql\nCREATE INDEX CONCURRENTLY idx_users_email ON users(email);\nCREATE INDEX CONCURRENTLY idx_scans_user_id ON scans(user_id);\n```',
    })
  }

  return issues
}

// ── Vibe-leak-detector parser ──────────────────────────────────────────────────

function parseVibeIssues(vibeIssues: VibeIssueInput[]): EnrichedIssue[] {
  return vibeIssues.map(v => ({
    guard:          v.guard as EnrichedIssue['guard'],
    category:       v.guard,
    severity:       v.severity,
    confidence:     v.confidence,
    title:          v.title,
    description:    v.description,
    fix_suggestion: v.fix,
    code_snippet:   v.snippet || undefined,
    file_path:      v.file,
    line_number:    v.line > 0 ? v.line : undefined,
  }))
}

function parseExternalIssues(externalIssues: ExternalIssueInput[]): EnrichedIssue[] {
  return externalIssues.map((issue) => ({
    guard: issue.guard,
    category: issue.category,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    fix_suggestion: issue.fix_suggestion,
    confidence: issue.confidence ?? 'possible',
    file_path: issue.file_path,
    line_number: issue.line_number,
    code_snippet: issue.code_snippet,
  }))
}

function shouldSuppressIssue(issue: EnrichedIssue): boolean {
  const file = (issue.file_path ?? '').replace(/^\.\//, '').trim()
  const title = issue.title.toLowerCase()

  if (
    file.startsWith('trigger/helpers/vibe-leak-detector.ts') ||
    file.startsWith('lib/ai/analyzer.ts') ||
    file.startsWith('trigger/run-scan.ts') ||
    file.startsWith('semgrep-rules/')
  ) {
    const scannerFalsePositives = [
      'auth token stored in localstorage',
      'predictable jwt/session secret',
      'next_public_ prefix exposes secret',
      'dangerouslysetinnerhtml',
      'eval() or new function()',
      'node.js globals (buffer/process) polyfilled onto window',
      'debug mode enabled in production config',
      'console.log',
      'n+1 query: database call inside loop',
      'unbounded supabase query',
      'live api key hardcoded',
    ]
    if (scannerFalsePositives.some((t) => title.includes(t))) {
      return true
    }
  }

  if (title.includes('no account deletion')) {
    return true
  }

  return false
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

  // SAST — Semgrep (local custom rules only)
  allIssues.push(...parseSemgrep(outputs.semgrep))

  // Vibe-leak-detector — in-process regex/AST scanner (new)
  if (outputs.vibe_issues && outputs.vibe_issues.length > 0) {
    allIssues.push(...parseVibeIssues(outputs.vibe_issues))
  }

  // OSINT / DAST phased checks (external surface)
  if (outputs.osint_issues && outputs.osint_issues.length > 0) {
    allIssues.push(...parseExternalIssues(outputs.osint_issues))
  }
  if (outputs.dast_issues && outputs.dast_issues.length > 0) {
    allIssues.push(...parseExternalIssues(outputs.dast_issues))
  }

  // Grep-based source code checks — deterministic, unambiguous patterns
  allIssues.push(...parseGrepChecks(outputs.grep_checks))

  // File-based checks (always run — no tool required)
  allIssues.push(...parseFileChecks(outputs.file_checks))

  const filteredIssues = allIssues.filter((issue) => !shouldSuppressIssue(issue))

  // Deduplicate: same title + file_path + line_number
  return deduplicateIssues(filteredIssues)
}

function deduplicateIssues(issues: EnrichedIssue[]): EnrichedIssue[] {
  const seen = new Set<string>()
  return issues.filter(issue => {
    const file = normalizeFilePath(issue.file_path)
    const line = issue.line_number ?? ''
    const title = normalizeIssueTitle(issue.title)
    const category = issue.category ?? ''
    const key = `${issue.guard}|${category}|${title}|${file}|${line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeFilePath(filePath?: string): string {
  if (!filePath) return ''
  return filePath.replace(/^\.\//, '').trim()
}

function normalizeIssueTitle(title: string): string {
  const raw = title.toLowerCase().trim()

  if (
    raw.includes('secret env var exposed') ||
    raw.includes('secret variable exposed') ||
    raw.includes('vite_ prefix exposes secrets') ||
    raw.includes('next_public_ prefix exposes secret')
  ) {
    return 'client_exposed_secret_env'
  }

  if (raw.includes('setinterval') && raw.includes('clearinterval')) {
    return 'interval_without_cleanup'
  }

  return raw
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
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
