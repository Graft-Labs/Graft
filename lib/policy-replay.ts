export interface PolicyReplayInput {
  scanId: string
  framework: string
  findings: {
    severity: 'critical' | 'high' | 'medium' | 'low'
    guard: string
    category?: string
    title: string
  }[]
}

export interface PolicyReplayDecision {
  id: string
  policy: string
  result: 'pass' | 'warn' | 'fail'
  reason: string
}

export interface PolicyReplayReport {
  scanId: string
  summary: {
    pass: number
    warn: number
    fail: number
  }
  decisions: PolicyReplayDecision[]
}

function hasSeverity(findings: PolicyReplayInput['findings'], severity: 'critical' | 'high' | 'medium' | 'low'): boolean {
  return findings.some((f) => f.severity === severity)
}

function hasGuard(findings: PolicyReplayInput['findings'], guard: string): boolean {
  return findings.some((f) => f.guard === guard)
}

export function runPolicyReplay(input: PolicyReplayInput): PolicyReplayReport {
  const decisions: PolicyReplayDecision[] = []

  const criticalSecurity = input.findings.filter((f) => f.guard === 'security' && f.severity === 'critical').length
  decisions.push({
    id: 'security-critical-budget',
    policy: 'No critical security findings allowed',
    result: criticalSecurity > 0 ? 'fail' : 'pass',
    reason: criticalSecurity > 0
      ? `Found ${criticalSecurity} critical security issue(s).`
      : 'No critical security issues detected.',
  })

  const hasHighMonetization = input.findings.some((f) => f.guard === 'monetization' && (f.severity === 'high' || f.severity === 'critical'))
  decisions.push({
    id: 'monetization-readiness',
    policy: 'Monetization guard should have no high/critical blockers',
    result: hasHighMonetization ? 'warn' : 'pass',
    reason: hasHighMonetization
      ? 'Monetization has high/critical blockers that may impact go-live.'
      : 'No high/critical monetization blockers.',
  })

  const hasDistributionGaps = hasGuard(input.findings, 'distribution') && (hasSeverity(input.findings, 'high') || hasSeverity(input.findings, 'critical'))
  decisions.push({
    id: 'distribution-launch-hygiene',
    policy: 'Distribution high/critical issues should be addressed pre-launch',
    result: hasDistributionGaps ? 'warn' : 'pass',
    reason: hasDistributionGaps
      ? 'High/critical distribution issues detected (SEO/legal/analytics readiness).'
      : 'No high/critical distribution blockers detected.',
  })

  const summary = {
    pass: decisions.filter((d) => d.result === 'pass').length,
    warn: decisions.filter((d) => d.result === 'warn').length,
    fail: decisions.filter((d) => d.result === 'fail').length,
  }

  return {
    scanId: input.scanId,
    summary,
    decisions,
  }
}
