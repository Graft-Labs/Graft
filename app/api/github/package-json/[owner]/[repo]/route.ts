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

    // Resolve token: live session first, then DB fallback
    const { data: { session } } = await supabase.auth.getSession()
    let token: string | null = session?.provider_token ?? null
    if (!token) {
      const { data: userRow } = await supabase
        .from('users')
        .select('github_token')
        .eq('id', user.id)
        .single()
      token = userRow?.github_token ?? null
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/package.json`,
      { headers }
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'not_found' }, { status: res.status })
    }

    const text = await res.text()
    return NextResponse.json({ content: text })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message: msg }, { status: 500 })
  }
}
