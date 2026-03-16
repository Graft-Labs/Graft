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
      if (/clearInterval|clearTimeout|return\s*\(\s*\)\s*=>/.test(line)) hasCleanup = true

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
 */
function checkWebSocketLeak(f: FileResult): VibeIssue[] {
  if (!f.content.includes('new WebSocket')) return []

  const issues: VibeIssue[] = []
  const WS_RE = /new\s+WebSocket\s*\(/g
  let m: RegExpExecArray | null

  while ((m = WS_RE.exec(f.content)) !== null) {
    // Check if there's a ws.close() / socket.close() anywhere in the same file
    if (!f.content.includes('.close()')) {
      const lineNum = f.content.slice(0, m.index).split('\n').length
      issues.push(issue(f.rel, lineNum, f.lines[lineNum - 1] ?? '', {
        guard: 'scalability', severity: 'medium', confidence: 'likely',
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
 */
async function checkMixedRouting(cloneDir: string): Promise<VibeIssue[]> {
  const hasAppRoutes =
    await dirHasRouteFiles(join(cloneDir, 'app'))
  const hasPagesRoutes =
    await dirHasRouteFiles(join(cloneDir, 'pages'))

  if (hasAppRoutes && hasPagesRoutes) {
    return [{
      file: 'package.json', line: 1, snippet: 'Both app/ and pages/ directories with route files detected',
      guard: 'scalability', severity: 'high', confidence: 'confirmed',
      title: 'Mixed App Router + Pages Router (both app/ and pages/ have routes)',
      description: 'Both `app/` (App Router) and `pages/` (Pages Router) contain route files. Mixing routers causes unpredictable hydration errors, layout mismatches, and makes middleware behavior ambiguous. Next.js officially supports migration but not permanent coexistence.',
      fix: 'Choose one router. To migrate fully to App Router: move all `pages/` routes to `app/`, replace `getServerSideProps`/`getStaticProps` with async Server Components, and delete the `pages/` directory (keep `pages/_document` only if needed).',
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
 * CHECK 9: require() mixed with ESM imports
 */
function checkRequireMixedWithEsm(f: FileResult): VibeIssue[] {
  const hasEsmImport = /^import\s+/m.test(f.content)
  if (!hasEsmImport) return []

  const REQUIRE_RE = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/
  for (let i = 0; i < f.lines.length; i++) {
    if (REQUIRE_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      return [issue(f.rel, i + 1, f.lines[i], {
        guard: 'scalability', severity: 'low', confidence: 'confirmed',
        title: 'require() mixed with ESM imports (module system mismatch)',
        description: `\`${f.rel}\` mixes \`require()\` (CommonJS) with \`import\` (ESM). This causes bundler errors and runtime issues, especially in Next.js edge runtime and Deno environments.`,
        fix: 'Replace `require()` with `import`:\n```ts\nimport { thing } from "package"\n```\nIf the package has no ESM export, use a dynamic import:\n```ts\nconst { thing } = await import("package")\n```',
      })]
    }
  }
  return []
}

/**
 * CHECK 10: userId / price / amount from request body (IDOR / price manipulation)
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

  // price/amount from body
  const PRICE_BODY_RE = /(?:req\.body|body|data|payload)\s*[\.\[]?\s*(?:price|amount|total|cost|fee)\b/i
  for (let i = 0; i < f.lines.length; i++) {
    if (PRICE_BODY_RE.test(f.lines[i]) && !f.lines[i].trim().startsWith('//')) {
      issues.push(issue(f.rel, i + 1, f.lines[i], {
        guard: 'monetization', severity: 'critical', confidence: 'likely',
        title: 'Price/amount taken from client body (payment manipulation)',
        description: `\`${f.rel}\` reads a price or amount directly from the request body. A user can change this to \`0.01\` in DevTools and pay pennies for any purchase.`,
        fix: 'Always look up the price server-side from your database or a Stripe Price ID:\n```ts\n// Good: price comes from server\nconst price = await db.products.findUnique({ where: { id: productId } })\nawait stripe.checkout.sessions.create({ line_items: [{ price: price.stripeId, quantity: 1 }] })\n```',
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
 * CHECK 16: Missing Stripe webhook signature verification
 */
function checkStripeWebhookVerification(f: FileResult): VibeIssue[] {
  if (!/webhook/i.test(f.rel)) return []
  if (!f.content.includes('stripe')) return []

  const hasVerification = /stripe\.webhooks\.constructEvent|constructEventAsync|Stripe\.webhooks/i.test(f.content)
  if (!hasVerification) {
    return [issue(f.rel, 1, f.lines[0] ?? '', {
      guard: 'monetization', severity: 'critical', confidence: 'likely',
      title: 'Stripe webhook without signature verification',
      description: `\`${f.rel}\` appears to be a Stripe webhook handler but does not call \`stripe.webhooks.constructEvent()\`. Without signature verification, anyone can POST fake webhook events to your endpoint — triggering order fulfillment, subscription upgrades, or account changes without payment.`,
      fix: '```ts\nconst sig = req.headers.get("stripe-signature")!\nconst event = stripe.webhooks.constructEvent(\n  await req.text(),  // raw body — NOT parsed JSON\n  sig,\n  process.env.STRIPE_WEBHOOK_SECRET!\n)\n```',
    })]
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

  const LOOP_START_RE = /\b(for|forEach|map|filter|reduce|while)\s*[\(\{]/
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
    ...checkRequireMixedWithEsm(f),
    ...checkIdorPatterns(f),
    ...checkEvalUsage(f),
    ...checkDangerousHtml(f),
    ...checkCorsWildcard(f),
    ...checkExposedDebugEndpoints(f),
    ...checkFloatMoney(f),
    ...checkStripeWebhookVerification(f),
    ...checkNPlusOneQuery(f),
  ]

  for (const f of fileResults) {
    allIssues.push(...perFileChecks(f))
  }

  // Cross-file checks
  allIssues.push(...await checkMixedRouting(cloneDir))
  allIssues.push(...checkTypeScriptAnyOveruse(fileResults))

  // Deduplicate: same title + file + line
  const seen = new Set<string>()
  return allIssues.filter(i => {
    const key = `${i.title}|${i.file}|${i.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
