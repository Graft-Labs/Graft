"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Github,
  Upload,
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
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import { createClient } from "@/lib/supabase";

const guards = [
  { key: "security", label: "Security Guard", icon: Lock, color: "var(--guard-security)", desc: "Exposed secrets, CVEs, auth holes" },
  { key: "scalability", label: "Scalability Guard", icon: Zap, color: "var(--guard-scale)", desc: "Error handling, rate limits, DB" },
  { key: "monetization", label: "Monetization Guard", icon: DollarSign, color: "var(--guard-monetize)", desc: "Payments, webhooks, pricing" },
  { key: "distribution", label: "Distribution Guard", icon: Globe, color: "var(--guard-distrib)", desc: "SEO, analytics, OG tags" },
];

type ScanMode = "url" | "zip";

const scanningSteps = [
  "Connecting to repository…",
  "Cloning repository…",
  "Running TruffleHog (secret detection)…",
  "Running OSV-Scanner (CVE check)…",
  "Running Semgrep rules…",
  "Analyzing monetization patterns…",
  "Checking distribution health…",
  "Generating AI report…",
  "Finalizing scores…",
];

export default function NewScanPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<ScanMode>("url");
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGithubBanner, setShowGithubBanner] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const checkScanStatus = useCallback(async (id: string) => {
    const { data: scan, error: fetchError } = await supabase
      .from("scans")
      .select("status, overall_score")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Error checking scan status:", fetchError);
      return;
    }

    if (scan?.status === "completed") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      setTimeout(() => {
        router.push(`/scan/${id}`);
      }, 1500);
    } else if (scan?.status === "failed") {
      setScanning(false);
      setError("Scan failed. Please try again.");
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    }
  }, [router, supabase]);

  useEffect(() => {
    if (scanId && scanning) {
      pollingRef.current = setInterval(() => {
        checkScanStatus(scanId);
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [scanId, scanning, checkScanStatus]);

  const handleScan = async () => {
    if (!repoUrl.trim() && mode === "url") return;
    setScanning(true);
    setScanStep(0);
    setCompletedSteps([]);
    setError(null);
    setShowGithubBanner(false);

    let currentStep = 0;
    const stepInterval = setInterval(() => {
      if (currentStep < scanningSteps.length - 1) {
        setScanStep(currentStep);
        if (currentStep > 0) {
          setCompletedSteps((prev) => [...prev, currentStep - 1]);
        }
        currentStep++;
      } else {
        clearInterval(stepInterval);
      }
    }, 800);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: repoUrl,
          branch: "main",
        }),
      });

      clearInterval(stepInterval);

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "github_not_connected") {
          setScanning(false);
          setShowGithubBanner(true);
          return;
        }
        throw new Error(data.message || "Failed to start scan");
      }

      setScanId(data.scan_id);

      let step = currentStep;
      const finishInterval = setInterval(() => {
        if (step < scanningSteps.length - 1) {
          setScanStep(step);
          if (step > 0) {
            setCompletedSteps((prev) => [...prev, step - 1]);
          }
          step++;
        } else {
          clearInterval(finishInterval);
        }
      }, 600);

    } catch (err) {
      clearInterval(stepInterval);
      setScanning(false);
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  if (showGithubBanner) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <div
            className="h-16 flex items-center px-6 border-b flex-shrink-0"
            style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
          >
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
              >
                <ChevronLeft size={15} />
                Dashboard
              </Link>
              <span style={{ color: "var(--border)", fontSize: "14px" }}>/</span>
              <span style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                New Scan
              </span>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{ background: "var(--guard-security)", opacity: 0.15 }}
              >
                <Github size={28} style={{ color: "var(--guard-security)" }} />
              </div>
              <h2
                className="text-2xl mb-2"
                style={{ fontFamily: "var(--font-ui)" }}
              >
                GitHub Connection Required
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontFamily: "var(--font-label)", marginBottom: 24 }}>
                To scan private repositories, please connect your GitHub account in Settings.
              </p>
              <div
                className="p-4 rounded-xl mb-6 text-left"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)", fontWeight: 500 }}>
                      Private Repository Detected
                    </p>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", marginTop: 4 }}>
                      Connect your GitHub account to access private repos. Public repos do not require this.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/scan/new"
                  className="flex-1 py-3 rounded-xl font-medium text-sm"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-label)",
                  }}
                  onClick={() => setShowGithubBanner(false)}
                >
                  Go Back
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex-1 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2"
                  style={{
                    background: "var(--accent)",
                    color: "var(--obsidian)",
                    fontFamily: "var(--font-label)",
                  }}
                >
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

  if (scanning) {
    const progress = Math.round((scanStep / (scanningSteps.length - 1)) * 100);
    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div
                className="w-24 h-24 rounded-2xl flex items-center justify-center animate-pulse-accent"
                style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}
              >
                <Shield size={40} style={{ color: "var(--accent)" }} />
              </div>
              <div
                className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none"
                style={{ opacity: 0.5 }}
              >
                <div
                  className="w-full h-0.5 animate-scan-line"
                  style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
                />
              </div>
            </div>

            <h2
              className="text-2xl mb-2"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Scanning your repository
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontFamily: "var(--font-label)", marginBottom: 32 }}>
              {repoUrl || "your-app"}
            </p>

            <div
              className="h-1.5 rounded-full mb-6 overflow-hidden"
              style={{ background: "var(--obsidian-4)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, var(--accent-muted), var(--accent-bright))",
                }}
              />
            </div>

            <div className="flex flex-col gap-2 text-left">
              {scanningSteps.map((step, i) => {
                const isDone = completedSteps.includes(i);
                const isActive = scanStep === i;
                return (
                  <div
                    key={step}
                    className="flex items-center gap-3 py-1.5 px-3 rounded-lg transition-all duration-300"
                    style={{
                      background: isActive ? "var(--accent-glow)" : "transparent",
                      opacity: isDone ? 0.5 : isActive ? 1 : 0.3,
                    }}
                  >
                    {isDone ? (
                      <CheckCircle size={13} style={{ color: "var(--guard-monetize)", flexShrink: 0 }} />
                    ) : isActive ? (
                      <div
                        className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
                      />
                    ) : (
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ border: "1px solid var(--border)" }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: "12px",
                        color: isActive ? "var(--accent)" : "var(--text-secondary)",
                        fontFamily: "var(--font-label)",
                      }}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />

      <main className="flex-1 flex flex-col min-w-0">
        <div
          className="h-16 flex items-center px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
        >
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              <ChevronLeft size={15} />
              Dashboard
            </Link>
            <span style={{ color: "var(--border)", fontSize: "14px" }}>/</span>
            <span style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
              New Scan
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6">

            {error && (
              <div
                className="flex items-center gap-3 p-4 rounded-xl mb-6"
                style={{ background: "var(--guard-security)", opacity: 0.1, border: "1px solid var(--guard-security)" }}
              >
                <AlertTriangle size={18} style={{ color: "var(--guard-security)", flexShrink: 0 }} />
                <p style={{ fontSize: "14px", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                  {error}
                </p>
              </div>
            )}

            <div className="mb-8">
              <h1
                className="text-3xl mb-2"
                style={{ fontFamily: "var(--font-ui)" }}
              >
                New Scan
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontFamily: "var(--font-label)" }}>
                Scan your repository for production-readiness issues
              </p>
            </div>

            <div
              className="flex p-1 rounded-xl mb-6"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              {[
                { id: "url" as const, label: "GitHub URL", icon: Github },
                { id: "zip" as const, label: "Upload ZIP", icon: Upload },
              ].map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
                    style={{
                      background: mode === m.id ? "var(--surface-3)" : "transparent",
                      color: mode === m.id ? "var(--text-primary)" : "var(--text-tertiary)",
                      border: mode === m.id ? "1px solid var(--border-hover)" : "1px solid transparent",
                      fontFamily: "var(--font-label)",
                    }}
                  >
                    <Icon size={15} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              {mode === "url" ? (
                <div>
                  <label
                    className="block text-xs font-medium mb-2"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
                  >
                    GitHub Repository URL
                  </label>
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Github size={17} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                    <input
                      type="url"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
                    />
                    {repoUrl && (
                      <button onClick={() => setRepoUrl("")}>
                        <X size={14} style={{ color: "var(--text-tertiary)" }} />
                      </button>
                    )}
                  </div>
                  <p
                    className="text-xs mt-2"
                    style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
                  >
                    Supports public and private repositories (requires GitHub OAuth)
                  </p>
                </div>
              ) : (
                <div>
                  <label
                    className="block text-xs font-medium mb-2"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
                  >
                    Upload ZIP Archive
                  </label>
                  <div
                    className="flex flex-col items-center justify-center p-12 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--obsidian-1)",
                    }}
                    onClick={() => {}}
                  >
                    <Upload size={28} className="mb-3" style={{ color: "var(--text-tertiary)" }} />
                    <p style={{ fontSize: "14px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                      Drop your .zip file here
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginTop: 4 }}>
                      or click to browse · max 50MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-8">
              <p
                className="text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
              >
                Guards to run
              </p>
              <div className="grid grid-cols-2 gap-3">
                {guards.map((g) => {
                  const Icon = g.icon;
                  return (
                    <div
                      key={g.key}
                      className="flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all duration-150"
                      style={{
                        background: "var(--surface-2)",
                        border: `1px solid ${g.color}33`,
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: `${g.color}18`, border: `1px solid ${g.color}33` }}
                      >
                        <Icon size={15} style={{ color: g.color }} />
                      </div>
                      <div className="min-w-0">
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                          {g.label}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                          {g.desc}
                        </p>
                      </div>
                      <CheckCircle size={14} className="ml-auto flex-shrink-0 mt-0.5" style={{ color: g.color }} />
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleScan}
              disabled={mode === "url" && !repoUrl.trim()}
              className="w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
              style={{
                background: "var(--accent)",
                color: "var(--obsidian)",
                fontFamily: "var(--font-ui)",
                boxShadow: "0 8px 32px var(--accent-glow-strong)",
              }}
            >
              <Shield size={18} />
              Run Production Scan
              <ArrowRight size={16} />
            </button>

            <p
              className="text-center text-xs mt-4"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Uses 1 of your 1 free monthly scans &nbsp;·&nbsp;
              <Link href="/pricing" style={{ color: "var(--accent)" }}>
                Upgrade for unlimited
              </Link>
            </p>

          </div>
        </div>
      </main>
    </div>
  );
}
