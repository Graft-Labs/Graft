import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const { owner, repo } = await params

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.provider_token

    if (!token) {
      return NextResponse.json({ error: 'github_not_connected' }, { status: 400 })
    }

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'github_api_error', status: res.status }, { status: 502 })
    }

    const data: Array<{ name: string; protected: boolean }> = await res.json()

    return NextResponse.json({
      branches: data.map(b => ({ name: b.name, protected: b.protected })),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message: msg }, { status: 500 })
  }
}
