import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@/lib/supabase-server'
import { tasks } from '@trigger.dev/sdk/v3'
import type { runScanTask } from '@/trigger/run-scan'

interface ScanPayload {
  repo: string
  branch?: string
  framework?: string
}

function logScan(stage: string, meta: Record<string, unknown>) {
  console.log(`[scan-api] ${stage}`, meta)
}

export async function POST(request: NextRequest) {
  const traceId = randomUUID()

  try {
    logScan('start', { traceId })

    // Use getUser() (secure — verifies JWT with Supabase server) instead of getSession()
    const supabase = await createServerClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      logScan('unauthorized', { traceId })
      return NextResponse.json(
        { error: 'unauthorized', message: 'Please log in to start a scan' },
        { status: 401 }
      )
    }

    // Get session separately only to read provider_token (not for auth)
    const { data: { session } } = await supabase.auth.getSession()

    const body: ScanPayload = await request.json()
    const { repo, branch = 'main', framework } = body

    logScan('payload_received', {
      traceId,
      userId: user.id,
      repo,
      branch,
      framework,
    })

    if (!repo) {
      logScan('invalid_input', { traceId })
      return NextResponse.json(
        { error: 'invalid_input', message: 'Repository URL is required' },
        { status: 400 }
      )
    }

    const repoUrl = repo.replace(/\.git$/, '')
    const repoParts = repoUrl.split('/')
    const repoOwner = repoParts[repoParts.length - 2]
    const repoName = repoParts[repoParts.length - 1]

    // Resolve GitHub token: prefer the live provider_token from the current session,
    // fall back to the persisted token in the users table (survives session refresh).
    let isPrivate = false
    let githubToken: string | null = session?.provider_token ?? null

    if (githubToken) {
      // Persist the fresh token so future requests can use it
      await supabase
        .from('users')
        .update({ github_token: githubToken })
        .eq('id', user.id)
    } else {
      // Fall back to the persisted token
      const { data: userRow } = await supabase
        .from('users')
        .select('github_token')
        .eq('id', user.id)
        .single()
      githubToken = userRow?.github_token ?? null
    }

    const repoCheckRes = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
        },
      }
    )

    if (repoCheckRes.ok) {
      const repoData = await repoCheckRes.json()
      isPrivate = repoData.private === true
    } else if (repoCheckRes.status === 404) {
      // Repo not accessible without a token — treat as private
      isPrivate = true
    }
    // If GitHub API is unreachable, default isPrivate=false and let the scan proceed

    logScan('repo_parsed', { traceId, repoOwner, repoName, isPrivate })

    if (isPrivate && !githubToken) {
      logScan('private_repo_without_token', { traceId })
      return NextResponse.json(
        {
          error: 'github_not_connected',
          message: 'Private repos require GitHub connection. Please connect your GitHub account in Settings.',
        },
        { status: 400 }
      )
    }

    // ── Rate limiting ────────────────────────────────────────────────────────
    // First, auto-expire any pending/scanning rows older than 15 minutes —
    // these are stale rows the task never cleaned up (e.g. Trigger.dev run
    // expired, crashed before our catch block, etc.)
    const staleWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    await supabase
      .from('scans')
      .update({ status: 'failed' })
      .eq('user_id', user.id)
      .in('status', ['pending', 'scanning'])
      .lt('created_at', staleWindow)

    // Max 3 concurrent scans (pending/scanning) in the last 15 minutes
    const activeWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count: activeCount } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['pending', 'scanning'])
      .gte('created_at', activeWindow)

    if ((activeCount ?? 0) >= 3) {
      logScan('rate_limit_concurrent', { traceId, userId: user.id, activeCount })
      return NextResponse.json(
        { error: 'rate_limited', message: 'You already have 3 scans in progress. Please wait for them to complete.' },
        { status: 429 }
      )
    }

    // Daily scan limit disabled for testing
    // ─────────────────────────────────────────────────────────────────────────

    const userName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null
    const userAvatar =
      (user.user_metadata?.avatar_url as string | undefined) || null

    const { error: userUpsertError } = await supabase
      .from('users')
      .upsert(
        {
          id: user.id,
          email: user.email,
          name: userName,
          avatar_url: userAvatar,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )

    if (userUpsertError) {
      console.error('Failed to upsert user record:', userUpsertError)
      logScan('user_upsert_failed', { traceId, error: userUpsertError.message })
      return NextResponse.json(
        {
          error: 'user_sync_error',
          message: 'Failed to sync user profile before scan',
          details: userUpsertError.message,
        },
        { status: 500 }
      )
    }

    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        user_id:   user.id,
        repo:      repoUrl,
        branch:    branch,
        framework: framework ?? null,
        status:    'pending',
      })
      .select()
      .single()

    if (scanError) {
      console.error('Failed to create scan:', scanError)
      logScan('scan_insert_failed', { traceId, error: scanError.message })
      return NextResponse.json(
        {
          error: 'database_error',
          message: 'Failed to create scan record',
          details: scanError.message,
        },
        { status: 500 }
      )
    }

    // Trigger the scan task via Trigger.dev (no GitHub Actions, no webhooks)
    // Don't forward "unknown" framework — let the task auto-detect from package.json
    const handle = await tasks.trigger<typeof runScanTask>('run-scan', {
      scanId:       scan.id,
      repoOwner,
      repoName,
      branch,
      framework:    (framework && framework !== 'unknown') ? framework : undefined,
      githubToken:  githubToken ?? undefined,
      triggerRunId: undefined, // will be updated by the task itself using context.run.id
    })

    // Store the Trigger.dev run ID so the progress API can retrieve real-time status
    await supabase
      .from('scans')
      .update({ trigger_run_id: handle.id })
      .eq('id', scan.id)

    logScan('trigger_success', { traceId, scanId: scan.id, triggerId: handle.id })

    return NextResponse.json({
      scan_id: scan.id,
      status: 'pending',
      repo: repoUrl,
      trace_id: traceId,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error')
    console.error('Scan API error:', err)
    logScan('unhandled_exception', {
      traceId,
      message: err.message,
      stack: err.stack,
    })

    return NextResponse.json(
      {
        error: 'internal_error',
        message: 'An unexpected error occurred',
        details: err.message,
        trace_id: traceId,
      },
      { status: 500 }
    )
  }
}
