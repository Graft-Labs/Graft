/**
 * vibe-leak-detector.ts
 *
 * Regex + simple AST-pattern scanner for vibe-coded app mistakes.
 * Runs entirely in-process (no external tools), fast (~1-3s for medium repos).
 *
 * Each check:
 * - Reads only relevant source files (TS/TSX/JS/JSX), excludes node_modules/.next/dist/tests/vendor
 * - Returns an array of VibeIssue with { file, line, severity, title, description, snippet, fix }
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'

export interface VibeIssue {
  file:        string
  line:        number
  severity:    'critical' | 'high' | 'medium' | 'low'
  guard:       'security' | 'scalability' | 'monetization' | 'distribution'
  title:       string
  description: string
  snippet:     string
  fix:         string
  confidence:  'confirmed' | 'likely' | 'possible'
}

// ── File walker config ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out',
  '.vercel', 'coverage', '__pycache__', '.pytest_cache', 'vendor',
  '.cache', 'public', 'static', 'assets',
])

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const TEST_PATH_RE = /\.(test|spec)\.[tj]sx?$|__tests__|\/tests?\//i

// ── Walk source files ──────────────────────────────────────────────────────────

async function walkSourceFiles(cloneDir: string): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = join(dir, entry)
      const rel  = relative(cloneDir, full)

      const topDir = rel.split('/')[0]
      if (SKIP_DIRS.has(topDir) || SKIP_DIRS.has(entry)) continue

      let s: { isDirectory(): boolean; size: number }
      try { s = await stat(full) } catch { continue }

      if (s.isDirectory()) { await walk(full); continue }

      const ext = extname(entry).toLowerCase()
      if (!SOURCE_EXTS.has(ext)) continue
      if (TEST_PATH_RE.test(rel)) continue
      if (s.size > 200_000) continue  // skip generated/minified behemoths

      results.push(full)
    }
  }

  await walk(cloneDir)
  return results
}

// ── Pattern definitions ────────────────────────────────────────────────────────

interface FileResult {
  fullPath: string
  rel:      string
  lines:    string[]
  content:  string
  isClientComponent: boolean
  isServerAction:    boolean
}

async function loadFile(fullPath: string, cloneDir: string): Promise<FileResult | null> {
  try {
    const content = await readFile(fullPath, 'utf-8')
    const lines   = content.split('\n')
    const rel     = relative(cloneDir, fullPath)

    // Detect 'use client' directive (first 3 non-empty lines)
    const top3 = lines.slice(0, 5).join('\n')
    const isClientComponent = /['"]use client['"]/i.test(top3)
    const isServerAction    = /['"]use server['"]/i.test(top3)

    return { fullPath, rel, lines, content, isClientComponent, isServerAction }
  } catch { return null }
}

// Helper: create a VibeIssue
function issue(
  rel: string,
  lineNum: number,
  snippet: string,
  overrides: Omit<VibeIssue, 'file' | 'line' | 'snippet'>
): VibeIssue {
  return { file: rel, line: lineNum, snippet: snippet.trim().slice(0, 200), ...overrides }
}

// ── Individual checks ─────────────────────────────────────────────────────────

/**
 * CHECK 1: DB import in 'use client' component
 * "Direct DB queries from client components"
 */
function checkClientSideDbImport(f: FileResult): VibeIssue[] {
  if (!f.isClientComponent) return []

  const DB_IMPORT_RE = /from\s+['"](@prisma\/client|drizzle-orm|@neondatabase|pg|mysql2|mongoose|@supabase\/supabase-js|better-sqlite3)['"]/

  for (let i = 0; i < f.lines.length; i++) {
    if (DB_IMPORT_RE.test(f.lines[i])) {
      return [issue(f.rel, i + 1, f.lines[i], {
        guard: 'security', severity: 'critical', confidence: 'confirmed',
        title: 'Database client imported in "use client" component',
        description: `\`${f.rel}\` has both \`"use client"\` and a direct database import. The DB connection string ships to the browser — any visitor can execute raw queries against your database.`,
        fix: 'Remove the DB import. Fetch data via a Server Component, API route, or Server Action instead:\n```ts\n// app/api/data/route.ts\nimport { db } from "@/lib/db"\nexport async function GET() { ... }\n```',
      })]
    }
  }
  return []
}

/**
 * CHECK 2: useEffect with missing/empty dependency array (React hooks)
 * Catches the most common infinite re-render pattern
 */
function checkUseEffectInfiniteRerender(f: FileResult): VibeIssue[] {
  if (!f.content.includes('useEffect')) return []

  const issues: VibeIssue[] = []

  // Pattern A: setState called inside useEffect with no deps array at all
  // useEffect(() => { setX(...) })  ← no [] at end
  const USE_EFFECT_NO_DEPS_RE = /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([^}]{1,500})\}\s*\)/g
  let m: RegExpExecArray | null
  while ((m = USE_EFFECT_NO_DEPS_RE.exec(f.content)) !== null) {
    const body = m[1]
    if (/set[A-Z]\w+\(/.test(body)) {
      const lineNum = f.content.slice(0, m.index).split('\n').length
      issues.push(issue(f.rel, lineNum, m[0].slice(0, 100), {
        guard: 'scalability', severity: 'high', confidence: 'likely',
        title: 'useEffect with setState and no dependency array (infinite re-render)',
        description: `\`useEffect\` with a \`setState\` call but no dependency array (\`[]\`) runs on every render, causing an infinite re-render loop — the browser tab will lock up.`,
        fix: 'Add a dependency array:\n```ts\nuseEffect(() => {\n  // ...\n}, []) // or list actual deps\n```',
      }))
    }
  }

  return issues
}

/**
 * CHECK 3: setInterval / setTimeout without cleanup in useEffect
 */
function checkUncleanedTimers(f: FileResult): VibeIssue[] {
  if (!f.content.includes('useEffect')) return []
  if (!f.content.includes('setInterval') && !f.content.includes('setTimeout')) return []

  const issues: VibeIssue[] = []

  // Look for useEffect blocks containing setInterval/setTimeout but no clearInterval/clearTimeout/return
  // Simple heuristic: scan line-by-line for useEffect start, track until closing })
  let depth = 0
  let inEffect = false
  let effectStart = -1
  let hasTimer = false
  let hasCleanup = false

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]

    if (!inEffect && /useEffect\s*\(/.test(line)) {
      inEffect    = true
      effectStart = i + 1
      depth       = 0
      hasTimer    = false
      hasCleanup  = false
    }

    if (inEffect) {
      depth += (line.match(/\{/g) ?? []).length
      depth -= (line.match(/\}/g) ?? []).length

      if (/setInterval\s*\(|setTimeout\s*\(/.test(line)) hasTimer    = true
      // clearInterval/clearTimeout, return cleanup fn, OR signal/abort-based cleanup (Route Handler pattern)
      if (/clearInterval|clearTimeout|return\s*\(\s*\)\s*=>|request\.signal|signal\.addEventListener|\.abort\s*\(/.test(line)) hasCleanup = true

      // End of useEffect block
      if (depth <= 0 && effectStart > 0) {
        if (hasTimer && !hasCleanup) {
          issues.push(issue(f.rel, effectStart, f.lines[effectStart - 1], {
            guard: 'scalability', severity: 'medium', confidence: 'likely',
            title: 'setInterval/setTimeout in useEffect without cleanup (memory leak)',
            description: `A timer is started in \`useEffect\` in \`${f.rel}\` without a cleanup function. On every unmount/remount the old timer keeps running — causing memory leaks, duplicate callbacks, and stale state updates.`,
            fix: 'Return a cleanup function:\n```ts\nuseEffect(() => {\n  const id = setInterval(() => { /* ... */ }, 1000)\n  return () => clearInterval(id)\n}, [])\n```',
          }))
        }
        inEffect = false
      }
    }
  }

  return issues
}

/**
 * CHECK 4: WebSocket not closed in cleanup
 * Only fire in React component files to avoid false positives in server/utility code.
 */
function checkWebSocketLeak(f: FileResult): VibeIssue[] {
  if (!f.content.includes('new WebSocket')) return []
  // Only fire in React component files (use client or JSX/TSX with React imports)
  if (!f.isClientComponent && !f.content.includes('useEffect') && !/\.(tsx|jsx)$/.test(f.rel)) return []

  const issues: VibeIssue[] = []
  const WS_RE = /new\s+WebSocket\s*\(/g
  let m: RegExpExecArray | null

  while ((m = WS_RE.exec(f.content)) !== null) {
    // Check if there's a ws.close() / socket.close() anywhere in the same file
    if (!f.content.includes('.close()')) {
      const lineNum = f.content.slice(0, m.index).split('\n').length
      issues.push(issue(f.rel, lineNum, f.lines[lineNum - 1] ?? '', {
        guard: 'scalability', severity: 'medium', confidence: 'possible',
        title: 'WebSocket opened but never closed (connection leak)',
        description: `\`new WebSocket()\` in \`${f.rel}\` with no \`.close()\` call. When the component unmounts or the user navigates away, the connection stays open — leaking memory, firing stale message handlers, and exhausting server connection slots.`,
        fix: 'Close the WebSocket in useEffect cleanup:\n```ts\nuseEffect(() => {\n  const ws = new WebSocket(url)\n  ws.onmessage = (e) => { /* ... */ }\n  return () => ws.close()\n}, [url])\n```',
      }))
      break // one per file is enough
    }
  }

  return issues
}

/**
 * CHECK 5: Server Actions imported/called from client component
 * 'use server' functions re-exported and imported in 'use client' files
 */
function checkServerActionInClientComponent(f: FileResult): VibeIssue[] {
  if (!f.isClientComponent) return []

  // Look for imports from files that likely contain server actions
  const SERVER_ACTION_IMPORT_RE = /from\s+['"](\.\.?\/.*(?:action|server|mutation)s?)['"]/i

  for (let i = 0; i < f.lines.length; i++) {
    if (SERVER_ACTION_IMPORT_RE.test(f.lines[i])) {
      // This is fine if it's the official Next.js pattern (importing a 'use server' function)
      // Only flag if the import path strongly suggests it's misused as regular logic
      if (/actions\/index|server-actions|mutation/.test(f.lines[i])) {
        return [issue(f.rel, i + 1, f.lines[i], {
          guard: 'security', severity: 'medium', confidence: 'possible',
          title: 'Server Action import in client component — verify intent',
          description: `\`${f.rel}\` is a \`"use client"\` component importing from what appears to be a server actions file. If that module contains \`"use server"\` functions that accept raw user input without validation, it can be exploited as an open API endpoint.`,
          fix: 'Ensure every Server Action validates + authenticates input server-side. Never trust data from the client body without server-side checks.',
        })]
      }
    }
  }
  return []
}

/**
 * CHECK 6: useState/useEffect/useRouter in Server Component
 * (file has NO 'use client' but uses React hooks)
 */
function checkHooksInServerComponent(f: FileResult): VibeIssue[] {
  if (f.isClientComponent) return []
  // Only applies to Next.js App Router files
  if (!/app\/.*\.(tsx|jsx)$/.test(f.rel)) return []
  // Skip layout.tsx / page.tsx that are legitimately server components
  // (they can't use hooks anyway — this is caught at runtime, but we can catch it here)

  const HOOK_RE = /\b(useState|useEffect|useRouter|usePathname|useSearchParams|useRef|useCallback|useMemo)\s*[(<(]/

  for (let i = 0; i < f.lines.length; i++) {
    if (HOOK_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      return [issue(f.rel, i + 1, f.lines[i], {
        guard: 'scalability', severity: 'high', confidence: 'likely',
        title: 'React hook used in Server Component (will crash at runtime)',
        description: `\`${f.lines[i].trim().slice(0, 60)}\` in \`${f.rel}\` — this file has no \`"use client"\` directive but uses a React hook. Server Components cannot use hooks; this will throw at runtime.`,
        fix: 'Add `"use client"` at the top of the file:\n```ts\n"use client"\nimport { useState } from "react"\n```\nOr extract the hook usage into a separate client component.',
      })]
    }
  }
  return []
}

/**
 * CHECK 7: App Router + Pages Router coexistence
 * Detect mixed routing (app/ AND pages/ with route files)
 * Downgraded to 'low' severity — this is a migration issue, not a production security/money risk.
 */
async function checkMixedRouting(cloneDir: string): Promise<VibeIssue[]> {
  const hasAppRoutes =
    await dirHasRouteFiles(join(cloneDir, 'app'))
  const hasPagesRoutes =
    await dirHasRouteFiles(join(cloneDir, 'pages'))

  if (hasAppRoutes && hasPagesRoutes) {
    return [{
      file: 'package.json', line: 1, snippet: 'Both app/ and pages/ directories with route files detected',
      guard: 'scalability', severity: 'low', confidence: 'confirmed',
      title: 'Mixed App Router + Pages Router (both app/ and pages/ have routes)',
      description: 'Both `app/` (App Router) and `pages/` (Pages Router) contain route files. Mixing routers during a migration is supported by Next.js, but permanent coexistence can cause unpredictable hydration errors and layout mismatches.',
      fix: 'If still migrating, this is expected. Once done: move all `pages/` routes to `app/`, replace `getServerSideProps`/`getStaticProps` with async Server Components, and delete `pages/`.',
    }]
  }
  return []
}

async function dirHasRouteFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir)
    // App Router: page.tsx, route.ts, layout.tsx
    // Pages Router: any .tsx/.js file directly in pages/ (not api/ or _)
    return entries.some(e =>
      /^(page|route|layout)\.(tsx|jsx|ts|js)$/.test(e) ||
      (!/^[_\[]/.test(e) && /\.(tsx|jsx|ts|js)$/.test(e))
    )
  } catch { return false }
}

/**
 * CHECK 8: TypeScript 'any' overuse
 */
function checkTypeScriptAnyOveruse(files: FileResult[]): VibeIssue[] {
  let totalAny = 0
  const examples: string[] = []

  for (const f of files) {
    if (!['.ts', '.tsx'].includes(extname(f.fullPath))) continue
    const matches = f.content.match(/:\s*any\b|as\s+any\b|<any>/g) ?? []
    totalAny += matches.length
    if (examples.length < 3 && matches.length > 0) {
      // Find first occurrence line
      for (let i = 0; i < f.lines.length; i++) {
        if (/:\s*any\b|as\s+any\b/.test(f.lines[i])) {
          examples.push(`${f.rel}:${i + 1}`)
          break
        }
      }
    }
  }

  if (totalAny >= 20) {
    return [{
      file: 'tsconfig.json', line: 1,
      snippet: `${totalAny} uses of \`any\` across the codebase`,
      guard: 'scalability', severity: 'medium', confidence: 'confirmed',
      title: `TypeScript \`any\` overuse (${totalAny} occurrences)`,
      description: `${totalAny} uses of \`any\` type found. Excessive \`any\` defeats TypeScript's type checking — runtime type errors that TypeScript would normally catch will silently pass, causing crashes in production. Examples: ${examples.join(', ')}`,
      fix: 'Replace `any` with specific types. Use `unknown` when the type is truly unknown (forces you to narrow it before use). Enable `noImplicitAny: true` in tsconfig.json to prevent new ones from being added.',
    }]
  }
  return []
}

/**
 * CHECK 9: REMOVED — require() mixed with ESM imports
 * Deprioritized: build tooling noise, not a SaaS production risk.
 * Bundlers (webpack, Vite, Next.js) handle this transparently.
 */

/**
 * CHECK 10: userId / price / amount from request body (IDOR / price manipulation)
 * Enhanced: also detects Paddle, PayPal, LemonSqueezy body patterns
 */
function checkIdorPatterns(f: FileResult): VibeIssue[] {
  if (f.isClientComponent) return []
  // Only in API routes or server actions
  if (!/api\/|action|route\.(ts|js)$/.test(f.rel)) return []

  const issues: VibeIssue[] = []

  // userId from body
  const USER_ID_BODY_RE = /(?:req\.body|body|data|payload)\s*[\.\[]?\s*(?:user_?id|userId|user\.id)\b/i
  for (let i = 0; i < f.lines.length; i++) {
    if (USER_ID_BODY_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      issues.push(issue(f.rel, i + 1, f.lines[i], {
        guard: 'security', severity: 'critical', confidence: 'likely',
        title: 'userId taken from request body (IDOR vulnerability)',
        description: `\`${f.rel}\` reads \`userId\` from the request body. Any authenticated user can set this to any other user's ID and access/modify their data — a classic Insecure Direct Object Reference (IDOR) vulnerability.`,
        fix: 'Always derive userId from the authenticated session, never from the request body:\n```ts\n// next-auth\nconst session = await getServerSession(authOptions)\nconst userId = session?.user?.id\n// Clerk\nconst { userId } = auth()\n// Supabase\nconst { data: { user } } = await supabase.auth.getUser()\n```',
      }))
      break
    }
  }

  // price/amount from body (Stripe, Paddle, PayPal, LemonSqueezy, generic)
  const PRICE_BODY_RE = /(?:req\.body|body|data|payload)\s*[\.\[]?\s*(?:price|amount|total|cost|fee|plan_id|priceId|price_id|variant_id|variantId)\b/i
  for (let i = 0; i < f.lines.length; i++) {
    if (PRICE_BODY_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      issues.push(issue(f.rel, i + 1, f.lines[i], {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'Price/amount taken from client body (payment manipulation)',
        description: `\`${f.rel}\` reads a price, amount, or plan ID directly from the request body. A user can change this to \`0.01\` or a free plan ID in DevTools and pay pennies — or nothing — for any purchase.`,
        fix: 'Always look up the price server-side from your database or provider price catalog:\n```ts\n// Good: price comes from server\nconst price = await db.products.findUnique({ where: { id: productId } })\nawait stripe.checkout.sessions.create({ line_items: [{ price: price.stripeId, quantity: 1 }] })\n// Paddle: use price_id from your Paddle catalog, never from the body\n```',
      }))
      break
    }
  }

  return issues
}

/**
 * CHECK 11: eval() / new Function() usage
 */
function checkEvalUsage(f: FileResult): VibeIssue[] {
  const EVAL_RE = /\beval\s*\(|\bnew\s+Function\s*\(/
  for (let i = 0; i < f.lines.length; i++) {
    if (EVAL_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      return [issue(f.rel, i + 1, f.lines[i], {
        guard: 'security', severity: 'critical', confidence: 'confirmed',
        title: 'eval() or new Function() — code injection risk',
        description: `\`eval()\` or \`new Function()\` in \`${f.rel}\`. If any user-controlled input ever reaches this call, an attacker can execute arbitrary JavaScript — including exfiltrating environment variables, cookies, and session tokens.`,
        fix: 'Replace `eval()` with safer alternatives. For JSON parsing use `JSON.parse()`. For dynamic logic use a lookup table or a safe expression evaluator like `expr-eval`.',
      })]
    }
  }
  return []
}

/**
 * CHECK 12: dangerouslySetInnerHTML without sanitization
 */
function checkDangerousHtml(f: FileResult): VibeIssue[] {
  if (!f.content.includes('dangerouslySetInnerHTML')) return []

  // Flag if there's no sanitize/DOMPurify/sanitizeHtml nearby
  const hasSanitizer = /DOMPurify|sanitizeHtml|sanitize-html|xss\(|escapeHtml/.test(f.content)

  if (!hasSanitizer) {
    const re = /dangerouslySetInnerHTML/g
    let m: RegExpExecArray | null
    while ((m = re.exec(f.content)) !== null) {
      const lineNum = f.content.slice(0, m.index).split('\n').length
      return [issue(f.rel, lineNum, f.lines[lineNum - 1] ?? '', {
        guard: 'security', severity: 'high', confidence: 'likely',
        title: 'dangerouslySetInnerHTML without HTML sanitization (XSS risk)',
        description: `\`dangerouslySetInnerHTML\` in \`${f.rel}\` with no visible sanitization. If any part of the injected HTML comes from user input or an external API, it enables stored XSS — attackers can inject scripts that run in every user's browser.`,
        fix: 'Sanitize HTML before injecting:\n```bash\nnpm install dompurify @types/dompurify\n```\n```tsx\nimport DOMPurify from "dompurify"\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />\n```',
      })]
    }
  }
  return []
}

/**
 * CHECK 13: CORS wildcard with credentials
 */
function checkCorsWildcard(f: FileResult): VibeIssue[] {
  if (!/api\/|route\.(ts|js)$|server\.(ts|js)$|cors/i.test(f.rel)) return []

  const CORS_WILD_RE = /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin.*\*/
  for (let i = 0; i < f.lines.length; i++) {
    if (CORS_WILD_RE.test(f.lines[i])) {
      // Only flag if credentials are also allowed
      const surroundingLines = f.lines.slice(Math.max(0, i - 3), i + 4).join('\n')
      if (/credentials.*true|Access-Control-Allow-Credentials.*true/.test(surroundingLines)) {
        return [issue(f.rel, i + 1, f.lines[i], {
          guard: 'security', severity: 'critical', confidence: 'confirmed',
          title: 'CORS wildcard origin with credentials: true (auth bypass)',
          description: '`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` is rejected by all browsers AND is a misconfiguration that, on non-browser clients, allows any origin to make credentialed requests — bypassing CSRF protections.',
          fix: 'Specify exact allowed origins:\n```ts\nconst allowedOrigins = [process.env.NEXT_PUBLIC_APP_URL]\nconst origin = req.headers.get("origin")\nif (allowedOrigins.includes(origin)) {\n  headers.set("Access-Control-Allow-Origin", origin)\n  headers.set("Access-Control-Allow-Credentials", "true")\n}\n```',
        })]
      }
    }
  }
  return []
}

/**
 * CHECK 14: Exposed internal/debug endpoints
 */
function checkExposedDebugEndpoints(f: FileResult): VibeIssue[] {
  if (!/api\//.test(f.rel)) return []

  const DEBUG_ROUTE_RE = /\/api\/(debug|admin|internal|health|metrics|status|test)\b/i
  for (let i = 0; i < f.lines.length; i++) {
    if (DEBUG_ROUTE_RE.test(f.lines[i])) {
      // Only flag if there's no auth check nearby
      const surroundingContent = f.lines.slice(Math.max(0, i - 5), i + 15).join('\n')
      const hasAuthCheck = /getServerSession|auth\(\)|currentUser|verifyToken|Authorization|apiKey/i.test(surroundingContent)
      if (!hasAuthCheck) {
        return [issue(f.rel, i + 1, f.lines[i], {
          guard: 'security', severity: 'high', confidence: 'possible',
          title: 'Internal/debug endpoint without authentication',
          description: `A route matching \`/api/debug\`, \`/api/admin\`, or \`/api/internal\` in \`${f.rel}\` with no visible auth check. These endpoints often expose system info, reset user data, or trigger admin actions — accessible to anyone who guesses the URL.`,
          fix: 'Add authentication to all internal routes:\n```ts\nconst session = await getServerSession(authOptions)\nif (!session?.user?.isAdmin) {\n  return new Response("Forbidden", { status: 403 })\n}\n```',
        })]
      }
    }
  }
  return []
}

/**
 * CHECK 15: Float math for money
 */
function checkFloatMoney(f: FileResult): VibeIssue[] {
  // Skip non-payment files
  if (!/payment|checkout|stripe|billing|invoice|order|price|amount/i.test(f.rel + f.content.slice(0, 500))) return []

  const FLOAT_MATH_RE = /(?:price|amount|total|cost|fee|subtotal)\s*[+\-*\/]\s*(?:\d+\.\d+|\w+)/
  for (let i = 0; i < f.lines.length; i++) {
    if (FLOAT_MATH_RE.test(f.lines[i]) && !/parseInt|Math\.round|toFixed|Decimal|dinero/i.test(f.lines[i])) {
      return [issue(f.rel, i + 1, f.lines[i], {
        guard: 'monetization', severity: 'high', confidence: 'possible',
        title: 'Floating point arithmetic for monetary values',
        description: `\`${f.rel}\` performs arithmetic on price/amount using floating point. JavaScript floats are imprecise: \`0.1 + 0.2 === 0.30000000000000004\`. Over many transactions this causes billing discrepancies — users over/under-charged by fractions of a cent that accumulate.`,
        fix: 'Use integer arithmetic (cents) or a decimal library:\n```ts\n// Option 1: work in cents\nconst totalCents = Math.round(priceInDollars * 100)\n// Option 2: use Dinero.js\nimport { dinero, add } from "dinero.js"\n```',
      })]
    }
  }
  return []
}

/**
 * CHECK 16: Missing webhook signature verification (Stripe, Paddle, LemonSqueezy, PayPal)
 */
function checkStripeWebhookVerification(f: FileResult): VibeIssue[] {
  if (!/webhook/i.test(f.rel)) return []

  // ── Stripe ───────────────────────────────────────────────────────────────────
  if (f.content.includes('stripe') || f.content.toLowerCase().includes('stripe')) {
    const hasVerification = /stripe\.webhooks\.constructEvent|constructEventAsync|Stripe\.webhooks/i.test(f.content)
    if (!hasVerification) {
      return [issue(f.rel, 1, f.lines[0] ?? '', {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'Stripe webhook without signature verification',
        description: `\`${f.rel}\` appears to be a Stripe webhook handler but does not call \`stripe.webhooks.constructEvent()\`. Without signature verification, anyone can POST fake webhook events — triggering order fulfillment, subscription upgrades, or account changes without payment.`,
        fix: '```ts\nconst sig = req.headers.get("stripe-signature")!\nconst event = stripe.webhooks.constructEvent(\n  await req.text(),  // raw body — NOT parsed JSON\n  sig,\n  process.env.STRIPE_WEBHOOK_SECRET!\n)\n```',
      })]
    }
  }

  // ── Paddle ───────────────────────────────────────────────────────────────────
  if (/paddle/i.test(f.content)) {
    const hasPaddleVerify = /paddle\.webhooks\.unmarshal|verifyWebhookSignature|paddle-signature/i.test(f.content)
    if (!hasPaddleVerify) {
      return [issue(f.rel, 1, f.lines[0] ?? '', {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'Paddle webhook without signature verification',
        description: `\`${f.rel}\` appears to be a Paddle webhook handler with no signature verification. Call \`paddle.webhooks.unmarshal()\` or check the \`paddle-signature\` header before processing any event.`,
        fix: '```ts\nconst event = await paddle.webhooks.unmarshal(\n  await req.text(),\n  process.env.PADDLE_WEBHOOK_SECRET!,\n  req.headers.get("paddle-signature")!\n)\n```',
      })]
    }
  }

  // ── LemonSqueezy ─────────────────────────────────────────────────────────────
  if (/lemonsqueezy|lemon.squeezy/i.test(f.content)) {
    const hasLSVerify = /createHmac|x-signature|X-Signature|webhookSigningSecret/i.test(f.content)
    if (!hasLSVerify) {
      return [issue(f.rel, 1, f.lines[0] ?? '', {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'LemonSqueezy webhook without signature verification',
        description: `\`${f.rel}\` handles LemonSqueezy webhooks with no HMAC-SHA256 signature check on the \`X-Signature\` header. Fake events can provision paid features for free.`,
        fix: '```ts\nimport { createHmac, timingSafeEqual } from "crypto"\nconst sig = req.headers.get("x-signature") ?? ""\nconst digest = createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET!)\n  .update(await req.text()).digest("hex")\nif (!timingSafeEqual(Buffer.from(sig), Buffer.from(digest))) {\n  return new Response("Invalid signature", { status: 401 })\n}\n```',
      })]
    }
  }

  // ── PayPal ────────────────────────────────────────────────────────────────────
  if (/paypal/i.test(f.content)) {
    const hasPayPalVerify = /PAYPAL-TRANSMISSION-SIG|verifyWebhookSignature|paypal.*webhook.*verif/i.test(f.content)
    if (!hasPayPalVerify) {
      return [issue(f.rel, 1, f.lines[0] ?? '', {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'PayPal webhook without signature verification',
        description: `\`${f.rel}\` handles PayPal webhooks with no verification of the \`PAYPAL-TRANSMISSION-SIG\` header. Fake payment events can trigger order fulfillment without actual payment.`,
        fix: 'Use PayPal\'s `/v1/notifications/verify-webhook-signature` API or the PayPal SDK to verify the \`PAYPAL-TRANSMISSION-SIG\` header before processing any event.',
      })]
    }
  }

  return []
}

/**
 * CHECK 17: N+1 query pattern (DB call inside loop)
 */
function checkNPlusOneQuery(f: FileResult): VibeIssue[] {
  if (!/(prisma|drizzle|supabase|db\.|mongoose|query)/i.test(f.content)) return []

  const issues: VibeIssue[] = []
  let inLoop = false
  let loopStart = -1
  let depth = 0

  // Exclude `reduce` and `filter` — these are in-memory transforms, not DB loop drivers.
  // Also exclude `find` / `findIndex` which are in-memory searches.
  const LOOP_START_RE = /\b(for|forEach|map|while)\s*[\(\{]/
  const DB_CALL_RE    = /\.(findFirst|findMany|findUnique|select|from|query|execute|find|count|aggregate)\s*[(\{(]/i

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]

    if (!inLoop && LOOP_START_RE.test(line)) {
      inLoop    = true
      loopStart = i + 1
      depth     = 0
    }

    if (inLoop) {
      depth += (line.match(/\{/g) ?? []).length
      depth -= (line.match(/\}/g) ?? []).length

      if (DB_CALL_RE.test(line) && !/\/\//.test(line.trimStart())) {
        issues.push(issue(f.rel, i + 1, line, {
          guard: 'scalability', severity: 'high', confidence: 'likely',
          title: 'N+1 query: database call inside loop',
          description: `A database call was found inside a loop in \`${f.rel}\` (loop starting at line ${loopStart}). For 100 items this fires 100 separate DB queries — causing exponential latency and often exhausting the connection pool.`,
          fix: 'Fetch all data before the loop using a batch query:\n```ts\n// Instead of:\nfor (const id of ids) {\n  const user = await db.users.findUnique({ where: { id } })\n}\n// Do:\nconst users = await db.users.findMany({ where: { id: { in: ids } } })\nconst userMap = Object.fromEntries(users.map(u => [u.id, u]))\n```',
        }))
        break // one per loop
      }

      if (depth <= 0) inLoop = false
    }
  }

  return issues
}

/**
 * CHECK 18: Missing error.tsx in App Router route segments
 * Each app/ directory with a page.tsx should have an error.tsx sibling.
 * Without it, runtime errors show Next.js's generic crash page to users.
 */
async function checkMissingErrorBoundaries(cloneDir: string): Promise<VibeIssue[]> {
  const issues: VibeIssue[] = []

  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    const names = new Set(entries)
    const hasPage   = names.has('page.tsx') || names.has('page.jsx') || names.has('page.ts') || names.has('page.js')
    const hasError  = names.has('error.tsx') || names.has('error.jsx') || names.has('error.ts') || names.has('error.js')

    if (hasPage && !hasError) {
      const rel = relative(cloneDir, dir)
      issues.push({
        file: `${rel}/page.tsx`,
        line: 1,
        snippet: `Route segment ${rel} has page.tsx but no error.tsx`,
        guard: 'scalability',
        severity: 'medium',
        confidence: 'confirmed',
        title: `Missing error.tsx in route segment \`${rel}\``,
        description: `The route segment \`${rel}\` has a \`page.tsx\` but no \`error.tsx\` error boundary. If an async Server Component throws, Next.js shows a blank crash page with a raw error message — exposing internals to users and killing conversions.`,
        fix: `Create \`${rel}/error.tsx\`:\n\`\`\`tsx\n"use client"\nexport default function Error({ error, reset }: { error: Error; reset: () => void }) {\n  return (\n    <div>\n      <h2>Something went wrong</h2>\n      <button onClick={reset}>Try again</button>\n    </div>\n  )\n}\n\`\`\``,
      })
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let s: { isDirectory(): boolean }
      try { s = await stat(full) } catch { continue }
      if (s.isDirectory()) await walk(full)
    }
  }

  const appDir = join(cloneDir, 'app')
  try { await stat(appDir) } catch { return [] }
  await walk(appDir)

  // Cap at 5 to avoid flooding the report for large apps
  return issues.slice(0, 5)
}

/**
 * CHECK 19: Server Actions without input validation
 * Exported async functions in 'use server' files that take parameters
 * but have no Zod/yup/joi validation call in the function body.
 */
function checkServerActionNoValidation(f: FileResult): VibeIssue[] {
  if (!f.isServerAction) return []

  const issues: VibeIssue[] = []

  // Match: export async function foo(someParam...) { ... }
  // or: export const foo = async (someParam...) => { ... }
  const FN_RE = /export\s+(?:async\s+function\s+(\w+)\s*\(([^)]{1,200})\)|const\s+(\w+)\s*=\s*async\s*\(([^)]{1,200})\)\s*=>)/g
  let m: RegExpExecArray | null

  while ((m = FN_RE.exec(f.content)) !== null) {
    const fnName   = m[1] || m[3]
    const params   = (m[2] || m[4] || '').trim()

    // Skip functions with no params (or only FormData — that's fine, Next handles it)
    if (!params || params === 'formData: FormData' || params === 'formData') continue

    // Find the function body — scan from match position
    const bodyStart = f.content.indexOf('{', m.index + m[0].length - 1)
    if (bodyStart === -1) continue
    // Extract ~600 chars of body (enough to see validation calls)
    const bodySlice = f.content.slice(bodyStart, bodyStart + 600)

    const hasValidation = /\.parse\s*\(|\.safeParse\s*\(|\.validate\s*\(|joi\.|yup\.|zod\.|schema\./i.test(bodySlice)
    if (!hasValidation) {
      const lineNum = f.content.slice(0, m.index).split('\n').length
      issues.push(issue(f.rel, lineNum, m[0].slice(0, 120), {
        guard: 'security',
        severity: 'high',
        confidence: 'likely',
        title: `Server Action \`${fnName}\` accepts params without input validation`,
        description: `\`${f.rel}\` → \`${fnName}(${params.slice(0, 60)})\` is a Server Action that accepts parameters but has no visible Zod/yup/joi validation. Server Actions are public POST endpoints — any user can send arbitrary payloads.`,
        fix: `Validate all inputs with Zod before using them:\n\`\`\`ts\nimport { z } from "zod"\nconst schema = z.object({ /* ... */ })\nexport async function ${fnName}(data: unknown) {\n  const parsed = schema.safeParse(data)\n  if (!parsed.success) throw new Error("Invalid input")\n  // use parsed.data\n}\n\`\`\``,
      }))
      if (issues.length >= 3) break // max 3 per file
    }
  }

  return issues
}

/**
 * CHECK 20: Unbounded DB queries — findMany / select() with no limit/take/where
 * Enhanced: also detects SaaS table queries without tenant_id/org_id filter
 */
function checkUnboundedQueries(f: FileResult): VibeIssue[] {
  if (f.isClientComponent) return []
  if (!/prisma|drizzle|supabase|mongoose|db\./i.test(f.content)) return []

  const issues: VibeIssue[] = []

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]

    // Prisma: .findMany({ }) with no take/where/skip, or .findMany() with nothing
    // Drizzle: db.select().from(table) with no .limit()
    // Supabase: .from('table').select('*') with no .limit() or .range()
    if (/\.(findMany|findAll)\s*\(\s*\{?\s*\}?\s*\)/.test(line)) {
      // Check surrounding lines (before + after) for pagination signals
      const context = f.lines.slice(Math.max(0, i - 3), i + 8).join(' ')
      if (!/\btake\b|\blimit\b|\bwhere\b|\brange\b|\bskip\b|\bLIMIT\b/i.test(context)) {
        issues.push(issue(f.rel, i + 1, line, {
          guard: 'scalability',
          severity: 'high',
          confidence: 'likely',
          title: 'Unbounded DB query — no limit or where clause',
          description: `\`${f.rel}\` calls \`.findMany()\` or \`.findAll()\` with no \`take\`/\`limit\`/\`where\` — this fetches every row in the table. With 100k+ rows this will OOM the server and time out.`,
          fix: 'Always paginate:\n```ts\nconst items = await db.items.findMany({\n  take: 50,\n  skip: (page - 1) * 50,\n  orderBy: { createdAt: "desc" },\n})\n```',
        }))
        if (issues.length >= 3) break
      }
    }

    // Supabase: .select() without .limit()
    if (/\.select\s*\(\s*['"`\*]/.test(line)) {
      const context = f.lines.slice(i, i + 8).join(' ')
      // Also treat raw SQL LIMIT keyword (e.g. LIMIT ? OFFSET ?) as paginated
      if (!/\.limit\s*\(|\.range\s*\(|\bLIMIT\b/i.test(context) && /supabase|from\s*\(/.test(context)) {
        issues.push(issue(f.rel, i + 1, line, {
          guard: 'scalability',
          severity: 'high',
          confidence: 'possible',
          title: 'Unbounded Supabase query — no .limit() call',
          description: `\`${f.rel}\` queries Supabase with \`.select()\` but no \`.limit()\`. Without a limit, this returns every matching row — unbounded reads that can exhaust memory and hit Supabase's row limits.`,
          fix: 'Add `.limit()` to every query:\n```ts\nconst { data } = await supabase.from("items").select("*").limit(50)\n```',
        }))
        if (issues.length >= 3) break
      }
    }
  }

  return issues
}

/**
 * CHECK 21: Auth endpoints + payment webhook endpoints without rate limiting
 * Enhanced: also covers webhook endpoints (webhook bombing risk)
 */
function checkAuthEndpointNoRateLimit(f: FileResult): VibeIssue[] {
  if (!/api\//i.test(f.rel)) return []

  const AUTH_ROUTE_RE = /\/(login|signin|sign-in|register|signup|sign-up|forgot-?password|reset-?password|verify|otp|2fa)\b/i
  const WEBHOOK_ROUTE_RE = /\/webhook/i

  const isAuthRoute    = AUTH_ROUTE_RE.test(f.rel) || AUTH_ROUTE_RE.test(f.content.slice(0, 300))
  const isWebhookRoute = WEBHOOK_ROUTE_RE.test(f.rel)

  if (!isAuthRoute && !isWebhookRoute) return []

  const hasRateLimit = /ratelimit|rate.?limit|upstash|express-rate-limit|bottleneck|limiter/i.test(f.content)
  if (!hasRateLimit) {
    if (isWebhookRoute) {
      return [issue(f.rel, 1, f.lines[0] ?? '', {
        guard: 'security',
        severity: 'medium',
        confidence: 'likely',
        title: 'Webhook endpoint without rate limiting (webhook bombing risk)',
        description: `\`${f.rel}\` is a webhook endpoint with no rate limiting. Without it, attackers can flood your webhook with thousands of fake events per second — exhausting your serverless invocation quota and potentially causing event processing queue backup.`,
        fix: 'Add IP-based rate limiting to your webhook endpoint to prevent flooding:\n```ts\nconst ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, "1 m") })\nconst { success } = await ratelimit.limit(ip)\nif (!success) return new Response("Too many requests", { status: 429 })\n```',
      })]
    }
    return [issue(f.rel, 1, f.lines[0] ?? '', {
      guard: 'security',
      severity: 'high',
      confidence: 'likely',
      title: 'Auth endpoint without rate limiting (brute-force risk)',
      description: `\`${f.rel}\` is an authentication endpoint with no rate limiting. Without it, attackers can try millions of password combinations, enumerate valid accounts, or flood OTP/magic-link endpoints at zero cost.`,
      fix: 'Add rate limiting with Upstash:\n```bash\nnpm install @upstash/ratelimit @upstash/redis\n```\n```ts\nimport { Ratelimit } from "@upstash/ratelimit"\nconst ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "1 m") })\nconst { success } = await ratelimit.limit(ip)\nif (!success) return new Response("Too many requests", { status: 429 })\n```',
    })]
  }
  return []
}

/**
 * CHECK 22: console.log(process.env.*) or import.meta.env.VITE_* in client components (env var leak)
 */
function checkEnvVarConsoleLog(f: FileResult): VibeIssue[] {
  const issues: VibeIssue[] = []

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]
    if (f.lines[i].trim().startsWith('//')) continue

    // console.log(...process.env...) in any file
    if (/console\.(log|warn|error|info|debug)\s*\(.*process\.env\./i.test(line)) {
      issues.push(issue(f.rel, i + 1, line, {
        guard: 'security',
        severity: f.isClientComponent ? 'high' : 'medium',
        confidence: 'confirmed',
        title: 'console.log() of process.env variable',
        description: f.isClientComponent
          ? `\`${f.rel}\` logs \`process.env.*\` in a client component — the value is bundled into the JS payload and printed to every user's browser console, exposing configuration and potentially secrets.`
          : `\`${f.rel}\` logs \`process.env.*\` — server logs often ship to external services (Datadog, Sentry, Logtail). Secret values in logs create an audit trail of credential exposure.`,
        fix: 'Remove the console.log. If you need to verify a value locally, use a debugger breakpoint or check the value server-side in a one-off script.',
      }))
      if (issues.length >= 2) break
    }

    // import.meta.env.VITE_*SECRET/KEY/TOKEN/DATABASE exposed in client bundle
    if (
      (f.isClientComponent || f.rel.endsWith('.tsx') || f.rel.endsWith('.jsx')) &&
      /import\.meta\.env\.VITE_(?:\w*SECRET\w*|\w*KEY\w*|\w*TOKEN\w*|\w*DATABASE\w*|\w*PASSWORD\w*)/i.test(line)
    ) {
      issues.push(issue(f.rel, i + 1, line, {
        guard: 'security',
        severity: 'high',
        confidence: 'confirmed',
        title: 'Secret env var exposed via import.meta.env.VITE_ in client bundle',
        description: `\`${f.rel}\` references a Vite env variable that looks like a secret (\`VITE_SECRET\`, \`VITE_KEY\`, \`VITE_TOKEN\`, \`VITE_DATABASE\`). All \`VITE_*\` variables are **inlined at build time** into the browser JS bundle — anyone can read them with View Source. Non-public secrets must stay in server-only files (API routes, server actions) and use plain \`process.env.*\` or non-VITE_ prefix.`,
        fix: 'Move the secret to a server-only file. If it is a public key (e.g. Supabase anon key), rename it to make its public nature clear and document it as intentionally public.',
      }))
      if (issues.length >= 2) break
    }
  }

  return issues
}

/**
 * CHECK 23: Race condition in Server Actions — multiple sequential awaited DB writes
 * with no transaction wrapper (db.$transaction / withTransaction / BEGIN)
 */
function checkRaceConditionInServerAction(f: FileResult): VibeIssue[] {
  if (!f.isServerAction) return []

  const issues: VibeIssue[] = []

  // Look for functions that have 2+ sequential await db writes (create/update/delete/upsert)
  // without a transaction wrapper
  const WRITE_RE = /await\s+\S*(?:db|prisma|supabase)\S*\.(create|update|delete|upsert|insert|patch)\s*[\(\{]/gi
  const TRANSACTION_RE = /\$transaction|withTransaction|\.transaction\(|db\.begin|START TRANSACTION|BEGIN/i

  // Per-function analysis: find exported async functions
  const FN_RE = /export\s+(?:async\s+function\s+\w+|const\s+\w+\s*=\s*async\s*(?:\([^)]*\)|\w+)\s*=>)\s*\{/g
  let fnMatch: RegExpExecArray | null

  while ((fnMatch = FN_RE.exec(f.content)) !== null) {
    // Find the function body by tracking braces
    let depth = 0
    let bodyStart = -1
    let bodyEnd = -1

    for (let i = fnMatch.index; i < f.content.length; i++) {
      if (f.content[i] === '{') {
        if (depth === 0) bodyStart = i
        depth++
      } else if (f.content[i] === '}') {
        depth--
        if (depth === 0) { bodyEnd = i; break }
      }
    }

    if (bodyStart === -1 || bodyEnd === -1) continue
    const body = f.content.slice(bodyStart, bodyEnd)

    const writeMatches = body.match(WRITE_RE) ?? []
    if (writeMatches.length >= 2 && !TRANSACTION_RE.test(body)) {
      const lineNum = f.content.slice(0, fnMatch.index).split('\n').length
      issues.push(issue(f.rel, lineNum, fnMatch[0].slice(0, 120), {
        guard: 'scalability',
        severity: 'medium',
        confidence: 'possible',
        title: 'Multiple DB writes in Server Action without transaction (race condition)',
        description: `\`${f.rel}\` has ${writeMatches.length} sequential DB write operations in a Server Action without a transaction. If any write fails mid-way, the database is left in a partial/inconsistent state. Concurrent requests can also interleave, corrupting balances or counts.`,
        fix: 'Wrap multiple writes in a transaction:\n```ts\nawait prisma.$transaction(async (tx) => {\n  await tx.order.create({ ... })\n  await tx.inventory.update({ ... })\n})\n```',
      }))
      if (issues.length >= 2) break
    }
  }

  return issues
}

/**
 * CHECK 24: Multi-tenancy isolation — queries on SaaS shared tables without tenant filter
 * Detects DB queries on tables named users/subscriptions/organizations/workspaces/teams
 * that have no WHERE tenant_id/org_id/workspace_id/team_id clause nearby.
 */
function checkMultiTenancyIsolation(f: FileResult): VibeIssue[] {
  // Only check server-side files (API routes, server actions, server components)
  if (f.isClientComponent) return []
  const issues: VibeIssue[] = []

  // Tables that should almost always be scoped to a tenant
  const TENANT_TABLE_RE = /\.(from|table)\s*\(\s*['"`](?:users|subscriptions|organizations|workspaces|teams|accounts|members|memberships)['"`]/i
  // Filters that correctly scope to a tenant
  const TENANT_FILTER_RE = /tenant_id|org_id|workspace_id|team_id|account_id|organization_id/i

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]
    if (line.trim().startsWith('//')) continue
    if (!TENANT_TABLE_RE.test(line)) continue

    // Check surrounding 8 lines (the WHERE clause is usually chained on next lines)
    const contextStart = Math.max(0, i - 2)
    const contextEnd   = Math.min(f.lines.length - 1, i + 8)
    const context      = f.lines.slice(contextStart, contextEnd + 1).join('\n')

    if (!TENANT_FILTER_RE.test(context)) {
      issues.push(issue(f.rel, i + 1, line, {
        guard: 'security',
        severity: 'high',
        confidence: 'possible',
        title: 'Multi-tenant query without tenant isolation filter',
        description: `\`${f.rel}\` queries a shared SaaS table without a \`tenant_id\`/\`org_id\`/\`workspace_id\` filter. In a multi-tenant app, every query on shared tables **must** include the tenant scope — otherwise Tenant A can read Tenant B's data (cross-tenant data leak).`,
        fix: 'Always filter by the current tenant\'s ID:\n```ts\n// Bad:\nconst subs = await db.from("subscriptions").select("*")\n// Good:\nconst subs = await db.from("subscriptions").select("*").eq("org_id", session.orgId)\n```\nConsider using Postgres Row Level Security (RLS) to enforce this at the database layer.',
      }))
      if (issues.length >= 2) break
    }
  }

  return issues
}

/**
 * CHECK 25: JWT / auth token stored in localStorage
 * localStorage is readable by any JS on the page — XSS-stealable.
 */
function checkJwtInLocalStorage(f: FileResult): VibeIssue[] {
  const issues: VibeIssue[] = []

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]
    if (line.trim().startsWith('//')) continue

    if (/localStorage\.setItem\s*\(\s*['"`](?:token|jwt|accessToken|access_token|id_token|auth_token|refresh_token|authToken)['"`]/i.test(line)) {
      issues.push(issue(f.rel, i + 1, line, {
        guard: 'security',
        severity: 'high',
        confidence: 'confirmed',
        title: 'Auth token stored in localStorage (XSS-stealable)',
        description: `\`${f.rel}\` stores an auth token in \`localStorage\`. Any JavaScript running on the page (including injected via XSS) can read \`localStorage\` and steal the token, completely impersonating the user — no user interaction needed. This is especially dangerous for SaaS apps.`,
        fix: 'Store tokens in \`httpOnly\` cookies (inaccessible to JavaScript):\n```ts\n// Server-side (Next.js API route / Server Action):\ncookies().set("token", value, { httpOnly: true, secure: true, sameSite: "lax" })\n```\nOr use an auth library that handles this for you (NextAuth, Clerk, Supabase Auth with cookie sessions).',
      }))
      if (issues.length >= 2) break
    }
  }

  return issues
}

/**
 * CHECK 26: Payment webhook handler without idempotency key check
 * Stripe/Paddle/LemonSqueezy can retry webhooks — without idempotency checks
 * the same event may trigger duplicate charges, fulfillments or credits.
 */
function checkWebhookIdempotency(f: FileResult): VibeIssue[] {
  // Only look at webhook endpoint files
  const isWebhookFile = /webhook|stripe|paddle|lemon/i.test(f.rel)
  if (!isWebhookFile) return []

  const issues: VibeIssue[] = []

  // Check for payment event handling (fulfillment-type events)
  const PAYMENT_EVENT_RE = /checkout\.completed|payment_intent\.succeeded|payment\.succeeded|order\.completed|subscription\.created|invoice\.paid/i
  if (!PAYMENT_EVENT_RE.test(f.content)) return []

  // Check if idempotency is handled
  const IDEMPOTENCY_RE = /idempotency|stripe-event-id|event\.id|eventId|processedEvents|stripe_event_id|processed_at|alreadyProcessed/i
  if (!IDEMPOTENCY_RE.test(f.content)) {
    issues.push(issue(f.rel, 1, f.lines[0] ?? '', {
      guard: 'monetization',
      severity: 'high',
      confidence: 'likely',
      title: 'Payment webhook handler missing idempotency check (duplicate charge risk)',
      description: `\`${f.rel}\` handles payment fulfillment events (checkout completed / payment succeeded) but has no idempotency check. Payment processors **retry webhooks** on network errors — without deduplication, the same event can trigger duplicate order fulfillment, duplicate credits, or duplicate subscription activations.`,
      fix: 'Store and check processed event IDs before handling:\n```ts\nconst eventId = event.id  // Stripe event ID is globally unique\nconst already = await db.from("processed_events").select("id").eq("event_id", eventId).single()\nif (already.data) return new Response("OK", { status: 200 }) // already processed\n\nawait db.from("processed_events").insert({ event_id: eventId, processed_at: new Date() })\n// ... now safely handle the event\n```',
    }))
  }

  return issues
}

/**
 * CHECK 28: Plan/feature gating only on the client side (bypassable)
 * Detects plan checks (plan === 'pro', isPro, subscription.status) inside
 * 'use client' files with no corresponding server-side guard visible.
 */
function checkClientOnlyPlanGating(f: FileResult): VibeIssue[] {
  if (!f.isClientComponent) return []

  const issues: VibeIssue[] = []

  // Detect plan gating patterns
  const PLAN_CHECK_RE = /\bplan\s*===?\s*['"`](?:pro|premium|enterprise|business|paid)['"`]|isPro\b|isPremium\b|isEnterprise\b|subscription\.status\s*===?\s*['"`]active['"`]|tier\s*===?\s*['"`]/i

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]
    if (line.trim().startsWith('//')) continue
    if (!PLAN_CHECK_RE.test(line)) continue

    // Check if there's a server-side fetch that validates the plan (acceptable pattern)
    const hasServerFetch = /useServerAction|fetch\s*\(.*\/api\/|server action/i.test(f.content)

    // Flag if the plan check is used directly to hide/show UI or unlock features
    // and there's no visible server validation
    const isUiGate = /return\s+null|return\s+<|<Upgrade|<Lock|disabled=\{!is|className.*hidden|style.*display.*none/i.test(
      f.lines.slice(Math.max(0, i - 1), Math.min(f.lines.length, i + 4)).join('\n')
    )

    if (isUiGate && !hasServerFetch) {
      issues.push(issue(f.rel, i + 1, line, {
        guard: 'security',
        severity: 'high',
        confidence: 'possible',
        title: 'Plan/feature gate is client-side only (bypassable)',
        description: `\`${f.rel}\` hides features or UI based on a plan check in a client component. Client-side gating is **trivially bypassable** — anyone can open DevTools and set \`plan = "pro"\` or delete the check. Real plan enforcement must happen on the **server** (API route, Server Action, middleware) where the user cannot tamper with the check.`,
        fix: 'Enforce plan limits on the server:\n```ts\n// In your API route or Server Action:\nconst user = await getUser(session)\nif (user.plan !== "pro") return new Response("Upgrade required", { status: 403 })\n// Client UI can still show/hide for UX, but the real gate is here\n```',
      }))
      if (issues.length >= 1) break // one per file is enough
    }
  }

  return issues
}

/**
 * CHECK 29: Missing data deletion endpoint (cross-file check)
 * SaaS apps that have auth routes but no /delete-account or /cancel route
 * violate GDPR "right to erasure" and are a liability.
 */
async function checkMissingDataDeletion(cloneDir: string): Promise<VibeIssue[]> {
  // Check if the project has auth (sign-in/sign-up routes)
  const { readdir: rd, stat: st } = await import('fs/promises')
  const { join: j, relative: rel } = await import('path')

  let hasAuth = false
  let hasDeleteOrCancel = false

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 4) return
    let entries: string[]
    try { entries = await rd(dir) } catch { return }

    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue
      const full = j(dir, entry)
      let s: { isDirectory(): boolean }
      try { s = await st(full) } catch { continue }

      if (s.isDirectory()) {
        const lower = entry.toLowerCase()
        if (lower.includes('sign-in') || lower.includes('signin') || lower.includes('login') || lower.includes('auth')) {
          hasAuth = true
        }
        if (lower.includes('delete-account') || lower.includes('deleteaccount') || lower.includes('cancel') || lower.includes('deactivate')) {
          hasDeleteOrCancel = true
        }
        await walk(full, depth + 1)
      } else {
        // Also check file names (API routes like /api/delete-account/route.ts)
        const lower = entry.toLowerCase()
        if (lower.includes('delete-account') || lower.includes('cancel-subscription') || lower.includes('delete_account')) {
          hasDeleteOrCancel = true
        }
      }
    }
  }

  // Walk app/ and pages/api/
  try { await walk(j(cloneDir, 'app')) } catch { /* ok */ }
  try { await walk(j(cloneDir, 'pages')) } catch { /* ok */ }
  try { await walk(j(cloneDir, 'src', 'app')) } catch { /* ok */ }

  if (hasAuth && !hasDeleteOrCancel) {
    return [{
      file: 'app/',
      line: 1,
      snippet: 'No delete-account or cancel-subscription route found',
      guard: 'security',
      severity: 'medium',
      confidence: 'possible',
      title: 'No account deletion / subscription cancellation endpoint (GDPR risk)',
      description: 'This app has authentication but no visible account deletion or subscription cancellation endpoint. Under GDPR Article 17 ("right to erasure"), users in the EU/UK have a legal right to request deletion of their data. Missing this is a compliance liability and also frustrates users who want to cancel.',
      fix: 'Create an account deletion endpoint:\n```ts\n// app/api/delete-account/route.ts\nexport async function DELETE(req: Request) {\n  const session = await getServerSession()\n  if (!session) return new Response("Unauthorized", { status: 401 })\n\n  // Delete user data in the correct order (respect FK constraints)\n  await db.from("subscriptions").delete().eq("user_id", session.user.id)\n  await db.from("profiles").delete().eq("id", session.user.id)\n  await supabaseAdmin.auth.admin.deleteUser(session.user.id)\n\n  return new Response(null, { status: 204 })\n}\n```\nAlso cancel any active Stripe/Paddle subscriptions before deleting the user.',
    }]
  }

  return []
}

/**
 * CHECK 30: Hardcoded live API keys in source code (not in .env files)
 * Detects sk_live_, pk_live_, rk_live_, whsec_ patterns in JS/TS source files.
 */
function checkHardcodedLiveApiKey(f: FileResult): VibeIssue[] {
  // Skip .env files — these are expected to have keys
  if (f.rel.includes('.env') || f.rel.endsWith('.example')) return []

  const issues: VibeIssue[] = []

  // Match live Stripe keys and webhook secrets
  const LIVE_KEY_RE = /(sk_live_[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]{20,}|rk_live_[a-zA-Z0-9]{20,}|whsec_[a-zA-Z0-9]{20,})/

  for (let i = 0; i < f.lines.length; i++) {
    const line = f.lines[i]
    if (line.trim().startsWith('//')) continue
    // Skip if the value is loaded from env (false positive)
    if (/process\.env\.|import\.meta\.env\./.test(line)) continue

    const match = LIVE_KEY_RE.exec(line)
    if (match) {
      const keyPrefix = match[1].slice(0, 12) + '...' // Don't log the full key
      issues.push(issue(f.rel, i + 1, line.replace(match[1], keyPrefix), {
        guard: 'security',
        severity: 'critical' as any,
        confidence: 'confirmed',
        title: `Live API key hardcoded in source (${match[1].slice(0, 7)}...)`,
        description: `\`${f.rel}\` contains what appears to be a hardcoded live Stripe key or webhook secret (\`${keyPrefix}\`). This key is fully functional and grants complete access to your payment account. If this file is in a public repo, the key is already compromised.`,
        fix: '1. **Rotate the key immediately** in your Stripe dashboard\n2. Move it to your \`.env.local\` / environment variables:\n```ts\n// Instead of:\nconst stripe = new Stripe("sk_live_...")\n// Use:\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)\n```\n3. Add \`.env.local\` to \`.gitignore\` if not already there.',
      }))
      if (issues.length >= 2) break
    }
  }

  return issues
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function runVibeLeakDetector(cloneDir: string): Promise<VibeIssue[]> {
  const filePaths = await walkSourceFiles(cloneDir)
  const fileResults: FileResult[] = []

  // Load all files
  for (const fp of filePaths) {
    const result = await loadFile(fp, cloneDir)
    if (result) fileResults.push(result)
  }

  const allIssues: VibeIssue[] = []

  // Per-file checks (run in parallel batches for speed)
  const perFileChecks = (f: FileResult): VibeIssue[] => [
    ...checkClientSideDbImport(f),
    ...checkUseEffectInfiniteRerender(f),
    ...checkUncleanedTimers(f),
    ...checkWebSocketLeak(f),
    ...checkServerActionInClientComponent(f),
    ...checkHooksInServerComponent(f),
    // CHECK 9 REMOVED (require() + ESM false-positive)
    ...checkIdorPatterns(f),
    ...checkEvalUsage(f),
    ...checkDangerousHtml(f),
    ...checkCorsWildcard(f),
    ...checkExposedDebugEndpoints(f),
    ...checkFloatMoney(f),
    ...checkStripeWebhookVerification(f),
    ...checkNPlusOneQuery(f),
    // CHECK 19–23: new checks
    ...checkServerActionNoValidation(f),
    ...checkUnboundedQueries(f),
    ...checkAuthEndpointNoRateLimit(f),
    ...checkEnvVarConsoleLog(f),
    ...checkRaceConditionInServerAction(f),
    // CHECK 24–26, 28, 30: SaaS-first checks
    ...checkMultiTenancyIsolation(f),
    ...checkJwtInLocalStorage(f),
    ...checkWebhookIdempotency(f),
    ...checkClientOnlyPlanGating(f),
    ...checkHardcodedLiveApiKey(f),
  ]

  for (const f of fileResults) {
    allIssues.push(...perFileChecks(f))
  }

  // Cross-file checks
  allIssues.push(...await checkMixedRouting(cloneDir))
  allIssues.push(...await checkMissingErrorBoundaries(cloneDir))  // CHECK 18
  allIssues.push(...checkTypeScriptAnyOveruse(fileResults))
  allIssues.push(...await checkMissingDataDeletion(cloneDir))     // CHECK 29

  // Deduplicate: same title + file + line
  const seen = new Set<string>()
  return allIssues.filter(i => {
    const key = `${i.title}|${i.file}|${i.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
