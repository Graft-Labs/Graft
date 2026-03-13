import { task, logger } from '@trigger.dev/sdk/v3'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  analyzeToolOutputs,
  calculateScores,
  type ToolOutputs,
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

      const detectedFramework = payload.framework ?? detectFramework(pkgJson)
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
      logger.log('installing_tools')
      await Promise.all([
        // Gitleaks — MIT license, secret scanner
        runTool(
          'curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_linux_x64.tar.gz | tar xz -C /tmp gitleaks && chmod +x /tmp/gitleaks',
          cloneDir, 60_000
        ),
        // Bearer CLI — OWASP Top 10, PII, hardcoded secrets
        runTool(
          'curl -sfL https://raw.githubusercontent.com/Bearer/bearer/main/contrib/install.sh | sh -s -- -b /tmp/bearer-bin 2>/dev/null; true',
          cloneDir, 60_000
        ),
      ])

      // Write .njsscan config file for TypeScript support
      const njsscanConfig = `---
nodejs-extensions:
  - .js
  - .ts
  - .tsx
ignore-paths:
  - node_modules
  - .next
  - dist
  - build
`
      await writeFile(join(cloneDir, '.njsscan'), njsscanConfig)
      logger.log('tools_installed')

      // ── Step 5: Run tools in parallel batches ──────────────────────────────────
      //
      // Batch A (runs first — git history scan is slowest): Gitleaks filesystem + git log
      // Batch B (concurrent with A's tail): OSV + Semgrep + Bearer + njsscan
      //
      // Total budget: ~3 minutes (Gitleaks git history ≈ 90s, others ≈ 30–45s each)

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

      // Build semgrep config args based on framework
      const semgrepConfigs = buildSemgrepConfigs(detectedFramework)
      const semgrepCmd = `npx --yes semgrep@latest ${semgrepConfigs} --json --quiet --timeout 30 . 2>/dev/null || echo '{"results":[]}'`

      logger.log('running_analysis_batch')
      const [osvRaw, semgrepRaw, bearerRaw, njsscanRaw] = await Promise.all([
        // OSV-Scanner — CVEs in lockfile deps
        lockfile
          ? runTool(
              `npx --yes @osv-scanner/cli@latest -l ${lockfile} --format json 2>/dev/null || echo '{"results":[]}'`,
              cloneDir, 90_000
            )
          : Promise.resolve(''),

        // Semgrep — SAST + custom rules
        runTool(semgrepCmd, cloneDir, 120_000),

        // Bearer CLI — OWASP Top 10, PII, data flow
        runTool(
          '/tmp/bearer-bin/bearer scan . --format json --output /tmp/bearer.json --quiet 2>/dev/null; cat /tmp/bearer.json 2>/dev/null || echo \'{"critical":[],"high":[],"medium":[],"low":[]}\'',
          cloneDir, 90_000
        ),

        // njsscan — Node.js-specific: eval, prototype pollution, JWT none-alg
        runTool(
          'pip3 install njsscan --quiet 2>/dev/null; njsscan --json -o /tmp/njsscan.json . 2>/dev/null; cat /tmp/njsscan.json 2>/dev/null || echo \'{"nodejs":{}}\'',
          cloneDir, 90_000
        ),
      ])
      logger.log('analysis_batch_done')

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
        bearer:           tryParseObj(bearerRaw, { critical: [], high: [], medium: [], low: [] }),
        njsscan:          tryParseObj(njsscanRaw, { nodejs: {} }),
        file_checks:      fileChecks,
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

function buildSemgrepConfigs(framework: string): string {
  const configs: string[] = []

  // Universal configs for all Node/JS/TS projects
  configs.push('--config=p/nodejs')
  configs.push('--config=p/react')

  // Framework-specific
  if (framework === 'nextjs') {
    configs.push('--config=p/nextjs')
  }

  // Custom rules are deployed alongside the task via additionalFiles in trigger.config.ts.
  // With legacyDevProcessCwdBehaviour: false, process.cwd() == /app (build dir) in both dev and prod.
  const customRulesPath = join(process.cwd(), 'semgrep-rules')
  configs.push(`--config=${customRulesPath}`)

  return configs.join(' ')
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
