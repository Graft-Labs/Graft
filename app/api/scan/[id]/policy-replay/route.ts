import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { runPolicyReplay } from '@/lib/policy-replay'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanId } = await params
    const supabase = await createServerClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .select('id, user_id, framework')
      .eq('id', scanId)
      .single()

    if (scanError || !scan) {
      return NextResponse.json({ error: 'scan_not_found' }, { status: 404 })
    }

    if (scan.user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { data: issues, error: issuesError } = await supabase
      .from('issues')
      .select('guard, category, severity, title, description')
      .eq('scan_id', scanId)

    if (issuesError) {
      return NextResponse.json({ error: 'issues_fetch_failed' }, { status: 500 })
    }

    const report = runPolicyReplay({
      scanId,
      framework: scan.framework ?? 'unknown',
      findings: (issues ?? []).map((issue) => ({
        severity: issue.severity,
        guard: issue.guard,
        title: issue.title,
        category: issue.category,
      })),
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('[policy-replay] failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
