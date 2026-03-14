"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Github,
  ChevronLeft,
  ArrowRight,
  Shield,
  Zap,
  DollarSign,
  Globe,
  CheckCircle,
  Lock,
  X,
  AlertTriangle,
  Search,
  ChevronDown,
  GitBranch,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import { createClient } from "@/lib/supabase";

// ─── Framework options ────────────────────────────────────────────────────────

const FRAMEWORK_OPTIONS = [
  { value: "nextjs",     label: "Next.js" },
  { value: "react-vite", label: "React + Vite" },
  { value: "express",    label: "Node.js / Express" },
  { value: "nestjs",     label: "NestJS" },
  { value: "sveltekit",  label: "SvelteKit" },
  { value: "nuxt",       label: "Nuxt.js" },
  { value: "react",      label: "React (other)" },
  { value: "unknown",    label: "Other / Unknown" },
] as const

function detectFrameworkFromDeps(deps: Record<string, unknown>): string {
  const has = (pkg: string) => pkg in deps
  if (has("next"))                                           return "nextjs"
  if (has("@sveltejs/kit"))                                  return "sveltekit"
  if (has("nuxt") || has("@nuxt/core"))                      return "nuxt"
  if (has("react") && (has("vite") || has("@vitejs/plugin-react"))) return "react-vite"
  if (has("express"))                                        return "express"
  if (has("@nestjs/core"))                                   return "nestjs"
  if (has("react"))                                          return "react"
  return "unknown"
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
  default_branch: string;
}

interface Namespace {
  namespace: string;
  avatar: string;
  repos: Repo[];
}

interface ProgressStep {
  key: string;
  label: string;
  status: "pending" | "active" | "done";
}

// ─── Language color dots (like GitHub) ───────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  Java: "#b07219",
  "C#": "#178600",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  CSS: "#563d7c",
  HTML: "#e34c26",
  Vue: "#41b883",
};

// ─── Guards preview ───────────────────────────────────────────────────────────

const guards = [
  { key: "security", label: "Security", icon: Lock, color: "var(--guard-security)" },
  { key: "scalability", label: "Scalability", icon: Zap, color: "var(--guard-scale)" },
  { key: "monetization", label: "Monetization", icon: DollarSign, color: "var(--guard-monetize)" },
  { key: "distribution", label: "Distribution", icon: Globe, color: "var(--guard-distrib)" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewScanPage() {
  const router = useRouter();
  const supabase = createClient();

  // GitHub picker state
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [activeNamespace, setActiveNamespace] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("main");
  const [branchOpen, setBranchOpen] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Framework detection + selection
  const [framework, setFramework] = useState<string>("unknown");
  const [frameworkDetected, setFrameworkDetected] = useState(false);
  const [detectingFramework, setDetectingFramework] = useState(false);

  // Manual URL fallback
  const [manualUrl, setManualUrl] = useState("");
  const [useManual, setUseManual] = useState(false);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [percent, setPercent] = useState(0);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGithubBanner, setShowGithubBanner] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  // ── Load GitHub repos on mount ────────────────────────────────────────────

  useEffect(() => {
    async function initGithub() {
      const { data: { session } } = await supabase.auth.getSession();
      const connected = !!session?.provider_token;
      setGithubConnected(connected);

      if (!connected) return;

      setLoadingRepos(true);
      try {
        const res = await fetch("/api/github/repos");
        if (!res.ok) {
          const data = await res.json();
          if (data.error === "github_not_connected") {
            setGithubConnected(false);
          } else {
            setReposError(data.message ?? "Failed to load repos");
          }
          return;
        }
        const data = await res.json();
        setNamespaces(data.namespaces ?? []);
        if (data.needs_reauth) setNeedsReauth(true);
        if (data.namespaces?.length > 0) {
          setActiveNamespace(data.namespaces[0].namespace);
        }
      } catch {
        setReposError("Failed to load repositories. Check your connection.");
      } finally {
        setLoadingRepos(false);
      }
    }

    initGithub();
  }, [supabase]);

  // ── Close branch dropdown on outside click ─────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Fetch branches + detect framework when repo is selected ──────────────

  useEffect(() => {
    if (!selectedRepo) return;
    setSelectedBranch(selectedRepo.default_branch ?? "main");
    setBranches([]);
    setFramework("unknown");
    setFrameworkDetected(false);

    const [owner, repo] = selectedRepo.full_name.split("/");

    setLoadingBranches(true);
    fetch(`/api/github/branches/${owner}/${repo}`)
      .then(r => r.json())
      .then(data => {
        const branchNames: string[] = (data.branches ?? []).map((b: { name: string }) => b.name);
        setBranches(branchNames);
      })
      .catch(() => setBranches([selectedRepo.default_branch ?? "main"]))
      .finally(() => setLoadingBranches(false));

    // Detect framework from package.json via server proxy (supports private repos)
    setDetectingFramework(true);
    fetch(`/api/github/package-json/${owner}/${repo}`)
      .then(async r => {
        if (!r.ok) return;
        const data = await r.json();
        const text: string = data.content;
        try {
          const pkg = JSON.parse(text);
          const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
          const detected = detectFrameworkFromDeps(allDeps);
          setFramework(detected);
          setFrameworkDetected(true);
        } catch { /* ignore parse errors */ }
      })
      .catch(() => { /* network error — leave as unknown */ })
      .finally(() => setDetectingFramework(false));
  }, [selectedRepo]);

  // ── Poll progress once scanning ───────────────────────────────────────────

  const pollProgress = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/scan/${id}/progress`);
      if (!res.ok) return;
      const data = await res.json();

      setSteps(data.steps ?? []);
      setPercent(data.percent ?? 0);
      setCurrentStep(data.currentStep ?? null);

      if (data.overallStatus === "complete") {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        setTimeout(() => router.push(`/scan/${id}`), 1200);
      } else if (data.overallStatus === "failed") {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        setScanning(false);
        setError("Scan failed. Please try again.");
      }
    } catch {
      // ignore transient polling errors
    }
  }, [router]);

  useEffect(() => {
    if (scanId && scanning) {
      pollProgress(scanId);
      progressIntervalRef.current = setInterval(() => pollProgress(scanId), 2500);
    }
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [scanId, scanning, pollProgress]);

  // ── Trigger the scan ──────────────────────────────────────────────────────

  const handleScan = async () => {
    const repoUrl = useManual
      ? manualUrl.trim()
      : selectedRepo
      ? `https://github.com/${selectedRepo.full_name}`
      : "";

    if (!repoUrl) return;

    setScanning(true);
    setError(null);
    setShowGithubBanner(false);
    setPercent(0);
    setSteps([]);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoUrl,
          branch: selectedBranch,
          // Only send framework if it was actually detected — never send "unknown"
          // so the scan task always auto-detects from package.json
          ...(framework && framework !== 'unknown' ? { framework } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "github_not_connected") {
          setScanning(false);
          setShowGithubBanner(true);
          return;
        }
        throw new Error((data.message || "Failed to start scan") + (data.details ? ` (${data.details})` : ""));
      }

      setScanId(data.scan_id);
    } catch (err) {
      setScanning(false);
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  // ─── Derived ────────────────────────────────────────────────────────────────

  const activeNs = namespaces.find(n => n.namespace === activeNamespace);
  const filteredRepos = (activeNs?.repos ?? []).filter(r =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    (r.description ?? "").toLowerCase().includes(repoSearch.toLowerCase())
  );
  const canScan = useManual ? !!manualUrl.trim() : !!selectedRepo;

  // ─── GitHub banner ────────────────────────────────────────────────────────

  if (showGithubBanner) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.2)" }}>
                <Github size={28} style={{ color: "var(--guard-security)" }} />
              </div>
              <h2 className="text-2xl mb-2" style={{ fontFamily: "var(--font-ui)" }}>
                GitHub Connection Required
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontFamily: "var(--font-label)", marginBottom: 24 }}>
                Private repos require GitHub to be connected in Settings.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowGithubBanner(false)}
                  className="flex-1 py-3 rounded-xl font-medium text-sm"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-label)" }}>
                  Go Back
                </button>
                <Link href="/dashboard/settings"
                  className="flex-1 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2"
                  style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-label)" }}>
                  <Github size={15} />
                  Connect GitHub
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── Scanning view ────────────────────────────────────────────────────────

  if (scanning) {
    const displayRepo = useManual
      ? manualUrl
      : selectedRepo?.full_name ?? "your-app";

    const activeStepLabel = steps.find(s => s.status === "active")?.label
      ?? steps.find(s => s.key === currentStep)?.label
      ?? "Initializing…";

    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            {/* Animated icon */}
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center animate-pulse-accent"
                style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}>
                <Shield size={40} style={{ color: "var(--accent)" }} />
              </div>
              <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none" style={{ opacity: 0.5 }}>
                <div className="w-full h-0.5 animate-scan-line"
                  style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }} />
              </div>
            </div>

            <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-ui)" }}>
              Scanning your repository
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", fontFamily: "var(--font-label)", marginBottom: 8 }}>
              {displayRepo}
            </p>
            <p style={{ color: "var(--accent)", fontSize: "12px", fontFamily: "var(--font-label)", marginBottom: 24 }}>
              {activeStepLabel}
            </p>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full mb-6 overflow-hidden" style={{ background: "var(--obsidian-4)" }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${percent || 5}%`,
                  background: "linear-gradient(90deg, var(--accent-muted), var(--accent-bright))",
                }} />
            </div>

            {/* Step list */}
            {steps.length > 0 && (
              <div className="flex flex-col gap-1.5 text-left">
                {steps.map(step => (
                  <div key={step.key}
                    className="flex items-center gap-3 py-1.5 px-3 rounded-lg transition-all duration-300"
                    style={{
                      background: step.status === "active" ? "var(--accent-glow)" : "transparent",
                      opacity: step.status === "done" ? 0.45 : step.status === "active" ? 1 : 0.25,
                    }}>
                    {step.status === "done" ? (
                      <CheckCircle size={12} style={{ color: "var(--guard-monetize)", flexShrink: 0 }} />
                    ) : step.status === "active" ? (
                      <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                    ) : (
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ border: "1px solid var(--border)" }} />
                    )}
                    <span style={{
                      fontSize: "12px",
                      color: step.status === "active" ? "var(--accent)" : "var(--text-secondary)",
                      fontFamily: "var(--font-label)",
                    }}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ─── Main form ────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-6">

            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl mb-6"
                style={{ background: "rgba(232,64,64,0.06)", border: "1px solid rgba(232,64,64,0.25)" }}>
                <AlertTriangle size={16} style={{ color: "var(--guard-security)", flexShrink: 0 }} />
                <p style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>{error}</p>
              </div>
            )}

            <div className="mb-6">
              <h1 className="text-3xl mb-1" style={{ fontFamily: "var(--font-ui)" }}>New Scan</h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontFamily: "var(--font-label)" }}>
                Select a repository to check for production-readiness issues
              </p>
            </div>

            {/* ── Repo picker / manual toggle ─────────────────────────────────── */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                  Repository
                </p>
                <div className="flex-1" />
                <button onClick={() => setUseManual(!useManual)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                  style={{
                    background: useManual ? "var(--surface-3)" : "transparent",
                    color: useManual ? "var(--text-primary)" : "var(--text-tertiary)",
                    border: `1px solid ${useManual ? "var(--border-hover)" : "transparent"}`,
                    fontFamily: "var(--font-label)",
                  }}>
                  {useManual ? "Use picker" : "Enter URL manually"}
                </button>
              </div>

              {useManual ? (
                /* Manual URL input */
                <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <Github size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  <input
                    type="url"
                    value={manualUrl}
                    onChange={e => setManualUrl(e.target.value)}
                    placeholder="https://github.com/username/repository"
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
                  />
                  {manualUrl && (
                    <button onClick={() => setManualUrl("")}>
                      <X size={14} style={{ color: "var(--text-tertiary)" }} />
                    </button>
                  )}
                </div>
              ) : githubConnected === false ? (
                /* Not connected */
                <div className="p-5 rounded-xl text-center"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <Github size={24} className="mx-auto mb-3" style={{ color: "var(--text-tertiary)" }} />
                  <p style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)", marginBottom: 4 }}>
                    Connect GitHub to browse your repositories
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginBottom: 16 }}>
                    Or use "Enter URL manually" above for public repos
                  </p>
                  <Link href="/dashboard/settings"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-label)" }}>
                    <Github size={14} />
                    Connect GitHub
                  </Link>
                </div>
              ) : loadingRepos ? (
                /* Loading */
                <div className="p-8 rounded-xl text-center"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-2"
                    style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                    Loading repositories…
                  </p>
                </div>
              ) : reposError ? (
                /* Error loading repos */
                <div className="p-5 rounded-xl text-center"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <AlertTriangle size={20} className="mx-auto mb-2" style={{ color: "var(--sev-high)" }} />
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", marginBottom: 8 }}>{reposError}</p>
                  <button onClick={() => { setReposError(null); setLoadingRepos(true); window.location.reload(); }}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-label)" }}>
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              ) : (
                /* Repo picker: namespace sidebar + repo list */
                <div>
                  {/* Reauth banner — shown when token is missing read:org scope */}
                  {needsReauth && (
                    <div className="flex items-start gap-3 p-3 rounded-xl mb-3"
                      style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
                      <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", lineHeight: 1.5 }}>
                          Organization repos are hidden because your GitHub token is missing the <code style={{ fontSize: "11px" }}>read:org</code> scope.
                          {" "}<Link href="/dashboard/settings" className="underline" style={{ color: "#f59e0b" }}>Reconnect GitHub in Settings</Link> to see org repos.
                        </p>
                      </div>
                      <button onClick={() => setNeedsReauth(false)} style={{ color: "var(--text-tertiary)", lineHeight: 1 }}>
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <div className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <div className="flex" style={{ minHeight: 320 }}>
                    {/* Namespace sidebar */}
                    <div className="flex flex-col gap-0.5 p-2 border-r overflow-y-auto"
                      style={{ borderColor: "var(--border)", width: 160, flexShrink: 0 }}>
                      {namespaces.map(ns => (
                        <button key={ns.namespace}
                          onClick={() => { setActiveNamespace(ns.namespace); setRepoSearch(""); setSelectedRepo(null); }}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors w-full"
                          style={{
                            background: activeNamespace === ns.namespace ? "var(--surface-3)" : "transparent",
                            border: `1px solid ${activeNamespace === ns.namespace ? "var(--border-hover)" : "transparent"}`,
                          }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ns.avatar} alt={ns.namespace}
                            className="w-5 h-5 rounded-full flex-shrink-0"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          <span className="truncate" style={{ fontSize: "12px", color: activeNamespace === ns.namespace ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                            {ns.namespace}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Repo list */}
                    <div className="flex-1 flex flex-col min-w-0">
                      {/* Search */}
                      <div className="flex items-center gap-2 px-3 py-2.5 border-b"
                        style={{ borderColor: "var(--border)" }}>
                        <Search size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                        <input
                          type="text"
                          value={repoSearch}
                          onChange={e => setRepoSearch(e.target.value)}
                          placeholder="Search repositories…"
                          className="flex-1 bg-transparent outline-none text-xs"
                          style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
                        />
                        {repoSearch && (
                          <button onClick={() => setRepoSearch("")}>
                            <X size={12} style={{ color: "var(--text-tertiary)" }} />
                          </button>
                        )}
                      </div>
                      {/* List */}
                      <div className="overflow-y-auto flex-1" style={{ maxHeight: 300 }}>
                        {filteredRepos.length === 0 ? (
                          <div className="flex items-center justify-center h-24">
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              No repositories found
                            </p>
                          </div>
                        ) : filteredRepos.map(repo => {
                          const isSelected = selectedRepo?.id === repo.id;
                          return (
                            <button key={repo.id}
                              onClick={() => setSelectedRepo(repo)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
                              style={{
                                background: isSelected ? "var(--accent-glow)" : "transparent",
                                borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                              }}>
                              {/* Language dot */}
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ background: repo.language ? (LANG_COLORS[repo.language] ?? "var(--border)") : "var(--border)" }} />
                              <div className="flex-1 min-w-0">
                                <p className="truncate" style={{ fontSize: "13px", color: isSelected ? "var(--accent)" : "var(--text-primary)", fontFamily: "var(--font-label)", fontWeight: isSelected ? 600 : 400 }}>
                                  {repo.name}
                                </p>
                                {repo.description && (
                                  <p className="truncate" style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginTop: 1 }}>
                                    {repo.description}
                                  </p>
                                )}
                              </div>
                              {repo.private && (
                                <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--obsidian-4)", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", fontSize: "10px" }}>
                                  private
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Selected repo footer */}
                  {selectedRepo && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t"
                      style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Github size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
                        <span className="truncate text-sm" style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}>
                          {selectedRepo.full_name}
                        </span>
                        <a href={`https://github.com/${selectedRepo.full_name}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={11} style={{ color: "var(--text-tertiary)" }} />
                        </a>
                      </div>
                      {/* Branch picker */}
                      <div className="relative flex-shrink-0" ref={branchDropdownRef}>
                        <button
                          onClick={() => setBranchOpen(!branchOpen)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                          style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                          <GitBranch size={11} />
                          {loadingBranches ? "…" : selectedBranch}
                          <ChevronDown size={11} style={{ transform: branchOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
                        </button>
                        {branchOpen && branches.length > 0 && (
                          <div className="absolute right-0 bottom-full mb-1 rounded-xl overflow-hidden z-50"
                            style={{ background: "var(--surface-3)", border: "1px solid var(--border)", minWidth: 140, maxHeight: 200, overflowY: "auto" }}>
                            {branches.map(b => (
                              <button key={b}
                                onClick={() => { setSelectedBranch(b); setBranchOpen(false); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.04] transition-colors"
                                style={{ color: b === selectedBranch ? "var(--accent)" : "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                                <GitBranch size={10} />
                                {b}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Framework selector ───────────────────────────────────────── */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                  Framework
                </p>
                {frameworkDetected && (
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(251,191,36,0.08)", color: "#f59e0b", border: "1px solid rgba(251,191,36,0.25)", fontFamily: "var(--font-label)" }}>
                    auto-detected
                  </span>
                )}
                {detectingFramework && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                )}
              </div>
              <div className="relative">
                <select
                  value={framework}
                  onChange={e => { setFramework(e.target.value); setFrameworkDetected(false); }}
                  className="w-full px-4 py-3 rounded-xl text-sm appearance-none cursor-pointer"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                    outline: "none",
                  }}>
                  {FRAMEWORK_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--text-tertiary)" }} />
              </div>
              {framework === "unknown" && (
                <p className="text-xs mt-1.5" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                  Framework-specific checks will be skipped. Universal checks (secrets, CVEs, OWASP) still run.
                </p>
              )}
            </div>

            {/* ── Guards preview ────────────────────────────────────────────── */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                Guards to run
              </p>
              <div className="grid grid-cols-4 gap-2">
                {guards.map(g => {
                  const Icon = g.icon;
                  return (
                    <div key={g.key}
                      className="flex items-center gap-2 p-3 rounded-xl"
                      style={{ background: "var(--surface-2)", border: `1px solid ${g.color}22` }}>
                      <Icon size={13} style={{ color: g.color, flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                        {g.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Run button ────────────────────────────────────────────────── */}
            <button
              onClick={handleScan}
              disabled={!canScan}
              className="w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
              style={{
                background: "var(--accent)",
                color: "var(--obsidian)",
                fontFamily: "var(--font-ui)",
                boxShadow: "0 8px 32px var(--accent-glow-strong)",
              }}>
              <Shield size={18} />
              Run Production Scan
              <ArrowRight size={16} />
            </button>

            <p className="text-center text-xs mt-4"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
              Uses 1 of your free monthly scans &nbsp;·&nbsp;
              <Link href="/pricing" style={{ color: "var(--accent)" }}>Upgrade for unlimited</Link>
            </p>

          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Shared top bar component ─────────────────────────────────────────────────

function TopBar() {
  return (
    <div className="h-16 flex items-center px-6 border-b flex-shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}>
      <div className="flex items-center gap-4">
        <Link href="/dashboard"
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
          <ChevronLeft size={15} />
          Dashboard
        </Link>
        <span style={{ color: "var(--border)", fontSize: "14px" }}>/</span>
        <span style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
          New Scan
        </span>
      </div>
    </div>
  );
}
