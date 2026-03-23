"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Github,
  Loader2,
  Search,
  ArrowRight,
  Zap,
  DollarSign,
  Globe,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import Image from "next/image";
import { getCached, setCached } from "@/lib/client-cache";

type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
};

type RepoResponse = {
  namespaces?: Array<{
    namespace: string;
    avatar: string;
    repos: Repository[];
  }>;
  needs_reauth?: boolean;
  error?: string;
  message?: string;
};

export default function NewScanPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch GitHub repositories
  useEffect(() => {
    async function fetchRepos() {
      try {
        const cachedRepos = getCached<Repository[]>("scan:new:repos");
        if (cachedRepos && cachedRepos.length > 0) {
          setRepos(cachedRepos);
          setLoading(false);
        }

        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push("/auth/login");
          return;
        }

        const response = await fetch("/api/github/repos");
        const data: RepoResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to fetch repositories");
        }

        const flattenedRepos = (data.namespaces || [])
          .flatMap((group) => group.repos)
          .sort((a, b) => a.full_name.localeCompare(b.full_name));

        setRepos(flattenedRepos);
        setCached("scan:new:repos", flattenedRepos, 60_000);

        if (data.needs_reauth) {
          setError(
            "GitHub is not connected yet. Go to Settings → Integrations and connect GitHub.",
          );
        }
      } catch (err: any) {
        console.error("Error fetching repos:", err);
        setError(err.message || "Failed to load repositories");
      } finally {
        setLoading(false);
      }
    }

    fetchRepos();
  }, [router]);

  // Handle repo selection
  const handleSelectRepo = async (repo: Repository) => {
    setSelectedRepo(repo);
    setSelectedBranch(repo.default_branch);

    try {
      const [owner, name] = repo.full_name.split("/");
      const response = await fetch(`/api/github/branches/${owner}/${name}`);
      if (response.ok) {
        const data = await response.json();
        setBranches((data.branches || []).map((b: { name: string }) => b.name));
      } else {
        setBranches([repo.default_branch]);
      }
    } catch (error) {
      console.error("Failed to fetch branches:", error);
      setBranches([repo.default_branch]);
    }
  };

  const handleStartScan = async () => {
    if (!selectedRepo || !selectedBranch) return;

    setScanning(true);

    try {
      setError(null);
      const repoUrl = `https://github.com/${selectedRepo.full_name}`;
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoUrl,
          branch: selectedBranch,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to start scan");
      }

      if (data.scan_id) {
        router.push(`/scan/${data.scan_id}`);
        return;
      }

      throw new Error("Scan started but no scan ID was returned.");
    } catch (err: any) {
      setError(err.message || "Failed to start scan");
      setScanning(false);
    }
  };

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-white relative w-full overflow-hidden flex flex-col">
      {/* Animated subtle grid background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:6rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] opacity-50" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-gradient-to-b from-blue-50/50 to-transparent opacity-50 blur-3xl" />
      </div>

      {/* Header bar with Back Button */}
      <div className="relative z-10 w-full px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>
      </div>

      <div className="flex-1 p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto w-full relative z-10">
        <header className="mb-10 text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white border border-blue-100 mb-6 shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white" />
            <div className="absolute w-28 h-28 rounded-full border-2 border-blue-200/70 animate-ping" />
            <Image
              src="/graft.svg"
              alt="Graft"
              width={36}
              height={36}
              className="relative z-10 h-9 w-auto animate-pulse"
            />
          </div>
          <h1
            className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 mb-4"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            New Scan
          </h1>
          <p
            className="text-gray-500 font-medium text-lg"
            style={{ fontFamily: "var(--font-landing-body)" }}
          >
            Select a repository to analyze for security vulnerabilities,
            scalability bottlenecks, and production readiness.
          </p>
        </header>

        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 font-medium text-sm">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Step 1: Select Repository */}
          <div
            className={`transition-opacity duration-300 ${selectedRepo && !scanning ? "opacity-50" : "opacity-100"}`}
          >
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
              <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-3 mb-4">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold">
                    1
                  </span>
                  <h2
                    className="text-lg font-bold text-gray-900"
                    style={{ fontFamily: "var(--font-landing-heading)" }}
                  >
                    Select Repository
                  </h2>
                </div>

                <div className="relative">
                  <Search
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                    size={18}
                  />
                  <input
                    type="text"
                    placeholder="Search repositories..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={loading || scanning}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent shadow-sm font-medium"
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#3079FF]" />
                    <p className="font-medium text-sm">
                      Loading repositories...
                    </p>
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className="text-center py-10 text-gray-500 text-sm font-medium">
                    No repositories found matching "{search}"
                  </div>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      disabled={scanning}
                      className={`w-full text-left p-4 rounded-xl border transition-all duration-200 flex items-start gap-3 ${
                        selectedRepo?.id === repo.id
                          ? "bg-blue-50 border-[#3079FF] shadow-sm"
                          : "bg-white border-gray-100 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <Github
                        className={
                          selectedRepo?.id === repo.id
                            ? "text-[#3079FF]"
                            : "text-gray-400"
                        }
                        size={20}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`font-bold truncate ${selectedRepo?.id === repo.id ? "text-[#3079FF]" : "text-gray-900"}`}
                            style={{
                              fontFamily: "var(--font-landing-heading)",
                            }}
                          >
                            {repo.name}
                          </span>
                          {repo.private && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 border border-gray-200">
                              Private
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs text-gray-500 truncate font-medium"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {repo.full_name}
                        </p>
                      </div>
                      {selectedRepo?.id === repo.id && (
                        <CheckCircle className="text-[#3079FF]" size={18} />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Step 2: Configure & Scan */}
          <div
            className={`transition-opacity duration-300 ${!selectedRepo ? "opacity-30 pointer-events-none" : "opacity-100"}`}
          >
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
              <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold">
                    2
                  </span>
                  <h2
                    className="text-lg font-bold text-gray-900"
                    style={{ fontFamily: "var(--font-landing-heading)" }}
                  >
                    Configure Scan
                  </h2>
                </div>
              </div>

              <div className="flex-1 p-6 flex flex-col">
                {selectedRepo ? (
                  <>
                    <div className="mb-8">
                      <label
                        className="block text-sm font-bold text-gray-900 mb-3"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Target Branch
                      </label>
                      <div className="relative">
                        <select
                          value={selectedBranch}
                          onChange={(e) => setSelectedBranch(e.target.value)}
                          disabled={scanning}
                          className="w-full pl-4 pr-10 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent shadow-sm font-medium appearance-none cursor-pointer"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {branches.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none">
                          <svg
                            className="w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M19 9l-7 7-7-7"
                            ></path>
                          </svg>
                        </div>
                      </div>
                    </div>

                    <div className="mb-auto">
                      <label
                        className="block text-sm font-bold text-gray-900 mb-3"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Analysis Engines
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {
                            id: "security",
                            label: "Security",
                            icon: Github,
                            color: "text-red-500",
                            bg: "bg-red-50",
                          },
                          {
                            id: "scalability",
                            label: "Scalability",
                            icon: Zap,
                            color: "text-blue-500",
                            bg: "bg-blue-50",
                          },
                          {
                            id: "monetization",
                            label: "Monetization",
                            icon: DollarSign,
                            color: "text-green-500",
                            bg: "bg-green-50",
                          },
                          {
                            id: "distribution",
                            label: "Distribution",
                            icon: Globe,
                            color: "text-purple-500",
                            bg: "bg-purple-50",
                          },
                        ].map((engine) => (
                          <div
                            key={engine.id}
                            className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50"
                          >
                            <div
                              className={`p-1.5 rounded-lg ${engine.bg} ${engine.color}`}
                            >
                              <engine.icon size={16} strokeWidth={2.5} />
                            </div>
                            <span
                              className="text-sm font-bold text-gray-700"
                              style={{ fontFamily: "var(--font-landing-body)" }}
                            >
                              {engine.label}
                            </span>
                            <CheckCircle
                              size={14}
                              className="text-[#3079FF] ml-auto"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-gray-100">
                      <button
                        onClick={handleStartScan}
                        disabled={scanning || !selectedBranch}
                        className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-full bg-black text-white font-bold text-sm hover:bg-gray-800 transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        {scanning ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Initializing Scan...
                          </>
                        ) : (
                          <>
                            <Zap className="w-5 h-5" fill="currentColor" />
                            Start Deep Analysis
                          </>
                        )}
                      </button>
                      <p className="text-center text-xs text-gray-500 font-medium mt-4">
                        This will use 1 scan credit from your plan.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
                      <ArrowRight size={24} className="text-gray-300" />
                    </div>
                    <p className="font-medium text-sm text-center max-w-[200px]">
                      Select a repository from the left to configure your scan.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
