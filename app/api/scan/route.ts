import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@/lib/supabase-server'

interface ScanPayload {
  repo: string
  branch?: string
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
    const { repo, branch = 'main' } = body

    logScan('payload_received', {
      traceId,
      userId: user.id,
      repo,
      branch,
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

    // Detect privacy by calling GitHub API — don't assume based on URL shape
    let isPrivate = false
    let githubToken: string | null = session?.provider_token ?? null

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
        user_id: user.id,
        repo: repoUrl,
        branch: branch,
        status: 'pending',
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

    const githubPat = process.env.GITHUB_PAT
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const githubOwner = process.env.GITHUB_OWNER
    const githubRepo = process.env.GITHUB_REPO
    const webhookSecret = process.env.WEBHOOK_SECRET

    if (!githubPat || !appUrl || !githubOwner || !githubRepo || !webhookSecret) {
      console.error('Missing required env vars for scan dispatch')
      logScan('env_missing', {
        traceId,
        hasGithubPat: Boolean(githubPat),
        hasAppUrl: Boolean(appUrl),
        hasGithubOwner: Boolean(githubOwner),
        hasGithubRepo: Boolean(githubRepo),
        hasWebhookSecret: Boolean(webhookSecret),
      })
      return NextResponse.json(
        {
          error: 'server_config_error',
          message: 'Missing required env vars (GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO, WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL)',
        },
        { status: 500 }
      )
    }

    const dispatchResponse = await fetch(
      `https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows/scan.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            scan_id: String(scan.id),
            repo: `${repoOwner}/${repoName}`,
            branch: branch,
            github_token: githubToken || '',
            webhook_url: `${appUrl}/api/scan/${scan.id}/results`,
            webhook_secret: webhookSecret,
          },
        }),
      }
    )

    if (!dispatchResponse.ok) {
      const errorText = await dispatchResponse.text()
      console.error('GitHub dispatch failed:', errorText)
      logScan('dispatch_failed', {
        traceId,
        status: dispatchResponse.status,
        details: errorText,
      })

      await supabase
        .from('scans')
        .update({ status: 'failed' })
        .eq('id', scan.id)

      return NextResponse.json(
        {
          error: 'dispatch_error',
          message: 'Failed to trigger scan workflow',
          details: errorText,
          status_code: dispatchResponse.status,
        },
        { status: 500 }
      )
    }

    logScan('dispatch_success', { traceId, scanId: scan.id })

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
