import { task, logger } from '@trigger.dev/sdk/v3'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, access } from 'node:fs/promises'
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
}

// Run a shell command and return stdout. Never throws — returns empty string on failure.
async function runTool(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      cwd,
      timeout: 120_000, // 2 min per tool
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    })
    return stdout.trim()
  } catch (err: unknown) {
    // Many security tools exit with non-zero when they find issues — that's fine
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

export const runScanTask = task({
  id: 'run-scan',
  // Use medium machine — semgrep is CPU-hungry
  machine: { preset: 'medium-1x' },
  // Max 10 minutes per scan — plenty for all 4 tools
  maxDuration: 600,
  run: async (payload: ScanTaskPayload) => {
    const { scanId, repoOwner, repoName, branch, githubToken, triggerRunId } = payload

    logger.log('scan_started', { scanId, repo: `${repoOwner}/${repoName}`, branch })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    // Mark scan as running and store the Trigger.dev run ID for progress polling
    await supabase
      .from('scans')
      .update({
        status: 'scanning',
        ...(triggerRunId ? { trigger_run_id: triggerRunId } : {}),
      })
      .eq('id', scanId)

    let cloneDir: string | null = null

    try {
      // ── Step 1: Clone the repo ────────────────────────────────────────────
      cloneDir = await mkdtemp(join(tmpdir(), 'shipguard-'))
      logger.log('cloning_repo', { cloneDir, repo: `${repoOwner}/${repoName}` })

      const cloneUrl = githubToken
        ? `https://x-access-token:${githubToken}@github.com/${repoOwner}/${repoName}.git`
        : `https://github.com/${repoOwner}/${repoName}.git`

      await execAsync(
        `git clone --depth 1 --branch ${branch} ${cloneUrl} .`,
        { cwd: cloneDir, timeout: 60_000 }
      )
      logger.log('clone_complete', { cloneDir })

      // Capture the commit hash
      const commitHash = (await runTool('git rev-parse HEAD', cloneDir)).slice(0, 7) || null
      if (commitHash) {
        await supabase.from('scans').update({ commit_hash: commitHash }).eq('id', scanId)
      }

      // ── Step 2: Detect lockfile ───────────────────────────────────────────
      const hasPackageLock = await fileExists(join(cloneDir, 'package-lock.json'))
      const hasYarnLock = await fileExists(join(cloneDir, 'yarn.lock'))
      const hasPnpmLock = await fileExists(join(cloneDir, 'pnpm-lock.yaml'))
      const lockfile = hasPackageLock
        ? 'package-lock.json'
        : hasYarnLock
        ? 'yarn.lock'
        : hasPnpmLock
        ? 'pnpm-lock.yaml'
        : null

      logger.log('lockfile_detected', { lockfile })

      // ── Step 3: Run TruffleHog ────────────────────────────────────────────
      logger.log('running_trufflehog')
      const trufflehogRaw = await runTool(
        'npx --yes trufflehog@latest filesystem --json .',
        cloneDir
      )
      // TruffleHog outputs one JSON object per line (NDJSON)
      let trufflehog: unknown[] = []
      if (trufflehogRaw) {
        trufflehog = trufflehogRaw
          .split('\n')
          .filter(Boolean)
          .map(line => {
            try { return JSON.parse(line) } catch { return null }
          })
          .filter(Boolean)
      }
      logger.log('trufflehog_done', { findings: trufflehog.length })

      // ── Step 4: Run OSV-Scanner ───────────────────────────────────────────
      let osv: unknown = []
      let osvSkipped = false
      let osvSkipReason: string | null = null

      if (lockfile) {
        logger.log('running_osv', { lockfile })
        const osvRaw = await runTool(
          `npx --yes @osv-scanner/cli@latest -l ${lockfile} --format json`,
          cloneDir
        )
        try {
          osv = osvRaw ? JSON.parse(osvRaw) : []
        } catch {
          osv = []
        }
        logger.log('osv_done')
      } else {
        osvSkipped = true
        osvSkipReason = 'No lockfile found'
        logger.log('osv_skipped', { reason: osvSkipReason })
      }

      // ── Step 5: Run Semgrep ───────────────────────────────────────────────
      logger.log('running_semgrep')
      const semgrepRaw = await runTool(
        'npx --yes semgrep@latest --config=auto --json --quiet .',
        cloneDir
      )
      let semgrep: unknown = { results: [] }
      try {
        semgrep = semgrepRaw ? JSON.parse(semgrepRaw) : { results: [] }
      } catch {
        semgrep = { results: [] }
      }
      const semgrepResults = (semgrep as { results?: unknown[] }).results ?? []
      logger.log('semgrep_done', { results: semgrepResults.length })

      // ── Step 6: Run react-doctor ──────────────────────────────────────────
      logger.log('running_react_doctor')
      const reactDoctorRaw = await runTool(
        'npx --yes react-doctor@latest --json .',
        cloneDir
      )
      let reactDoctor: unknown = { issues: [] }
      try {
        reactDoctor = reactDoctorRaw ? JSON.parse(reactDoctorRaw) : { issues: [] }
      } catch {
        reactDoctor = { issues: [] }
      }
      logger.log('react_doctor_done')

      // ── Step 7: File checks ───────────────────────────────────────────────
      logger.log('running_file_checks')

      const check = async (relPath: string): Promise<boolean> =>
        fileExists(join(cloneDir!, relPath))

      const pkgJsonPath = join(cloneDir, 'package.json')
      let pkgJson: Record<string, unknown> = {}
      try {
        const raw = await readFile(pkgJsonPath, 'utf-8')
        pkgJson = JSON.parse(raw)
      } catch { /* no package.json */ }

      const allDeps = {
        ...((pkgJson.dependencies as Record<string, unknown>) ?? {}),
        ...((pkgJson.devDependencies as Record<string, unknown>) ?? {}),
      }

      const hasLoadingTsx =
        (await runTool('find app -name "loading.tsx" 2>/dev/null | wc -l', cloneDir)).trim()
      const hasErrorTsx =
        (await runTool('find app -name "error.tsx" 2>/dev/null | wc -l', cloneDir)).trim()

      const fileChecks: ToolOutputs['file_checks'] = {
        env_example:        String(await check('.env.example')),
        robots_txt:         String(await check('public/robots.txt')),
        sitemap_xml:        String(await check('public/sitemap.xml')),
        not_found_page:     String(
          (await check('app/not-found.tsx')) || (await check('pages/404.tsx'))
        ),
        pricing_page:       String(
          (await check('app/pricing/page.tsx')) ||
          (await check('pages/pricing.tsx')) ||
          (await check('pricing.html'))
        ),
        privacy_policy:     String(
          (await check('app/privacy/page.tsx')) ||
          (await check('pages/privacy.tsx')) ||
          (await check('privacy.html'))
        ),
        terms_of_service:   String(
          (await check('app/terms/page.tsx')) ||
          (await check('pages/terms.tsx')) ||
          (await check('terms.html'))
        ),
        manifest_json:      String(await check('public/manifest.json')),
        has_stripe:         String('stripe' in allDeps),
        has_sentry:         String(Object.keys(allDeps).some(k => k.startsWith('@sentry'))),
        has_plausible:      String(Object.keys(allDeps).some(k => k.includes('plausible'))),
        has_google_analytics: String(Object.keys(allDeps).some(k => k.includes('react-ga'))),
        has_posthog:        String(Object.keys(allDeps).some(k => k.includes('posthog'))),
        has_loading_tsx:    hasLoadingTsx || '0',
        has_error_tsx:      hasErrorTsx || '0',
      }

      logger.log('file_checks_done', { fileChecks })

      // ── Step 8: Analyze + score ───────────────────────────────────────────
      const toolOutputs: ToolOutputs = {
        scan_id: scanId,
        trufflehog,
        osv,
        semgrep,
        react_doctor: reactDoctor,
        file_checks: fileChecks,
        osv_skipped: osvSkipped,
        osv_skip_reason: osvSkipReason,
      }

      const issues = await analyzeToolOutputs(toolOutputs)
      const scores = calculateScores(issues)

      logger.log('analysis_complete', {
        scanId,
        issuesCount: issues.length,
        scores,
      })

      // ── Step 9: Write to Supabase ─────────────────────────────────────────
      const criticalCount = issues.filter(i => i.severity === 'critical').length
      const highCount     = issues.filter(i => i.severity === 'high').length
      const mediumCount   = issues.filter(i => i.severity === 'medium').length
      const lowCount      = issues.filter(i => i.severity === 'low').length

      const { error: updateError } = await supabase
        .from('scans')
        .update({
          status: 'complete',
          overall_score: scores.overall,
          security_score: scores.security,
          scalability_score: scores.scalability,
          monetization_score: scores.monetization,
          distribution_score: scores.distribution,
          critical_count: criticalCount,
          high_count: highCount,
          medium_count: mediumCount,
          low_count: lowCount,
          completed_at: new Date().toISOString(),
        })
        .eq('id', scanId)

      if (updateError) {
        throw new Error(`Failed to update scan record: ${updateError.message}`)
      }

      if (issues.length > 0) {
        const issuesToInsert = issues.map(issue => ({
          scan_id: scanId,
          guard: issue.guard,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          file: issue.file_path ?? null,
          line: issue.line_number ?? null,
          fix: issue.fix_suggestion,
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

      // Mark scan as failed in Supabase
      await supabase
        .from('scans')
        .update({ status: 'failed' })
        .eq('id', scanId)

      throw error
    } finally {
      // Always clean up the cloned repo
      if (cloneDir) {
        await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  },
})
