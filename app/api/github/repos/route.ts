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

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.provider_token

    if (!token) {
      return NextResponse.json({ error: 'github_not_connected', message: 'Connect your GitHub account in Settings to use the repo picker.' }, { status: 400 })
    }

    // Fetch user profile + personal repos in parallel
    const [userProfile, personalRepos, orgs]: [
      { login: string; avatar_url: string },
      GitHubRepo[],
      GitHubOrg[]
    ] = await Promise.all([
      fetchGitHub('https://api.github.com/user', token),
      fetchGitHub('https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner', token),
      fetchGitHub('https://api.github.com/user/orgs?per_page=100', token),
    ])

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

    return NextResponse.json({ namespaces: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'internal_error', message: msg }, { status: 500 })
  }
}
