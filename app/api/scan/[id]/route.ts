import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
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

    if (!body.scan_id || body.scan_id !== scanId) {
      return NextResponse.json(
        { error: 'invalid_scan_id', message: 'Scan ID mismatch' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient()

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

    const scores = calculateScores(issues)

    const criticalCount = issues.filter(i => i.severity === 'critical').length
    const highCount = issues.filter(i => i.severity === 'high').length
    const mediumCount = issues.filter(i => i.severity === 'medium').length
    const lowCount = issues.filter(i => i.severity === 'low').length

    const { error: updateError } = await supabase
      .from('scans')
      .update({
        status: 'completed',
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
        raw_results: body,
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
      fix_suggestion: issue.fix_suggestion,
      code_snippet: issue.code_snippet || null,
      file_path: issue.file_path || null,
      line_number: issue.line_number || null,
    }))

    if (issuesToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('issues')
        .insert(issuesToInsert)

      if (insertError) {
        console.error('Failed to insert issues:', insertError)
      }
    }

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
