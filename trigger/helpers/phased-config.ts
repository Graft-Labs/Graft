import { createHash } from 'node:crypto'

export type ScanPhase = 'osint' | 'dast'

export interface PhaseToggleMap {
  osint: boolean
  dast: boolean
}

const ENV_TRUE = new Set(['1', 'true', 'yes', 'on'])

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return defaultValue
  return ENV_TRUE.has(raw.trim().toLowerCase())
}

export function getPhaseToggles(): PhaseToggleMap {
  return {
    osint: readBool('SHIPGUARD_PHASE_OSINT', false),
    dast: readBool('SHIPGUARD_PHASE_DAST', true),
  }
}

export function stableDomainFromRepoUrl(repoUrl: string): string {
  const cleaned = repoUrl.trim().replace(/\.git$/, '')
  const hash = createHash('sha256').update(cleaned).digest('hex').slice(0, 12)
  return `scan-${hash}.example.invalid`
}

export function inferCandidateDomains(repoOwner: string, repoName: string, repoUrl: string): string[] {
  const owner = repoOwner.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const name = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const stable = stableDomainFromRepoUrl(repoUrl)
  return [
    `${name}.vercel.app`,
    `${name}.netlify.app`,
    `${owner}-${name}.vercel.app`,
    stable,
  ]
}
