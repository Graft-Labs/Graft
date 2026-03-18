import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeToolOutputs, calculateScores, ToolOutputs } from '@/lib/ai/analyzer'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: scanId } = await params

    const webhookSecret = request.headers.get('x-webhook-secret')
    if (!webhookSecret || webhookSecret !== process.env.WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Invalid webhook secret' },
        { status: 401 }
      )
    }

    const body: ToolOutputs = await request.json()
    console.log('[scan-results] payload_received', {
      scanId,
      hasGitleaks:    Boolean(body.gitleaks_fs),
      hasOSV:         Boolean(body.osv),
      hasSemgrep:     Boolean(body.semgrep),
      hasGrepChecks:  Boolean(body.grep_checks),
      osvSkipped:     body.osv_skipped,
    })

    if (!body.scan_id || body.scan_id !== scanId) {
      return NextResponse.json(
        { error: 'invalid_scan_id', message: 'Scan ID mismatch' },
        { status: 400 }
      )
    }

    const secretKey = process.env.SUPABASE_SECRET_KEY
    if (!secretKey) {
      return NextResponse.json(
        { error: 'server_config_error', message: 'SUPABASE_SECRET_KEY is not configured' },
        { status: 500 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      secretKey
    )

    const { data: scan, error: scanFetchError } = await supabase
      .from('scans')
      .select('*')
      .eq('id', scanId)
      .single()

    if (scanFetchError || !scan) {
      return NextResponse.json(
        { error: 'not_found', message: 'Scan not found' },
        { status: 404 }
      )
    }

    const issues = await analyzeToolOutputs(body)
    console.log('[scan-results] issues_analyzed', {
      scanId,
      issuesCount: issues.length,
    })

    const scores = calculateScores(issues)
    console.log('[scan-results] scores_calculated', {
      scanId,
      scores,
    })

    const criticalCount = issues.filter(i => i.severity === 'critical').length
    const highCount = issues.filter(i => i.severity === 'high').length
    const mediumCount = issues.filter(i => i.severity === 'medium').length
    const lowCount = issues.filter(i => i.severity === 'low').length

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
      console.error('Failed to update scan:', updateError)
      return NextResponse.json(
        { error: 'update_error', message: 'Failed to update scan' },
        { status: 500 }
      )
    }

    const issuesToInsert = issues.map(issue => ({
      scan_id: scanId,
      guard: issue.guard,
      category: issue.category,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      file: issue.file_path || null,
      line: issue.line_number || null,
      fix: issue.fix_suggestion,
    }))

    if (issuesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('issues')
        .insert(issuesToInsert)

      if (insertError) {
        console.error('Failed to insert issues:', insertError)
      } else {
        console.log('[scan-results] issues_inserted', {
          scanId,
          inserted: issuesToInsert.length,
        })
      }
    }

    console.log('[scan-results] completed', { scanId })

    return NextResponse.json({
      success: true,
      scan_id: scanId,
      scores,
      issues_count: issues.length,
      osv_skipped: body.osv_skipped,
      osv_skip_reason: body.osv_skip_reason,
    })
  } catch (error) {
    console.error('Scan results webhook error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
