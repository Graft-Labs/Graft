import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Step name → friendly label mapping (mirrors logger.log() calls in trigger/run-scan.ts)
const STEP_LABELS: Record<string, string> = {
  scan_started:         'Connecting to repository…',
  cloning_repo:         'Cloning repository…',
  clone_complete:       'Repository cloned',
  lockfile_detected:    'Detecting package manager…',
  running_trufflehog:   'Scanning for exposed secrets…',
  trufflehog_done:      'Secret scan complete',
  running_osv:          'Checking for known CVEs…',
  osv_done:             'Dependency audit complete',
  osv_skipped:          'Dependency audit skipped (no lockfile)',
  running_semgrep:      'Running static analysis…',
  semgrep_done:         'Static analysis complete',
  running_react_doctor: 'Checking React/Next.js patterns…',
  react_doctor_done:    'Framework analysis complete',
  running_file_checks:  'Checking production files…',
  file_checks_done:     'File checks complete',
  analysis_complete:    'Calculating scores…',
  scan_complete:        'Scan complete!',
}

// Ordered list of step keys — determines progress %
const STEP_ORDER = Object.keys(STEP_LABELS)

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: scanId } = await params

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Fetch scan (validate ownership + get trigger_run_id and status)
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .select('id, status, trigger_run_id')
      .eq('id', scanId)
      .eq('user_id', user.id)
      .single()

    if (scanError || !scan) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // If the scan is already done or failed, return terminal state immediately
    if (scan.status === 'complete' || scan.status === 'failed') {
      return NextResponse.json({
        overallStatus: scan.status,
        percent: scan.status === 'complete' ? 100 : 0,
        steps: STEP_ORDER.map(key => ({
          key,
          label: STEP_LABELS[key],
          status: scan.status === 'complete' ? 'done' : 'pending',
        })),
        currentStep: scan.status === 'complete' ? 'scan_complete' : null,
      })
    }

    // Auto-fail stale queued/pending scans (worker not dequeuing / expired run)
    const createdAtRes = await supabase
      .from('scans')
      .select('created_at')
      .eq('id', scanId)
      .single()

    const createdAt = createdAtRes.data?.created_at ? new Date(createdAtRes.data.created_at).getTime() : null
    const ageMs = createdAt ? Date.now() - createdAt : 0
    const staleThresholdMs = 10 * 60 * 1000

    if ((scan.status === 'pending' || scan.status === 'scanning') && ageMs > staleThresholdMs) {
      await supabase
        .from('scans')
        .update({ status: 'failed' })
        .eq('id', scanId)

      return NextResponse.json({
        overallStatus: 'failed',
        percent: 0,
        steps: STEP_ORDER.map(key => ({ key, label: STEP_LABELS[key], status: 'pending' })),
        currentStep: null,
        message: 'Scan timed out in queue. Please retry and ensure Trigger worker is running.',
      })
    }

    // If no trigger_run_id yet (very early in the lifecycle), return pending
    if (!scan.trigger_run_id) {
      return NextResponse.json({
        overallStatus: 'pending',
        percent: 0,
        steps: STEP_ORDER.map(key => ({ key, label: STEP_LABELS[key], status: 'pending' })),
        currentStep: null,
      })
    }

    // Avoid remote Trigger API lookups on every poll (they add 1-2s latency).
    // Derive an approximate step from local scan status + age.
    const elapsedSec = Math.max(0, Math.floor(ageMs / 1000))
    let currentStepIndex = 0

    if (scan.status === 'pending') {
      currentStepIndex = STEP_ORDER.indexOf('scan_started')
    } else {
      // scanning: advance through a timed progression curve
      if (elapsedSec < 15) currentStepIndex = STEP_ORDER.indexOf('cloning_repo')
      else if (elapsedSec < 35) currentStepIndex = STEP_ORDER.indexOf('running_trufflehog')
      else if (elapsedSec < 55) currentStepIndex = STEP_ORDER.indexOf('running_osv')
      else if (elapsedSec < 90) currentStepIndex = STEP_ORDER.indexOf('running_semgrep')
      else if (elapsedSec < 120) currentStepIndex = STEP_ORDER.indexOf('running_react_doctor')
      else if (elapsedSec < 150) currentStepIndex = STEP_ORDER.indexOf('running_file_checks')
      else currentStepIndex = STEP_ORDER.indexOf('analysis_complete')
    }

    if (currentStepIndex < 0) currentStepIndex = 0

    const percent = Math.round(((currentStepIndex + 1) / STEP_ORDER.length) * 100)
    const currentStep = STEP_ORDER[currentStepIndex]

    return NextResponse.json({
      overallStatus: scan.status,
      percent,
      currentStep,
      steps: STEP_ORDER.map((key, i) => ({
        key,
        label: STEP_LABELS[key],
        status: i < currentStepIndex ? 'done' : i === currentStepIndex ? 'active' : 'pending',
      })),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message: msg }, { status: 500 })
  }
}
