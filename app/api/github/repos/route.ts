import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  description: string | null
  language: string | null
  updated_at: string
  pushed_at: string
  default_branch: string
}

interface GitHubOrg {
  login: string
  avatar_url: string
}

interface NamespaceGroup {
  namespace: string
  avatar: string
  repos: Array<{
    id: number
    name: string
    full_name: string
    private: boolean
    description: string | null
    language: string | null
    updated_at: string
    default_branch: string
  }>
}

async function fetchGitHub(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${url}`)
  return res.json()
}

// Returns null on 403 (missing scope) instead of throwing
async function fetchGitHubSafe<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (res.status === 403 || res.status === 401) return null
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: { session } } = await supabase.auth.getSession()
    let token: string | null = session?.provider_token ?? null

    if (token) {
      await supabase
        .from('users')
        .update({ github_token: token })
        .eq('id', user.id)
    } else {
      const { data: userRow } = await supabase
        .from('users')
        .select('github_token')
        .eq('id', user.id)
        .maybeSingle()
      token = userRow?.github_token ?? null
    }

    if (!token) {
      return NextResponse.json({ error: 'github_not_connected', message: 'GitHub is not connected yet. Go to Settings → Integrations and connect GitHub.' }, { status: 400 })
    }

    // Fetch user profile + personal repos in parallel; orgs may 403 if read:org scope is missing
    const [userProfile, personalRepos, orgsOrNull]: [
      { login: string; avatar_url: string },
      GitHubRepo[],
      GitHubOrg[] | null
    ] = await Promise.all([
      fetchGitHub('https://api.github.com/user', token),
      fetchGitHub('https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner', token),
      fetchGitHubSafe<GitHubOrg[]>('https://api.github.com/user/orgs?per_page=100', token),
    ])

    // null means token is missing read:org scope — surface a reauth hint to the frontend
    const needsReauth = orgsOrNull === null
    const orgs: GitHubOrg[] = orgsOrNull ?? []

    // Fetch org repos in parallel (up to 5 orgs to avoid rate limits)
    const orgRepoGroups = await Promise.all(
      orgs.slice(0, 5).map(async (org: GitHubOrg) => {
        try {
          const repos: GitHubRepo[] = await fetchGitHub(
            `https://api.github.com/orgs/${org.login}/repos?sort=pushed&per_page=100`,
            token
          )
          return { org, repos }
        } catch {
          return { org, repos: [] as GitHubRepo[] }
        }
      })
    )

    const mapRepo = (r: GitHubRepo) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      description: r.description,
      language: r.language,
      updated_at: r.pushed_at ?? r.updated_at,
      default_branch: r.default_branch ?? 'main',
    })

    const result: NamespaceGroup[] = [
      {
        namespace: userProfile.login,
        avatar: userProfile.avatar_url,
        repos: personalRepos.map(mapRepo),
      },
      ...orgRepoGroups.map(({ org, repos }) => ({
        namespace: org.login,
        avatar: org.avatar_url,
        repos: repos.map(mapRepo),
      })),
    ]

    return NextResponse.json({ namespaces: result, needs_reauth: needsReauth })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const unauth = msg.includes('GitHub API error 401') || msg.includes('GitHub API error 403')
    if (unauth) {
      return NextResponse.json({ error: 'github_not_connected', message: 'GitHub is not connected yet. Go to Settings → Integrations and connect GitHub.' }, { status: 400 })
    }
    return NextResponse.json({ error: 'internal_error', message: msg }, { status: 500 })
  }
}
