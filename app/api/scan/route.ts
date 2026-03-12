import { NextRequest, NextResponse } from 'next/server'
import { getUserSession } from '@/lib/supabase-server'

interface ScanPayload {
  repo: string
  branch?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUserSession()

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Please log in to start a scan' },
        { status: 401 }
      )
    }

    const body: ScanPayload = await request.json()
    const { repo, branch = 'main' } = body

    if (!repo) {
      return NextResponse.json(
        { error: 'invalid_input', message: 'Repository URL is required' },
        { status: 400 }
      )
    }

    const repoUrl = repo.replace(/\.git$/, '')
    const repoParts = repoUrl.split('/')
    const repoOwner = repoParts[repoParts.length - 2]
    const repoName = repoParts[repoParts.length - 1]

    const isPrivate = repoUrl.includes('github.com') && !repoUrl.includes('github.com/' + repoOwner + '/' + repoName + '/tree/')

    let githubToken: string | null = null

    if (session.provider_token) {
      githubToken = session.provider_token
    } else if (isPrivate) {
      const supabaseAccessToken = session.access_token
      const { data: identityData } = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user/${session.user.id}/identities`,
        {
          headers: {
            Authorization: `Bearer ${supabaseAccessToken}`,
            Apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          },
        }
      ).then(res => res.json())

      const githubIdentity = identityData?.identities?.find(
        (id: { provider: string }) => id.provider === 'github'
      )

      if (githubIdentity?.provider_token) {
        githubToken = githubIdentity.provider_token
      }
    }

    if (isPrivate && !githubToken) {
      return NextResponse.json(
        {
          error: 'github_not_connected',
          message: 'Private repos require GitHub connection. Please connect your GitHub account in Settings.',
        },
        { status: 400 }
      )
    }

    const supabase = await (await import('@/lib/supabase-server')).createServerClient()
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        user_id: session.user.id,
        repo_url: repoUrl,
        branch: branch,
        status: 'pending',
      })
      .select()
      .single()

    if (scanError) {
      console.error('Failed to create scan:', scanError)
      return NextResponse.json(
        { error: 'database_error', message: 'Failed to create scan record' },
        { status: 500 }
      )
    }

    const githubPat = process.env.GITHUB_PAT
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    if (!githubPat || !appUrl) {
      console.error('Missing GITHUB_PAT or NEXT_PUBLIC_APP_URL')
      return NextResponse.json(
        { error: 'server_config_error', message: 'Server not configured properly' },
        { status: 500 }
      )
    }

    const dispatchResponse = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_OWNER || 'hanishsuri'}/${process.env.GITHUB_REPO || 'ShipGuard-AI'}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: 'run-scan',
          client_payload: {
            scan_id: scan.id,
            repo: `${repoOwner}/${repoName}`,
            branch: branch,
            github_token: githubToken,
            webhook_url: `${appUrl}/api/scan/${scan.id}/results`,
            webhook_secret: process.env.WEBHOOK_SECRET,
          },
        }),
      }
    )

    if (!dispatchResponse.ok) {
      const errorText = await dispatchResponse.text()
      console.error('GitHub dispatch failed:', errorText)

      await supabase
        .from('scans')
        .update({ status: 'failed', error_message: 'Failed to trigger scan workflow' })
        .eq('id', scan.id)

      return NextResponse.json(
        { error: 'dispatch_error', message: 'Failed to trigger scan workflow' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      scan_id: scan.id,
      status: 'pending',
      repo: repoUrl,
    })
  } catch (error) {
    console.error('Scan API error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
