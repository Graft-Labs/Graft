import { task, logger } from '@trigger.dev/sdk/v3'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, access, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, relative } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  analyzeToolOutputs,
  calculateScores,
  type ToolOutputs,
  type GrepCheckResults,
  type EnrichedIssue,
} from '@/lib/ai/analyzer'

const execAsync = promisify(exec)

export interface ScanTaskPayload {
  scanId: string
  repoOwner: string
  repoName: string
  branch: string
  githubToken?: string
  triggerRunId?: string
  framework?: string
}

// Run a shell command — never throws, returns stdout (or empty string on failure)
async function runTool(cmd: string, cwd: string, timeoutMs = 120_000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    })
    return stdout.trim()
  } catch (err: unknown) {
    // Security tools exit with non-zero when they find issues — that's expected
    const error = err as { stdout?: string; stderr?: string; message?: string }
    return error.stdout?.trim() || ''
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// ── Framework detection ────────────────────────────────────────────────────────
function detectFramework(pkgJson: Record<string, unknown>): string {
  const deps = {
    ...((pkgJson.dependencies as Record<string, unknown>) ?? {}),
    ...((pkgJson.devDependencies as Record<string, unknown>) ?? {}),
  }

  const has = (pkg: string) => pkg in deps

  if (has('next')) return 'nextjs'
  if (has('@sveltejs/kit')) return 'sveltekit'
  if (has('nuxt') || has('@nuxt/core')) return 'nuxt'
  if (has('react') && (has('vite') || has('@vitejs/plugin-react'))) return 'react-vite'
  if (has('express')) return 'express'
  if (has('@nestjs/core')) return 'nestjs'
  if (has('fastify')) return 'fastify'
  if (has('react')) return 'react'
  return 'unknown'
}

// ── LLM semantic analysis ──────────────────────────────────────────────────────

const LLM_MODEL = 'meta-llama/llama-3.3-70b-instruct:free'

// Dirs/extensions to skip when selecting files for LLM analysis
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out',
  '.vercel', 'coverage', '__pycache__', '.pytest_cache', '.mypy_cache',
])
const SKIP_EXTENSIONS = new Set([
  '.css', '.scss', '.less', '.sass', '.svg', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf',
  '.mp4', '.mp3', '.zip', '.tar', '.gz', '.lock',
])
// Files/patterns that are relevant for LLM analysis (by path substring)
const RELEVANT_PATTERNS = [
  // API routes
  /app\/api\//i, /pages\/api\//i,
  // Auth
  /middleware\.(ts|js)$/i, /lib\/auth/i, /utils\/auth/i, /helpers\/auth/i,
  /auth\.(ts|js|tsx|jsx)$/i,
  // DB / query
  /lib\/db/i, /lib\/database/i, /lib\/supabase/i, /lib\/prisma/i,
  /lib\/drizzle/i, /lib\/mongo/i, /query\.(ts|js)$/i, /schema\.(ts|js)$/i,
  /models\//i, /repositories\//i,
  // Payment
  /payment/i, /checkout/i, /stripe/i, /billing/i, /webhook/i, /subscription/i,
  /paddle/i, /lemonsqueezy/i, /razorpay/i,
  // Config / entry points
  /next\.config\./i, /vite\.config\./i,
  /app\/layout\.(tsx|jsx)$/i, /app\/page\.(tsx|jsx)$/i,
  /src\/main\.(tsx|jsx|ts|js)$/i, /src\/App\.(tsx|jsx)$/i,
  /src\/index\.(tsx|jsx|ts|js)$/i,
]

interface RelevantFile {
  path:     string  // relative path from repo root
  category: string
  content:  string
}

async function selectRelevantFiles(
  cloneDir: string,
  _framework: string,
): Promise<RelevantFile[]> {
  const files: RelevantFile[] = []
  const MAX_TOTAL_CHARS = 400_000
  let totalChars = 0

  // Always include package.json and .env.example
  const always = ['package.json', '.env.example', 'tsconfig.json']
  for (const name of always) {
    const fullPath = join(cloneDir, name)
    const content  = await readFileSafe(fullPath)
    if (content) {
      const rel = name
      files.push({ path: rel, category: 'config', content })
      totalChars += content.length
    }
  }

  // Walk repo recursively, collect relevant files
  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const rel      = relative(cloneDir, fullPath)

      // Skip hidden dirs and known junk dirs
      if (entry.startsWith('.') && entry !== '.env.example') continue
      const topDir = rel.split('/')[0]
      if (SKIP_DIRS.has(topDir) || SKIP_DIRS.has(entry)) continue

      let s: Awaited<ReturnType<typeof stat>>
      try { s = await stat(fullPath) } catch { continue }

      if (s.isDirectory()) {
        await walk(fullPath)
        continue
      }

      const ext = extname(entry).toLowerCase()
      if (SKIP_EXTENSIONS.has(ext)) continue
      if (!(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs'].includes(ext))) continue

      // Check if this file matches any relevant pattern
      const isRelevant = RELEVANT_PATTERNS.some(p => p.test(rel))
      if (!isRelevant) continue

      // Determine category
      let category = 'source'
      if (/app\/api\/|pages\/api\//i.test(rel)) category = 'api-route'
      else if (/middleware/i.test(rel) || /lib\/auth/i.test(rel)) category = 'auth'
      else if (/lib\/db|supabase|prisma|drizzle|mongo/i.test(rel)) category = 'database'
      else if (/payment|checkout|stripe|billing|webhook/i.test(rel)) category = 'payment'

      if (totalChars >= MAX_TOTAL_CHARS) continue
      const content = await readFileSafe(fullPath)
      if (!content || content.length > 80_000) continue  // skip huge files

      files.push({ path: rel, category, content })
      totalChars += content.length
    }
  }

  await walk(cloneDir)
  logger.log('relevant_files_selected', { count: files.length, totalChars })
  return files
}

// ── Zod schema for LLM output ──────────────────────────────────────────────────

const LlmIssueSchema = z.object({
  guard:          z.enum(['security', 'scalability', 'monetization', 'distribution']),
  severity:       z.enum(['critical', 'high', 'medium', 'low']),
  confidence:     z.enum(['confirmed', 'likely', 'possible']),
  title:          z.string().max(200),
  description:    z.string().max(1000),
  fix_suggestion: z.string().max(2000),
  file_path:      z.string().optional(),
  line_number:    z.number().int().positive().optional(),
  code_snippet:   z.string().max(800).optional(),
})
const LlmOutputSchema = z.object({ issues: z.array(LlmIssueSchema) })

async function runLlmAnalysis(
  files: RelevantFile[],
  framework: string,
  _allDeps: Record<string, unknown>,
): Promise<EnrichedIssue[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    logger.warn('llm_skipped', { reason: 'OPENROUTER_API_KEY not set' })
    return []
  }
  if (files.length === 0) {
    logger.warn('llm_skipped', { reason: 'no relevant files selected' })
    return []
  }

  const systemPrompt = `You are a production-readiness auditor for shipped web apps. Framework: ${framework}.

You audit ONLY for these 3 guards:
- security: auth flaws (missing auth checks, IDOR, userId from body), injection (SQL, eval, XSS via dangerouslySetInnerHTML), CORS wildcard, hardcoded credentials in code
- scalability: N+1 queries (db call inside loop), unbounded fetches (findMany/select with no limit/where), sync I/O blocking the event loop
- monetization: price/amount taken from client request body (instead of looking up server-side), float arithmetic for money without rounding, missing Stripe webhook signature verification

Rules:
- Only flag issues that would cause REAL harm to a live app with real users and real money
- Every issue MUST cite a specific file path from the provided code
- Line numbers are helpful but not required
- Do NOT flag missing features, style issues, or theoretical problems
- Do NOT flag things that need secrets/env vars to be hardcoded strings — Gitleaks handles those
- Do NOT flag commented-out code
- Do NOT flag things that look like test files (*.test.*, *.spec.*, __tests__)
- Confidence: "confirmed" = exact problem clearly visible in code, "likely" = strong indicator present, "possible" = needs verification
- Severity: "critical" = exploitable now / loss of money/data, "high" = significant risk, "medium" = moderate, "low" = minor
- Be conservative — 5 high-confidence real issues is better than 20 speculative ones

Return ONLY valid JSON: { "issues": [...] }
No explanation, no markdown wrapper, just the JSON object.`

  // Build file contents block
  const fileBlocks = files
    .map(f => `### FILE: ${f.path}\n\`\`\`\n${f.content.slice(0, 60_000)}\n\`\`\``)
    .join('\n\n')

  const userMessage = `Analyze the following codebase files for production-readiness issues.\n\n${fileBlocks}`

  let lastError: Error | null = null
  let rateLimitRetries = 0
  const MAX_RATE_LIMIT_RETRIES = 5
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://shipguard-ai.vercel.app',
          'X-Title': 'ShipGuard AI',
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 8192,
        }),
        signal: AbortSignal.timeout(120_000),
      })

      if (res.status === 429) {
        rateLimitRetries++
        // Exponential backoff: 15s, 30s, 60s, 90s, 120s
        const wait = Math.min(rateLimitRetries * 30_000, 120_000)
        logger.warn('llm_rate_limited', { rateLimitRetries, waitMs: wait })
        await new Promise(r => setTimeout(r, wait))
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          attempt-- // don't count rate limit as a failed attempt
        }
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`)
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
        error?:   { message?: string }
      }

      if (data.error) throw new Error(`LLM error: ${data.error.message}`)

      const raw = data.choices?.[0]?.message?.content ?? ''
      if (!raw.trim()) throw new Error('LLM returned empty response')

      // Parse and validate
      let parsed: unknown
      try { parsed = JSON.parse(raw) }
      catch { throw new Error(`LLM returned non-JSON: ${raw.slice(0, 200)}`) }

      const validated = LlmOutputSchema.safeParse(parsed)
      if (!validated.success) {
        logger.warn('llm_schema_invalid', { issues: validated.error.issues.slice(0, 3) })
        // Best-effort: try to extract whatever issues parsed correctly
        const rawIssues = (parsed as { issues?: unknown[] })?.issues ?? []
        const goodIssues: EnrichedIssue[] = []
        for (const raw of rawIssues) {
          const single = LlmIssueSchema.safeParse(raw)
          if (single.success) {
            goodIssues.push({ ...single.data, category: single.data.guard })
          }
        }
        logger.log('llm_partial_parse', { count: goodIssues.length })
        return goodIssues
      }

      const issues: EnrichedIssue[] = validated.data.issues.map(i => ({
        ...i,
        category: i.guard,
      }))

      logger.log('llm_analysis_done', { model: LLM_MODEL, issueCount: issues.length })
      return issues

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      logger.warn('llm_attempt_failed', { attempt, error: lastError.message.slice(0, 200) })
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5_000))
    }
  }

  logger.warn('llm_failed_all_attempts', { error: lastError?.message?.slice(0, 200) })
  return []  // graceful degradation
}

// ── Grep-based source code checks ─────────────────────────────────────────────
//
// Each check runs a grep command and returns the raw match lines (or empty string).
// The analyzer converts these into structured issues with proper descriptions + fixes.
//
// Why grep instead of Bearer/njsscan:
// - Bearer silently fails in the container (requires proprietary setup)
// - njsscan only covers server-side Node.js — misses React/Vite SPA patterns entirely
// - grep is universally available, fast (< 5s for all checks), and we control exactly
//   what we're looking for based on real-world vibe-coded app audit findings

async function runGrepChecks(
  cloneDir: string,
  framework: string,
  allDeps: Record<string, unknown>,
): Promise<GrepCheckResults> {
  const g = async (cmd: string): Promise<string> => runTool(cmd, cloneDir, 30_000)

  // Determine which directories to grep for frontend source code
  // React/Vite apps use src/, Next.js apps use app/ + components/ + lib/
  const srcDirs = 'src app components lib pages utils hooks'
  const allSrcFiles = '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"'
  const tsFiles = '--include="*.ts" --include="*.tsx"'

  const [
    // ── Security: Secret/Credential Exposure ──────────────────────────────────
    // S1.1 VITE_ prefix on secret env vars (all VITE_ vars ship in the JS bundle)
    viteSecretEnvVars,
    // S1.2 NEXT_PUBLIC_ prefix on secret-looking vars
    nextPublicSecretVars,
    // S1.3 API keys hardcoded in source (not via env)
    hardcodedApiKeys,
    // S1.6 DB ORM client imported directly in frontend source (browser-side DB access)
    clientSideDbImport,
    // S1.7 console.log printing env vars or secrets
    consoleLogSecrets,
    // S4.4 DEBUG=true in non-.env files
    debugModeEnabled,
    // S4.6 Node.js globals polyfilled onto window (exposes attack surface)
    windowNodePolyfill,
    // ── Scalability: Performance checks ────────────────────────────────────────
    // SC2.1 <img> tags instead of next/image
    imgTagNotNextImage,
    // SC2.6 images.unoptimized: true in next.config
    imagesUnoptimized,
    // SC3.2 Synchronous file I/O in request handlers
    syncFileIo,
    // SC3.6 setInterval never cleared
    intervalNotCleared,
    // SC3.3 console.log count in source (for noise metric)
    consoleLogCount,
    // ── Distribution: SEO & titles ─────────────────────────────────────────────
    // D1.6 Default Vite/CRA title still in index.html
    defaultAppTitle,
  ] = await Promise.all([
    // S1.1
    g(`grep -rn "VITE_.*KEY\\|VITE_.*URL\\|VITE_.*SECRET\\|VITE_.*TOKEN\\|VITE_.*PASSWORD\\|VITE_.*DATABASE" ${allSrcFiles} ${srcDirs} 2>/dev/null | head -20 || true`),
    // S1.2
    g(`grep -rn "NEXT_PUBLIC_.*SECRET\\|NEXT_PUBLIC_.*KEY\\|NEXT_PUBLIC_.*TOKEN\\|NEXT_PUBLIC_.*PASSWORD" ${allSrcFiles} . 2>/dev/null | grep -v "NEXT_PUBLIC_SUPABASE_URL\\|NEXT_PUBLIC_APP_URL\\|NEXT_PUBLIC_FIREBASE_API" | head -20 || true`),
    // S1.3 — look for raw API key patterns hardcoded (not in .env files)
    g(`grep -rn "sk-[a-zA-Z0-9]\\{20,\\}\\|sk_live_[a-zA-Z0-9]\\{20,\\}\\|pk_live_[a-zA-Z0-9]\\{20,\\}\\|AIza[a-zA-Z0-9]\\{35\\}\\|ghp_[a-zA-Z0-9]\\{36\\}" ${allSrcFiles} . 2>/dev/null | grep -v "\\.env\\|test\\|spec\\|node_modules" | head -10 || true`),
    // S1.6 — ORM/DB client imported in frontend source (single-quote and double-quote variants)
    g(`grep -rn "from 'drizzle-orm\\|from \"drizzle-orm\\|from '@neondatabase\\|from \"@neondatabase\\|from '@prisma/client\\|from \"@prisma/client\\|require('pg')\\|require(\"pg\")\\|from 'pg'\\|from \"pg\"" ${allSrcFiles} ${srcDirs} 2>/dev/null | head -20 || true`),
    // S1.7
    g(`grep -rn "console\\.log.*env\\|console\\.log.*key\\|console\\.log.*token\\|console\\.log.*password\\|console\\.log.*secret" ${allSrcFiles} . 2>/dev/null | grep -v "node_modules\\|test\\|spec" | head -10 || true`),
    // S4.4
    g(`grep -rn "DEBUG.*=.*true\\|debug.*=.*true\\|debug: true" --include="*.py" --include="*.ts" --include="*.js" --include="*.env.example" . 2>/dev/null | grep -v "node_modules\\|\\.git\\|test\\|spec\\|webpack\\|vite\\|esbuild\\|sourceMap\\|devtools" | head -10 || true`),
    // S4.6
    g(`grep -rn "window.*Buffer\\|window.*process\\s*=\\|(window as any)\\.Buffer\\|(window as any)\\.process\\|global\\.Buffer\\s*=" ${allSrcFiles} . 2>/dev/null | grep -v "node_modules\\|\\.git" | head -10 || true`),
    // SC2.1
    g(`grep -rn "<img " --include="*.tsx" --include="*.jsx" . 2>/dev/null | grep -v "node_modules\\|\\.git\\|next/image\\|// " | head -15 || true`),
    // SC2.6
    g(`grep -rn "unoptimized.*true\\|unoptimized: true" --include="*.ts" --include="*.js" --include="*.mjs" . 2>/dev/null | grep -v "node_modules\\|\\.git" | head -5 || true`),
    // SC3.2
    g(`grep -rn "readFileSync\\|writeFileSync\\|readdirSync\\|statSync" ${allSrcFiles} app/api pages/api 2>/dev/null | grep -v "node_modules\\|\\.git\\|test\\|spec\\|trigger.config" | head -10 || true`),
    // SC3.6
    g(`grep -rn "setInterval(" ${allSrcFiles} . 2>/dev/null | grep -v "node_modules\\|\\.git\\|clearInterval\\|test\\|spec" | head -10 || true`),
    // SC3.3 — count console.log lines
    g(`grep -rn "console\\.log(" ${allSrcFiles} . 2>/dev/null | grep -v "node_modules\\|\\.git\\|test\\|spec\\|\\.next" | wc -l || echo "0"`),
    // D1.6
    g(`grep -rn "Vite App\\|Create React App\\|<title>React\\|<title>Vite" --include="*.html" --include="*.tsx" . 2>/dev/null | grep -v "node_modules\\|\\.git" | head -5 || true`),
  ])

  // Dep-based checks (no grep needed — already have allDeps)
  const hasRateLimiting = Object.keys(allDeps).some(k =>
    k.includes('upstash/ratelimit') ||
    k.includes('rate-limiter-flexible') ||
    k.includes('express-rate-limit') ||
    k.includes('slowapi') ||
    k.includes('limiter')
  )

  const hasAuthLibrary =
    'next-auth' in allDeps ||
    '@auth/core' in allDeps ||
    '@clerk/nextjs' in allDeps ||
    '@clerk/clerk-react' in allDeps ||
    '@supabase/supabase-js' in allDeps ||
    '@supabase/auth-helpers-nextjs' in allDeps ||
    'firebase' in allDeps ||
    'lucia' in allDeps ||
    'passport' in allDeps ||
    'jsonwebtoken' in allDeps

  // Check if middleware.ts exists (Next.js global auth layer)
  const hasMiddleware =
    (await fileExists(join(cloneDir, 'middleware.ts'))) ||
    (await fileExists(join(cloneDir, 'middleware.js'))) ||
    (await fileExists(join(cloneDir, 'src/middleware.ts')))

  const results: GrepCheckResults = {
    // Security
    vite_secret_env_vars:    viteSecretEnvVars,
    next_public_secret_vars: nextPublicSecretVars,
    hardcoded_api_keys:      hardcodedApiKeys,
    client_side_db_import:   clientSideDbImport,
    console_log_secrets:     consoleLogSecrets,
    debug_mode_enabled:      debugModeEnabled,
    window_node_polyfill:    windowNodePolyfill,
    // Scalability
    img_tag_not_next_image:  imgTagNotNextImage,
    images_unoptimized:      imagesUnoptimized,
    sync_file_io:            syncFileIo,
    interval_not_cleared:    intervalNotCleared,
    console_log_count:       consoleLogCount.trim(),
    // Distribution
    default_app_title:       defaultAppTitle,
    // Dep-based
    has_rate_limiting:       String(hasRateLimiting),
    has_auth_library:        String(hasAuthLibrary),
    has_middleware:          String(hasMiddleware),
    framework,
  }

  logger.log('grep_checks_done', {
    vite_secret_env_vars:    !!viteSecretEnvVars,
    client_side_db_import:   !!clientSideDbImport,
    debug_mode_enabled:      !!debugModeEnabled,
    img_tag_not_next_image:  !!imgTagNotNextImage,
    has_rate_limiting:       hasRateLimiting,
    has_auth_library:        hasAuthLibrary,
    has_middleware:          hasMiddleware,
    console_log_count:       consoleLogCount.trim(),
  })

  return results
}

export const runScanTask = task({
  id: 'run-scan',
  // medium-1x: 2 vCPU, 4 GB RAM — semgrep is CPU-hungry
  machine: { preset: 'medium-1x' },
  // 10 minutes max per scan
  maxDuration: 600,
  run: async (payload: ScanTaskPayload) => {
    const { scanId, repoOwner, repoName, branch, githubToken } = payload

    logger.log('scan_started', { scanId, repo: `${repoOwner}/${repoName}`, branch })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    await supabase
      .from('scans')
      .update({ status: 'scanning' })
      .eq('id', scanId)

    let cloneDir: string | null = null

    try {
      // ── Step 1: Clone ─────────────────────────────────────────────────────────
      cloneDir = await mkdtemp(join(tmpdir(), 'shipguard-'))
      logger.log('cloning_repo', { cloneDir, repo: `${repoOwner}/${repoName}` })

      const cloneUrl = githubToken
        ? `https://x-access-token:${githubToken}@github.com/${repoOwner}/${repoName}.git`
        : `https://github.com/${repoOwner}/${repoName}.git`

      await execAsync(
        `git clone --depth 50 --branch ${branch} ${cloneUrl} .`,
        { cwd: cloneDir, timeout: 90_000 }
      )
      logger.log('clone_complete', { cloneDir })

      // Capture commit hash
      const commitHash = (await runTool('git rev-parse HEAD', cloneDir)).slice(0, 7) || null
      if (commitHash) {
        await supabase.from('scans').update({ commit_hash: commitHash }).eq('id', scanId)
      }

      // ── Step 2: Read package.json + detect framework ───────────────────────────
      const pkgJsonPath = join(cloneDir, 'package.json')
      let pkgJson: Record<string, unknown> = {}
      try {
        const raw = await readFile(pkgJsonPath, 'utf-8')
        pkgJson = JSON.parse(raw)
      } catch { /* no package.json — non-Node project */ }

      // Only use client-supplied framework if it's a real value — never trust "unknown"
      // (the UI sends "unknown" as default when detection fails, which would suppress
      //  all framework-specific grep checks like isNextJs / isVite)
      const detectedFramework = (payload.framework && payload.framework !== 'unknown')
        ? payload.framework
        : detectFramework(pkgJson)
      logger.log('framework_detected', { framework: detectedFramework })

      // Store framework in DB
      await supabase
        .from('scans')
        .update({ framework: detectedFramework })
        .eq('id', scanId)

      const allDeps = {
        ...((pkgJson.dependencies as Record<string, unknown>) ?? {}),
        ...((pkgJson.devDependencies as Record<string, unknown>) ?? {}),
      }

      // ── Step 3: Detect lockfile ────────────────────────────────────────────────
      const hasPackageLock = await fileExists(join(cloneDir, 'package-lock.json'))
      const hasYarnLock    = await fileExists(join(cloneDir, 'yarn.lock'))
      const hasPnpmLock    = await fileExists(join(cloneDir, 'pnpm-lock.yaml'))
      const lockfile = hasPackageLock ? 'package-lock.json'
        : hasYarnLock ? 'yarn.lock'
        : hasPnpmLock ? 'pnpm-lock.yaml'
        : null
      logger.log('lockfile_detected', { lockfile })

      // ── Step 4: Install tool binaries ──────────────────────────────────────────
      // Only install what reliably works in the container:
      // - Gitleaks: static binary, fast, highly accurate for secrets
      // - semgrep: via pip3 (Python is available), runs our local custom rules only
      // Bearer CLI and njsscan are intentionally dropped:
      // - Bearer fails silently in the container (proprietary setup required)
      // - njsscan only covers server-side Node.js, misses SPA/React patterns entirely
      // Our grep-based checks cover the same patterns with zero install overhead.
      logger.log('installing_tools')
      await Promise.all([
        // Gitleaks — static binary, reliable secret scanner
        runTool(
          'curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_linux_x64.tar.gz | tar xz -C /tmp gitleaks && chmod +x /tmp/gitleaks',
          cloneDir, 60_000
        ),
        // semgrep — via pip3, will run local rules only (no registry calls)
        runTool(
          'pip3 install semgrep --quiet 2>/dev/null; true',
          cloneDir, 90_000
        ),
      ])
      logger.log('tools_installed')

      // ── Step 5: Run all tools + grep checks in parallel ────────────────────────
      //
      // Gitleaks git history scan runs first (slowest, ~60-90s)
      // All other analysis runs concurrently with it

      logger.log('running_gitleaks_batch')
      const [gitleaksFsRaw, gitleaksGitRaw] = await Promise.all([
        runTool(
          '/tmp/gitleaks dir . --report-format json --report-path /tmp/gitleaks-fs.json --exit-code 0 --no-banner 2>/dev/null; cat /tmp/gitleaks-fs.json 2>/dev/null || echo "[]"',
          cloneDir, 120_000
        ),
        runTool(
          '/tmp/gitleaks git . --report-format json --report-path /tmp/gitleaks-git.json --exit-code 0 --no-banner 2>/dev/null; cat /tmp/gitleaks-git.json 2>/dev/null || echo "[]"',
          cloneDir, 120_000
        ),
      ])
      logger.log('gitleaks_done', {
        fs: tryParseArray(gitleaksFsRaw).length,
        git: tryParseArray(gitleaksGitRaw).length,
      })

      // Local semgrep config path — additionalFiles deploys semgrep-rules/ to /app/semgrep-rules
      const semgrepRulesPath = join(process.cwd(), 'semgrep-rules')
      // Run semgrep with local rules ONLY (no registry calls — faster, reliable, deterministic)
      const semgrepCmd = `python3 -m semgrep --config=${semgrepRulesPath} --json --quiet --timeout 30 . 2>/dev/null || echo '{"results":[]}'`

      logger.log('running_analysis_batch')
      const [osvRaw, semgrepRaw, grepChecks] = await Promise.all([
        // OSV-Scanner — CVEs in lockfile deps
        lockfile
          ? runTool(
              `npx --yes @osv-scanner/cli@latest -l ${lockfile} --format json 2>/dev/null || echo '{"results":[]}'`,
              cloneDir, 90_000
            )
          : Promise.resolve(''),

        // Semgrep — local custom rules only
        runTool(semgrepCmd, cloneDir, 120_000),

        // Grep-based source code checks — deterministic, unambiguous patterns
        runGrepChecks(cloneDir, detectedFramework, allDeps),
      ])
      logger.log('analysis_batch_done')

      // ── Step 5.5: LLM semantic analysis ───────────────────────────────────────
      // Select relevant files and run LLM for semantic issues grep can't catch
      logger.log('running_llm_analysis')
      const relevantFiles = await selectRelevantFiles(cloneDir, detectedFramework)
      const llmIssues = await runLlmAnalysis(relevantFiles, detectedFramework, allDeps)
      logger.log('llm_analysis_complete', { issueCount: llmIssues.length })

      // ── Step 6: File-based checks ──────────────────────────────────────────────
      logger.log('running_file_checks')

      const check = async (relPath: string): Promise<boolean> =>
        fileExists(join(cloneDir!, relPath))

      // Count use client directives
      const useClientCountRaw = await runTool(
        'grep -rl \'"use client"\' --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" . 2>/dev/null | wc -l',
        cloneDir
      )
      const useClientCount = parseInt(useClientCountRaw.trim() || '0', 10)

      // Loading and error boundaries
      const hasLoadingTsx = (await runTool('find app -name "loading.tsx" 2>/dev/null | wc -l', cloneDir)).trim()
      const hasErrorTsx   = (await runTool('find app -name "error.tsx"   2>/dev/null | wc -l', cloneDir)).trim()

      // Security headers in next.config
      const nextConfigContent = await readFileSafe(join(cloneDir, 'next.config.ts'))
        || await readFileSafe(join(cloneDir, 'next.config.js'))
        || await readFileSafe(join(cloneDir, 'next.config.mjs'))
        || ''
      const hasSecurityHeaders = nextConfigContent.includes('Content-Security-Policy')
        || nextConfigContent.includes('X-Frame-Options')
        || nextConfigContent.includes('headers()')
        || nextConfigContent.includes('headers: async')

      // Check .gitignore for .env exposure
      const gitignoreContent = await readFileSafe(join(cloneDir, '.gitignore')) || ''
      const gitignoreCoversEnv = gitignoreContent.includes('.env')

      // Check for OG meta in layout
      const rootLayoutContent = await readFileSafe(join(cloneDir, 'app/layout.tsx'))
        || await readFileSafe(join(cloneDir, 'app/layout.jsx'))
        || ''
      const hasOgMeta = rootLayoutContent.includes('og:') || rootLayoutContent.includes('openGraph')

      // npm hallucination check for top deps
      const topDeps = Object.keys(allDeps).slice(0, 25)
      const hallucinatedPkgs = await checkHallucinatedPackages(topDeps)

      // Check for payment providers beyond Stripe
      const hasPaddle       = 'paddle' in allDeps || '@paddle/paddle-node-sdk' in allDeps
      const hasLemonSqueezy = '@lemonsqueezy/lemonsqueezy.js' in allDeps
      const hasRazorpay     = 'razorpay' in allDeps

      // Check for auth library
      const hasNextAuth     = 'next-auth' in allDeps || '@auth/core' in allDeps
      const hasClerk        = '@clerk/nextjs' in allDeps || '@clerk/clerk-react' in allDeps
      const hasSupabaseAuth = '@supabase/supabase-js' in allDeps || '@supabase/auth-helpers-nextjs' in allDeps

      const fileChecks: ToolOutputs['file_checks'] = {
        // Distribution / SEO
        env_example:              String(await check('.env.example')),
        robots_txt:               String(await check('public/robots.txt')),
        sitemap_xml:              String(
          (await check('public/sitemap.xml')) || (await check('app/sitemap.ts')) || (await check('app/sitemap.js'))
        ),
        not_found_page:           String(
          (await check('app/not-found.tsx')) || (await check('pages/404.tsx'))
        ),
        pricing_page:             String(
          (await check('app/pricing/page.tsx')) || (await check('pages/pricing.tsx')) || (await check('pricing.html'))
        ),
        privacy_policy:           String(
          (await check('app/privacy/page.tsx')) || (await check('pages/privacy.tsx')) || (await check('privacy.html'))
        ),
        terms_of_service:         String(
          (await check('app/terms/page.tsx')) || (await check('pages/terms.tsx')) || (await check('terms.html'))
        ),
        manifest_json:            String(await check('public/manifest.json')),

        // Analytics + monitoring
        has_stripe:               String('stripe' in allDeps),
        has_paddle:               String(hasPaddle),
        has_lemonsqueezy:         String(hasLemonSqueezy),
        has_razorpay:             String(hasRazorpay),
        has_sentry:               String(Object.keys(allDeps).some(k => k.startsWith('@sentry'))),
        has_plausible:            String(Object.keys(allDeps).some(k => k.includes('plausible'))),
        has_google_analytics:     String(Object.keys(allDeps).some(k => k.includes('react-ga') || k.includes('gtag'))),
        has_posthog:              String(Object.keys(allDeps).some(k => k.includes('posthog'))),

        // Next.js specific
        has_loading_tsx:          hasLoadingTsx || '0',
        has_error_tsx:            hasErrorTsx   || '0',
        has_security_headers:     String(hasSecurityHeaders),
        has_og_meta:              String(hasOgMeta),
        gitignore_covers_env:     String(gitignoreCoversEnv),

        // Auth
        has_auth_library:         String(hasNextAuth || hasClerk || hasSupabaseAuth),

        // Scalability
        use_client_count:         String(useClientCount),
        framework:                detectedFramework,

        // Hallucinated packages
        hallucinated_packages:    hallucinatedPkgs.join(','),
      }

      logger.log('file_checks_done', { useClientCount, hasSecurityHeaders, hasOgMeta, hallucinatedPkgs })

      // ── Step 7: Analyze + score ────────────────────────────────────────────────
      const toolOutputs: ToolOutputs = {
        scan_id:          scanId,
        framework:        detectedFramework,
        gitleaks_fs:      tryParseArray(gitleaksFsRaw),
        gitleaks_git:     tryParseArray(gitleaksGitRaw),
        osv:              tryParseObj(osvRaw, { results: [] }),
        semgrep:          tryParseObj(semgrepRaw, { results: [] }),
        grep_checks:      grepChecks,
        file_checks:      fileChecks,
        llm_issues:       llmIssues,
        osv_skipped:      !lockfile,
        osv_skip_reason:  lockfile ? null : 'No lockfile found',
      }

      const issues = await analyzeToolOutputs(toolOutputs)
      const scores = calculateScores(issues)

      logger.log('analysis_complete', { scanId, issuesCount: issues.length, scores })

      // ── Step 8: Write to Supabase ──────────────────────────────────────────────
      const criticalCount = issues.filter(i => i.severity === 'critical').length
      const highCount     = issues.filter(i => i.severity === 'high').length
      const mediumCount   = issues.filter(i => i.severity === 'medium').length
      const lowCount      = issues.filter(i => i.severity === 'low').length

      // Delete any existing issues for this scan before inserting fresh ones.
      // This prevents duplicate rows when the same scanId is re-run (e.g. via MCP or admin).
      await supabase.from('issues').delete().eq('scan_id', scanId)

      const { error: updateError } = await supabase
        .from('scans')
        .update({
          status: 'complete',
          overall_score:        scores.overall,
          security_score:       scores.security,
          scalability_score:    scores.scalability,
          monetization_score:   scores.monetization,
          distribution_score:   scores.distribution,
          critical_count:       criticalCount,
          high_count:           highCount,
          medium_count:         mediumCount,
          low_count:            lowCount,
          completed_at:         new Date().toISOString(),
        })
        .eq('id', scanId)

      if (updateError) {
        throw new Error(`Failed to update scan record: ${updateError.message}`)
      }

      if (issues.length > 0) {
        const issuesToInsert = issues.map(issue => ({
          scan_id:      scanId,
          guard:        issue.guard,
          severity:     issue.severity,
          title:        issue.title,
          description:  issue.description,
          file:         issue.file_path ?? null,
          line:         issue.line_number ?? null,
          fix:          issue.fix_suggestion,
          confidence:   issue.confidence ?? null,
          code_snippet: issue.code_snippet ?? null,
        }))

        const { error: insertError } = await supabase
          .from('issues')
          .insert(issuesToInsert)

        if (insertError) {
          logger.warn('issues_insert_failed', { error: insertError.message })
        } else {
          logger.log('issues_inserted', { count: issuesToInsert.length })
        }
      }

      logger.log('scan_complete', { scanId, scores, issuesCount: issues.length })
      return { scanId, scores, issuesCount: issues.length }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('scan_failed', { scanId, error: message })
      await supabase.from('scans').update({ status: 'failed' }).eq('id', scanId)
      throw error
    } finally {
      if (cloneDir) {
        await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  },
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function tryParseArray(raw: string): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function tryParseObj(raw: string, fallback: unknown): unknown {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

// Check if packages are likely hallucinated (< 100 downloads/week on npm)
async function checkHallucinatedPackages(pkgs: string[]): Promise<string[]> {
  const hallucinated: string[] = []

  await Promise.all(
    pkgs.map(async (pkg) => {
      // Skip scoped packages and well-known packages to reduce false positives
      if (pkg.startsWith('@') || KNOWN_PACKAGES.has(pkg)) return

      try {
        const res = await fetch(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (res.ok) {
          const data = await res.json() as { downloads?: number }
          if (typeof data.downloads === 'number' && data.downloads < 100) {
            hallucinated.push(pkg)
          }
        } else if (res.status === 404) {
          // Package does not exist on npm at all
          hallucinated.push(pkg)
        }
      } catch {
        // Network error — skip this package
      }
    })
  )

  return hallucinated
}

// Large set of known-legitimate packages to skip the npm check for
const KNOWN_PACKAGES = new Set([
  'react', 'react-dom', 'next', 'typescript', 'tailwindcss', 'eslint',
  'prettier', 'vite', 'express', 'fastify', 'koa', 'hapi',
  'axios', 'lodash', 'moment', 'dayjs', 'date-fns',
  'zod', 'yup', 'joi', 'class-validator',
  'stripe', 'razorpay', 'paddle',
  'prisma', 'sequelize', 'mongoose', 'drizzle-orm', 'typeorm',
  'jsonwebtoken', 'bcrypt', 'bcryptjs', 'argon2',
  'dotenv', 'cross-env', 'nodemon', 'ts-node',
  'jest', 'vitest', 'mocha', 'chai', 'sinon', 'cypress', 'playwright',
  'webpack', 'rollup', 'esbuild', 'swc',
  'framer-motion', 'gsap', 'three',
  'zustand', 'jotai', 'recoil', 'mobx', 'redux', '@reduxjs/toolkit',
  'swr', '@tanstack/react-query', 'react-query',
  'uuid', 'nanoid', 'cuid',
  'sharp', 'jimp', 'canvas',
  'socket.io', 'ws', 'ioredis', 'redis',
  'multer', 'formidable', 'busboy',
  'nodemailer', 'sendgrid', 'resend', '@sendgrid/mail',
  'openai', 'anthropic',
])
