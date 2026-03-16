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
import { detectStack, type StackInfo } from './helpers/detect-stack'
import { runVibeLeakDetector, type VibeIssue } from './helpers/vibe-leak-detector'

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

// ── Framework detection (legacy fallback for payload.framework) ───────────────
function detectFrameworkFromPkg(pkgJson: Record<string, unknown>): string {
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

// Mistral direct API is used — own key, separate quota, no shared rate limits.

// OpenRouter free models — fallback when Mistral is unavailable
const OPENROUTER_FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
]

const MAX_RATE_LIMIT_RETRIES_PER_MODEL = 2  // fast-fail per model to keep scan bounded

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

// Token budget: ~8k tokens ≈ 32k chars (Mistral tokenizes ~4 chars/token)
const MAX_TOTAL_CHARS = 32_000
// Per-category priority caps (chars) — ensures key files aren't crowded out
const CATEGORY_CAPS: Record<string, number> = {
  'api-route': 12_000,
  'auth':       8_000,
  'payment':    8_000,
  'database':   6_000,
  'config':     4_000,
  'source':     4_000,
}

async function selectRelevantFiles(
  cloneDir: string,
  _framework: string,
): Promise<RelevantFile[]> {
  const filesByCategory: Record<string, RelevantFile[]> = {}
  const totalCharsByCategory: Record<string, number> = {}

  // Always include package.json and .env.example
  const always = ['package.json', '.env.example', 'tsconfig.json']
  for (const name of always) {
    const fullPath = join(cloneDir, name)
    const content  = await readFileSafe(fullPath)
    if (content) {
      if (!filesByCategory['config']) { filesByCategory['config'] = []; totalCharsByCategory['config'] = 0 }
      filesByCategory['config'].push({ path: name, category: 'config', content })
      totalCharsByCategory['config'] = (totalCharsByCategory['config'] ?? 0) + content.length
    }
  }

  // Walk repo recursively, collect relevant files by category
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

      const cap = CATEGORY_CAPS[category] ?? 4_000
      if ((totalCharsByCategory[category] ?? 0) >= cap) continue

      const content = await readFileSafe(fullPath)
      if (!content || content.length > 15_000) continue  // skip huge individual files

      if (!filesByCategory[category]) { filesByCategory[category] = []; totalCharsByCategory[category] = 0 }
      filesByCategory[category].push({ path: rel, category, content })
      totalCharsByCategory[category] = (totalCharsByCategory[category] ?? 0) + content.length
    }
  }

  await walk(cloneDir)

  // Flatten by priority order, respecting total budget
  const priorityOrder = ['api-route', 'payment', 'auth', 'database', 'config', 'source']
  const files: RelevantFile[] = []
  let totalChars = 0

  for (const cat of priorityOrder) {
    for (const f of (filesByCategory[cat] ?? [])) {
      if (totalChars + f.content.length > MAX_TOTAL_CHARS) continue
      files.push(f)
      totalChars += f.content.length
    }
  }

  logger.log('relevant_files_selected', { count: files.length, totalChars })
  return files
}

// ── Zod schema for LLM output ──────────────────────────────────────────────────

// Normalize field names that different LLMs use interchangeably.
// Called on each raw issue object before Zod validation.
function normalizeLlmIssue(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const r = raw as Record<string, unknown>
  return {
    ...r,
    // Field name aliases
    fix_suggestion: r.fix_suggestion ?? r.fix ?? r.recommendation ?? r.remediation ?? r.solution ?? '',
    file_path:      r.file_path  ?? r.file  ?? r.filepath ?? r.path ?? undefined,
    line_number:    r.line_number ?? r.line  ?? r.lineNumber ?? r.line_num ?? undefined,
    description:    r.description ?? r.impact ?? r.detail ?? r.details ?? r.summary ?? '',
    confidence:     r.confidence ?? 'likely',
  }
}

const LlmIssueSchema = z.object({
  guard:          z.enum(['security', 'scalability', 'monetization', 'distribution']),
  severity:       z.enum(['critical', 'high', 'medium', 'low']),
  confidence:     z.enum(['confirmed', 'likely', 'possible']).optional().default('likely'),
  title:          z.string(),
  description:    z.string(),
  fix_suggestion: z.string().optional().default(''),
  file_path:      z.string().optional(),
  // Accept number (including 0 = unknown) or numeric string; treat 0 as absent
  line_number:    z.union([z.number().int().nonnegative(), z.string()]).optional()
                    .transform(v => {
                      if (v === undefined || v === null) return undefined
                      const n = typeof v === 'string' ? parseInt(v, 10) : v
                      return (Number.isFinite(n) && n > 0) ? n : undefined
                    }),
  code_snippet:   z.string().optional(),
})
const LlmOutputSchema = z.object({ issues: z.array(LlmIssueSchema) })

async function runLlmAnalysis(
  files: RelevantFile[],
  framework: string,
  _allDeps: Record<string, unknown>,
  stackInfo?: StackInfo,
): Promise<EnrichedIssue[]> {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const mistralKey    = process.env.MISTRAL_API_KEY

  if (!openRouterKey && !mistralKey) {
    logger.warn('llm_skipped', { reason: 'No LLM API keys set' })
    return []
  }
  if (files.length === 0) {
    logger.warn('llm_skipped', { reason: 'no relevant files selected' })
    return []
  }

  // Build stack description for the prompt
  const stackDesc = stackInfo
    ? `Framework: ${stackInfo.framework}. Languages: ${stackInfo.languages.join(', ')}.${stackInfo.isPolyglot ? ` Polyglot repo — also has ${stackInfo.backendLangs.join('+')} backend.` : ''}${stackInfo.isMonorepo ? ' Monorepo.' : ''}`
    : `Framework: ${framework}.`

  const systemPrompt = `You are a production-readiness auditor for vibe-coded / AI-generated web apps.
${stackDesc}

Audit ONLY for these guards:
- security: auth flaws (missing auth on API routes, IDOR — userId from request body), injection (SQL template literals, eval, XSS via dangerouslySetInnerHTML without sanitization), CORS wildcard + credentials, hardcoded secrets, exposed debug/admin endpoints, server actions without input validation
- scalability: N+1 queries (DB call inside loop), unbounded fetches (findMany/select with no limit/where), sync I/O blocking event loop (readFileSync in handlers), missing rate limiting on auth endpoints, race conditions in async server actions, TypeScript any overuse
- monetization: price/amount from client body (not server-side lookup), float math for money (use cents/Decimal), missing Stripe webhook signature verification, provisioning access on redirect instead of webhook

Rules:
- Only flag issues causing REAL harm to a live app with real users and real money
- Every high/critical issue MUST cite a specific file path AND include a code_snippet showing the problematic code
- Do NOT flag: missing features, style issues, test files, commented-out code, placeholder values in .env.example, polyfills like window.process (these are legitimate bundler patterns)
- Do NOT hallucinate issues for files you cannot see — only flag what is explicitly present in the provided code
- Confidence: "confirmed" = clearly visible in the provided code, "likely" = strong indicator present, "possible" = needs verification
- Severity: "critical" = exploitable right now, "high" = significant risk, "medium" = moderate, "low" = minor
- Aim for 5-15 high-confidence issues; aggressively skip speculative ones
- Be concise — short descriptions and fix_suggestions (2-3 sentences max each)
- Estimate business impact: what breaks or costs money if this is exploited

Return ONLY this JSON (no markdown, no explanation):
{"issues":[{"guard":"security","severity":"high","confidence":"confirmed","title":"...","description":"...","fix_suggestion":"...","file_path":"...","line_number":0,"code_snippet":"..."}]}`

  // Build file contents block
  const fileBlocks = files
    .map(f => `### FILE: ${f.path}\n\`\`\`\n${f.content.slice(0, 12_000)}\n\`\`\``)
    .join('\n\n')

  const userMessage = `Analyze the following codebase files for production-readiness issues.\n\n${fileBlocks}`

  // ── 1. Try Mistral direct API first ───────────────────────────────────────────
  if (mistralKey) {
    const result = await tryMistral(mistralKey, systemPrompt, userMessage)
    if (result !== null) return filterLlmIssues(result)
  }

  // ── 2. Fall back to OpenRouter free models ────────────────────────────────────
  if (openRouterKey) {
    for (const model of OPENROUTER_FREE_MODELS) {
      logger.log('llm_trying_model', { model })
      const result = await tryOpenRouterModel(openRouterKey, model, systemPrompt, userMessage)
      if (result !== null) return filterLlmIssues(result)
      logger.warn('llm_model_exhausted', { model })
    }
  }

  logger.warn('llm_failed_all_models')
  return []  // graceful degradation — grep/file checks still produce a full report
}

/**
 * Post-filter: drop high/critical LLM issues with no code_snippet.
 * These are almost always hallucinated — the LLM inferred the issue from file name,
 * not actual code. Keeping them inflates the false positive rate significantly.
 */
function filterLlmIssues(issues: EnrichedIssue[]): EnrichedIssue[] {
  const filtered = issues.filter(issue => {
    if (issue.severity === 'critical' || issue.severity === 'high') {
      if (!issue.code_snippet || issue.code_snippet.trim().length < 10) {
        logger.log('llm_issue_dropped_no_snippet', {
          title: issue.title,
          severity: issue.severity,
          file: issue.file_path,
        })
        return false
      }
    }
    return true
  })
  logger.log('llm_filter_applied', { before: issues.length, after: filtered.length })
  return filtered
}

// ── Mistral direct API call ────────────────────────────────────────────────────

async function tryMistral(
  apiKey: string,
  system: string,
  user:   string,
): Promise<EnrichedIssue[] | null> {
  logger.log('llm_trying_model', { model: 'mistral-small-latest' })
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model:           'mistral-small-latest',
          messages:        [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature:     0.1,
          max_tokens:      4096,
        }),
        signal: AbortSignal.timeout(90_000),
      })

      if (res.status === 429) {
        logger.warn('llm_rate_limited', { model: 'mistral', attempt })
        await new Promise(r => setTimeout(r, 30_000))
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        logger.warn('llm_model_failed', { model: 'mistral', status: res.status, body: body.slice(0, 200) })
        return null
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?:   { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        error?:   { message?: string }
      }

      if (data.error) {
        logger.warn('llm_model_error', { model: 'mistral', error: data.error.message })
        return null
      }

      // Log token usage so it's visible in the Trigger.dev trace
      if (data.usage) {
        logger.log('llm_tokens_used', {
          model:             'mistral-small-latest',
          prompt_tokens:     data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens:      data.usage.total_tokens,
        })
      }

      const raw = data.choices?.[0]?.message?.content ?? ''
      if (!raw.trim()) { logger.warn('llm_empty_response', { model: 'mistral' }); return null }

      return parseLlmResponse(raw, 'mistral-small-latest')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('llm_attempt_failed', { model: 'mistral', attempt, error: msg.slice(0, 200) })
      if (attempt < 2) await new Promise(r => setTimeout(r, 5_000))
    }
  }
  return null
}

// ── OpenRouter model call ──────────────────────────────────────────────────────

async function tryOpenRouterModel(
  apiKey: string,
  model:  string,
  system: string,
  user:   string,
): Promise<EnrichedIssue[] | null> {
  let rateLimitRetries = 0

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'https://shipguard-ai.vercel.app',
          'X-Title':       'ShipGuard AI',
        },
        body: JSON.stringify({
          model,
          messages:        [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          temperature:     0.1,
          max_tokens:      8192,
        }),
        signal: AbortSignal.timeout(90_000),
      })

      if (res.status === 429) {
        rateLimitRetries++
        const wait = Math.min(rateLimitRetries * 30_000, 60_000)
        logger.warn('llm_rate_limited', { model, rateLimitRetries, waitMs: wait })
        await new Promise(r => setTimeout(r, wait))
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES_PER_MODEL) attempt--
        continue
      }

      if (!res.ok) {
        const body = await res.text()
        logger.warn('llm_model_failed', { model, status: res.status, body: body.slice(0, 200) })
        return null
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?:   { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        error?:   { message?: string }
      }

      if (data.error) { logger.warn('llm_model_error', { model, error: data.error.message }); return null }

      // Log token usage so it's visible in the Trigger.dev trace
      if (data.usage) {
        logger.log('llm_tokens_used', {
          model,
          prompt_tokens:     data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens:      data.usage.total_tokens,
        })
      }

      const raw = data.choices?.[0]?.message?.content ?? ''
      if (!raw.trim()) { logger.warn('llm_empty_response', { model }); return null }

      return parseLlmResponse(raw, model)

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('llm_attempt_failed', { model, attempt, error: msg.slice(0, 200) })
      if (attempt < 2) await new Promise(r => setTimeout(r, 5_000))
    }
  }

  return null
}

// ── Shared LLM response parser ─────────────────────────────────────────────────

function parseLlmResponse(raw: string, model: string): EnrichedIssue[] | null {
  let parsed: unknown
  // Strip markdown fences if present (```json ... ``` or ``` ... ```)
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try { parsed = JSON.parse(stripped) }
  catch {
    // Try to extract a JSON object from somewhere in the response
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) }
      catch { /* fall through */ }
    }
    if (!parsed) {
      logger.warn('llm_non_json', {
        model,
        preview_head: raw.slice(0, 300),
        preview_tail: raw.slice(-200),
        raw_length: raw.length,
      })
      return null
    }
  }

  // Normalize field names on each issue before full-schema validation
  const rawIssues = (parsed as { issues?: unknown[] })?.issues ?? []
  const normalizedParsed = typeof parsed === 'object' && parsed !== null && 'issues' in (parsed as object)
    ? { ...(parsed as object), issues: rawIssues.map(normalizeLlmIssue) }
    : parsed

  const validated = LlmOutputSchema.safeParse(normalizedParsed)
  if (!validated.success) {
    const firstIssue = rawIssues[0] as Record<string, unknown> | undefined
    const firstNorm  = rawIssues.length > 0 ? normalizeLlmIssue(rawIssues[0]) : undefined
    logger.warn('llm_schema_invalid', {
      model,
      errors: validated.error.issues.slice(0, 5).map(e => ({ path: e.path.join('.'), msg: e.message })),
      raw_keys: typeof parsed === 'object' && parsed !== null ? Object.keys(parsed as object) : [],
      first_issue_keys: firstIssue ? Object.keys(firstIssue) : [],
      first_issue_sample: firstIssue ? JSON.stringify(firstIssue).slice(0, 300) : null,
      first_norm_sample: firstNorm ? JSON.stringify(firstNorm).slice(0, 300) : null,
      issues_count: rawIssues.length,
    })
    // Best-effort: extract whatever issues parsed correctly (with normalization)
    const goodIssues: EnrichedIssue[] = []
    for (const ri of rawIssues) {
      const single = LlmIssueSchema.safeParse(normalizeLlmIssue(ri))
      if (single.success) goodIssues.push({ ...single.data, category: single.data.guard })
    }
    logger.log('llm_partial_parse', { model, count: goodIssues.length })
    return goodIssues.length > 0 ? goodIssues : null
  }

  const issues: EnrichedIssue[] = validated.data.issues.map(i => ({ ...i, category: i.guard }))
  logger.log('llm_analysis_done', { model, issueCount: issues.length })
  return issues
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
        : detectFrameworkFromPkg(pkgJson)
      logger.log('framework_detected', { framework: detectedFramework })

      // Store framework in DB
      await supabase
        .from('scans')
        .update({ framework: detectedFramework })
        .eq('id', scanId)

      // ── Step 2b: Deep stack detection ─────────────────────────────────────────
      const stackInfo = await detectStack(cloneDir)
      logger.log('stack_detected', {
        framework:    stackInfo.framework,
        languages:    stackInfo.languages,
        isPolyglot:   stackInfo.isPolyglot,
        backendLangs: stackInfo.backendLangs,
        isMonorepo:   stackInfo.isMonorepo,
      })

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
      const [osvRaw, semgrepRaw, grepChecks, locCount, vibeIssues] = await Promise.all([
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

        // LOC count for huge repo detection
        runTool(
          `find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | grep -v node_modules | grep -v ".next" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}' || echo "0"`,
          cloneDir, 15_000
        ),

        // Vibe-leak-detector — in-process regex+AST scanner
        runVibeLeakDetector(cloneDir),
      ])

      // LOC-based huge repo detection
      const loc = parseInt(locCount.trim() || '0', 10)
      if (loc > 20_000) {
        logger.log('huge_repo_detected', { loc, mode: 'light' })
      }
      logger.log('analysis_batch_done', { loc, vibeIssuesFound: vibeIssues.length })

      // ── Step 5.5: LLM semantic analysis ───────────────────────────────────────
      // Select relevant files and run LLM for semantic issues grep can't catch
      logger.log('running_llm_analysis')
      const relevantFiles = await selectRelevantFiles(cloneDir, detectedFramework)
      const llmIssues = await runLlmAnalysis(relevantFiles, detectedFramework, allDeps, stackInfo)
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
        vibe_issues:      vibeIssues,
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
