import { readFile, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface StackInfo {
  framework:    string                // primary JS/TS framework
  languages:    string[]              // all detected languages
  hasBackend:   boolean               // has a separate backend
  backendLangs: string[]             // e.g. ['go', 'python']
  isPolyglot:   boolean               // Next.js + Go/Python in same repo
  isMonorepo:   boolean
  runtime:      'edge' | 'node' | 'unknown'
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function readJsonSafe(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch { return null }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises')
    const s = await stat(path)
    return s.isDirectory()
  } catch { return false }
}

export async function detectStack(cloneDir: string): Promise<StackInfo> {
  const languages: string[]     = []
  const backendLangs: string[]  = []

  // ── JS/TS framework detection ──────────────────────────────────────────────
  const pkgJson = await readJsonSafe(join(cloneDir, 'package.json'))
  let framework = 'unknown'
  let runtime: StackInfo['runtime'] = 'unknown'

  if (pkgJson) {
    languages.push('typescript') // assume TS for JS projects — close enough

    const deps = {
      ...((pkgJson.dependencies as Record<string, unknown>)    ?? {}),
      ...((pkgJson.devDependencies as Record<string, unknown>) ?? {}),
    }
    const has = (pkg: string) => pkg in deps

    if (has('next')) {
      framework = 'nextjs'
      // Detect edge vs node runtime
      const nextConfig =
        (await readFileSafe(join(cloneDir, 'next.config.ts')))  ||
        (await readFileSafe(join(cloneDir, 'next.config.js')))  ||
        (await readFileSafe(join(cloneDir, 'next.config.mjs'))) || ''
      runtime = nextConfig.includes('edge') ? 'edge' : 'node'
    } else if (has('@sveltejs/kit'))                         { framework = 'sveltekit'; runtime = 'node' }
    else if (has('nuxt') || has('@nuxt/core'))               { framework = 'nuxt';     runtime = 'node' }
    else if (has('react') && (has('vite') || has('@vitejs/plugin-react'))) {
      framework = 'react-vite'; runtime = 'node'
    }
    else if (has('@nestjs/core'))                            { framework = 'nestjs';   runtime = 'node' }
    else if (has('fastify'))                                 { framework = 'fastify';  runtime = 'node' }
    else if (has('express'))                                 { framework = 'express';  runtime = 'node' }
    else if (has('react'))                                   { framework = 'react';    runtime = 'node' }
  }

  // ── Polyglot backend detection ─────────────────────────────────────────────

  // Go
  if (
    (await fileExists(join(cloneDir, 'go.mod'))) ||
    (await fileExists(join(cloneDir, 'main.go')))
  ) {
    languages.push('go')
    backendLangs.push('go')
  }

  // Python
  if (
    (await fileExists(join(cloneDir, 'requirements.txt'))) ||
    (await fileExists(join(cloneDir, 'pyproject.toml')))   ||
    (await fileExists(join(cloneDir, 'Pipfile')))          ||
    (await fileExists(join(cloneDir, 'setup.py')))
  ) {
    languages.push('python')
    backendLangs.push('python')
  }

  // Ruby
  if (await fileExists(join(cloneDir, 'Gemfile'))) {
    languages.push('ruby')
    backendLangs.push('ruby')
  }

  // Rust
  if (await fileExists(join(cloneDir, 'Cargo.toml'))) {
    languages.push('rust')
    backendLangs.push('rust')
  }

  // Java / Kotlin
  if (
    (await fileExists(join(cloneDir, 'pom.xml'))) ||
    (await fileExists(join(cloneDir, 'build.gradle')))
  ) {
    const lang = (await fileExists(join(cloneDir, 'build.gradle'))) ? 'kotlin' : 'java'
    languages.push(lang)
    backendLangs.push(lang)
  }

  // ── Monorepo detection ─────────────────────────────────────────────────────
  const isMonorepo =
    (await fileExists(join(cloneDir, 'pnpm-workspace.yaml')))  ||
    (await fileExists(join(cloneDir, 'lerna.json')))           ||
    (await fileExists(join(cloneDir, 'nx.json')))              ||
    (pkgJson !== null && Array.isArray((pkgJson as Record<string, unknown>).workspaces))

  // ── App Router vs Pages Router (mixed) ────────────────────────────────────
  // Used by vibe-leak-detector — just surfaced here as part of stack info
  const hasAppDir   = await dirExists(join(cloneDir, 'app'))
  const hasPagesDir = await dirExists(join(cloneDir, 'pages'))

  // If both app/ and pages/ exist with actual route files → mixed routing
  // (just store in framework string for now, vibe-leak-detector checks this independently)

  return {
    framework,
    languages:    languages.length > 0 ? [...new Set(languages)] : ['typescript'],
    hasBackend:   backendLangs.length > 0,
    backendLangs: [...new Set(backendLangs)],
    isPolyglot:   backendLangs.length > 0 && pkgJson !== null,
    isMonorepo:   Boolean(isMonorepo),
    runtime,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function readFileSafe(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}
