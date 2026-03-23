"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import posthog from "posthog-js";
import {
  Github,
  Shield,
  Zap,
  DollarSign,
  Globe,
  ChevronLeft,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  TriangleAlert,
  Info,
  ChevronDown,
  Lock,
  ExternalLink,
  FileCode,
  Code,
  Wand2,
  ChevronUp,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { getCached, setCached } from "@/lib/client-cache";

const progressUiStyles = `
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

type Scan = {
  id: string;
  repo: string;
  branch: string;
  commit_hash: string;
  status: string;
  overall_score: number;
  security_score: number;
  scalability_score: number;
  monetization_score: number;
  distribution_score: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  created_at: string;
  framework: string | null;
};

type Issue = {
  id: string;
  scan_id: string;
  guard: string;
  severity: string;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  fix: string;
  confidence: "confirmed" | "likely" | "possible" | null;
  code_snippet: string | null;
};

type Guard = "security" | "scalability" | "monetization" | "distribution";

type ProgressStep = {
  key: string;
  label: string;
  status: "done" | "active" | "pending";
};

type ScanProgress = {
  overallStatus: string;
  percent: number;
  currentStep: string | null;
  steps: ProgressStep[];
};

const guardConfig: Record<Guard, { label: string; icon: typeof Shield; color: string; glow: string }> = {
  security:     { label: "Security",       icon: Lock,       color: "#DC2626", glow: "#FEF2F2" },
  scalability:  { label: "Scalability",     icon: Zap,        color: "#2563EB", glow: "#EFF6FF" },
  monetization: { label: "Monetization",   icon: DollarSign, color: "#059669", glow: "#ECFDF5" },
  distribution: { label: "Distribution",   icon: Globe,      color: "#7C3AED", glow: "#F5F3FF" },
};

// Human-readable framework labels
const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs:     "Next.js",
  sveltekit:  "SvelteKit",
  nuxt:       "Nuxt.js",
  "react-vite": "React + Vite",
  express:    "Express",
  nestjs:     "NestJS",
  fastify:    "Fastify",
  react:      "React",
  unknown:    "Unknown",
};

function generateFixPrompt(
  issues: Issue[],
  repo: string,
  framework: string | null,
  date: string,
): string {
  const filtered = issues;

  if (filtered.length === 0) return "";

  const frameworkLabel = framework
    ? ({ nextjs: "Next.js", sveltekit: "SvelteKit", nuxt: "Nuxt.js", "react-vite": "React + Vite", express: "Express", nestjs: "NestJS", fastify: "Fastify", react: "React" } as Record<string, string>)[framework] ?? framework
    : "Unknown";

  const lines: string[] = [
    `I need you to fix the following production-readiness issues found in my codebase by Graft.`,
    `Please fix all of them in one pass.`,
    ``,
    `## Codebase: ${repo} (${frameworkLabel})`,
    `## Scan date: ${new Date(date).toLocaleDateString()}`,
    `## Total issues: ${issues.length}`,
    ``,
    `---`,
    ``,
  ];

  const guards = ["security", "scalability", "monetization", "distribution"] as const;
  for (const guard of guards) {
    const guardIssues = filtered.filter(i => i.guard === guard);
    if (guardIssues.length === 0) continue;
    for (const issue of guardIssues) {
      lines.push(`### [${issue.severity.toUpperCase()} - ${guard.charAt(0).toUpperCase() + guard.slice(1)}] ${issue.title}`);
      if (issue.file) lines.push(`File: ${issue.file}${issue.line ? `, line ${issue.line}` : ""}`);
      lines.push(`Problem: ${issue.description}`);
      lines.push(`Fix: ${issue.fix}`);
      if (issue.code_snippet) lines.push(`Code:\n${issue.code_snippet}`);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
  }

  lines.push(`Fix all issues above. Ask me if you need clarification on any specific fix.`);
  return lines.join("\n");
}

function FrameworkBadge({ framework }: { framework: string | null }) {
  if (!framework || framework === "unknown") return null;
  const label = FRAMEWORK_LABELS[framework] ?? framework;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: "#EFF6FF",
        color: "#2563EB",
        border: "1px solid #BFDBFE",
        fontFamily: "var(--font-landing-body)",
      }}
    >
      {label}
    </span>
  );
}

// Titles that are SaaS-specific checks (CHECKs 24-30, 34)
const SAAS_TITLE_FRAGMENTS = [
  'Multi-tenant query',
  'Auth token stored in localStorage',
  'Payment webhook handler missing idempotency',
  'Plan/feature gate is client-side only',
  'No account deletion',
  'Live API key hardcoded',
  'Analytics/tracking without cookie consent',
]

function isSaasIssue(title: string): boolean {
  return SAAS_TITLE_FRAGMENTS.some(f => title.includes(f))
}

function SaasBadge() {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      style={{
        background: "rgba(48, 121, 255, 0.1)",
        color: "#2563EB",
        border: "1px solid #BFDBFE",
        fontFamily: "var(--font-landing-body)",
        fontSize: "10px",
        letterSpacing: "0.02em",
      }}
    >
      SaaS
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: Issue["confidence"] }) {
  if (!confidence) return null;
  const styles = {
    confirmed: { bg: "rgba(16,185,129,0.1)",  color: "#059669", border: "rgba(16,185,129,0.3)",  label: "confirmed" },
    likely:    { bg: "rgba(251,191,36,0.1)",  color: "#3079FF",          border: "rgba(251,191,36,0.3)", label: "likely" },
    possible:  { bg: "rgba(107,103,98,0.15)", color: "#4B5563",   border: "rgba(107,103,98,0.3)", label: "possible" },
  };
  const s = styles[confidence];
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: "var(--font-landing-body)" }}
    >
      {s.label}
    </span>
  );
}

function ScoreRing({ score, color, size = 90 }: { score: number; color: string; size?: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="7" />
      <circle
        cx="40" cy="40" r={radius} fill="none"
        stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="40" y="46" textAnchor="middle" fill={color} fontSize="18" fontWeight="600"
        fontFamily="'Geist', sans-serif" fontStyle="normal">
        {score}
      </text>
    </svg>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <XCircle size={14} style={{ color: "#DC2626" }} />;
  if (severity === "high")     return <AlertTriangle size={14} style={{ color: "#EA580C" }} />;
  if (severity === "medium")   return <AlertTriangle size={14} style={{ color: "#D97706" }} />;
  return <Info size={14} style={{ color: "#6B7280" }} />;
}

function IssueCard({ issue, repo, branch, commitHash }: {
  issue: Issue;
  repo: string;
  branch: string;
  commitHash: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snippetExpanded, setSnippetExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(issue.fix);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build GitHub link if we have file + line
  const githubFileUrl = issue.file
    ? `https://github.com/${repo}/blob/${commitHash || branch}/${issue.file}${issue.line ? `#L${issue.line}` : ""}`
    : null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${issue.severity === "critical" ? "rgba(232,64,64,0.25)" : "#E5E7EB"}`,
        background: issue.severity === "critical" ? "rgba(232,64,64,0.04)" : "#F9FAFB",
      }}
    >
      {/* Header */}
      <button
        onClick={() => {
          const nextExpanded = !expanded;
          setExpanded(nextExpanded);
          if (nextExpanded) {
            posthog.capture("scan_issue_expanded", {
              issueId: issue.id,
              severity: issue.severity,
              guard: issue.guard,
              title: issue.title,
            });
          }
        }}
        className="w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-gray-50"
      >
        <SeverityIcon severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-sm font-medium"
              style={{ fontFamily: "var(--font-landing-heading)", letterSpacing: "-0.01em" }}
            >
              {issue.title}
            </span>
            <span
              className={cn("text-xs px-1.5 py-0.5 rounded", `badge-${issue.severity}`)}
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {issue.severity}
            </span>
            <ConfidenceBadge confidence={issue.confidence} />
            {isSaasIssue(issue.title) && <SaasBadge />}
          </div>
          {issue.file && (
            <div className="flex items-center gap-1.5">
              <FileCode size={11} style={{ color: "#4B5563" }} />
              {githubFileUrl ? (
                <a
                  href={githubFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 hover:underline"
                  style={{ fontSize: "11px", color: "#3079FF", fontFamily: "var(--font-mono)", letterSpacing: 0 }}
                >
                  {issue.file}{issue.line ? `:${issue.line}` : ""}
                  <ExternalLink size={9} />
                </a>
              ) : (
                <span style={{ fontSize: "11px", color: "#4B5563", fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
                  {issue.file}{issue.line ? `:${issue.line}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
        <ChevronDown
          size={14}
          style={{
            color: "#4B5563",
            transform: expanded ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="h-px mb-4" style={{ background: "#E5E7EB" }} />

          {/* Description */}
          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: "#4B5563", fontFamily: "var(--font-landing-body)" }}
          >
            {issue.description}
          </p>

          {/* Code snippet (collapsible) */}
          {issue.code_snippet && (
            <div className="mb-5">
              <button
                onClick={() => setSnippetExpanded(!snippetExpanded)}
                className="flex items-center gap-2 text-xs mb-2 transition-colors"
                style={{ color: "#4B5563", fontFamily: "var(--font-landing-body)" }}
              >
                <Code size={11} />
                Matched code
                <ChevronDown
                  size={11}
                  style={{ transform: snippetExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}
                />
              </button>
              {snippetExpanded && (
                <pre
                  className="code-block overflow-x-auto"
                  style={{ fontSize: "11px", color: "#B45309", background: "rgba(251,191,36,0.08)", borderLeft: "2px solid rgba(251,191,36,0.3)" }}
                >
                  <code>{issue.code_snippet}</code>
                </pre>
              )}
            </div>
          )}

          {/* Fix suggestion */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "#3079FF", fontFamily: "var(--font-landing-body)" }}
              >
                Fix Suggestion
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded transition-all duration-150"
                style={{
                  background: copied ? "#ECFDF5" : "#F3F4F6",
                  color: copied ? "#059669" : "#4B5563",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "#E5E7EB"}`,
                  fontFamily: "var(--font-landing-body)",
                }}
              >
                {copied ? <CheckCircle size={11} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy fix"}
              </button>
            </div>
            <pre
              className="code-block overflow-x-auto"
              style={{ fontSize: "12px", color: "#4B5563" }}
            >
              <code>{issue.fix}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScanReportPage() {
  const params = useParams();
  const scanId = params.id as string;
  const [activeGuard, setActiveGuard] = useState<Guard | "all">("all");
  const [scan, setScan] = useState<Scan | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [fixPromptCopied, setFixPromptCopied] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [dismissedStepCount, setDismissedStepCount] = useState(0);

  useEffect(() => {
    async function fetchScanData() {
      const cached = getCached<{ scan: Scan | null; issues: Issue[] }>(`scan:report:${scanId}`);
      if (cached) {
        setScan(cached.scan);
        setIssues(cached.issues || []);
        setLoading(false);
      }

      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/auth/login";
        return;
      }

      const { data: scanData } = await supabase
        .from("scans")
        .select("*")
        .eq("id", scanId)
        .eq("user_id", user.id)
        .single();

      const { data: issuesData } = await supabase
        .from("issues")
        .select("*")
        .eq("scan_id", scanId)
        .order("created_at", { ascending: false });

      setScan(scanData);
      setIssues(issuesData || []);
      setCached(`scan:report:${scanId}`, { scan: scanData, issues: issuesData || [] }, 20_000);

      setLoading(false);
    }

    fetchScanData();

    const interval = setInterval(fetchScanData, 4000);
    return () => clearInterval(interval);
  }, [scanId]);

  useEffect(() => {
    if (!scan || (scan.status !== "pending" && scan.status !== "scanning")) return;

    let cancelled = false;

    const fetchProgress = async () => {
      try {
        const res = await fetch(`/api/scan/${scanId}/progress`, { cache: "no-store" });
        if (!res.ok) return;
        const data: ScanProgress = await res.json();
        if (!cancelled) setProgress(data);
      } catch {
        // Keep polling silently; UI has fallback text.
      }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scan, scanId]);

  useEffect(() => {
    if (!progress?.steps?.length) return;

    const doneCount = progress.steps.filter((s) => s.status === "done").length;
    if (doneCount > dismissedStepCount) {
      setDismissedStepCount(doneCount);
    }
  }, [progress, dismissedStepCount]);

  if (loading) {
    return (
      <div className="flex min-h-screen w-full bg-[#FAFAFA] p-4 lg:p-6 gap-6">
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="w-8 h-8 rounded-full border-2 border-[#3079FF]/30 border-t-[#3079FF] animate-spin" />
        </main>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex min-h-screen w-full bg-[#FAFAFA] p-4 lg:p-6 gap-6">
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="text-center">
            <p style={{ color: "#4B5563", fontFamily: "var(--font-landing-heading)" }}>
              Scan not found
            </p>
            <Link href="/dashboard" style={{ color: "#3079FF", fontFamily: "var(--font-landing-body)" }}>
              Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const filteredIssues = activeGuard === "all"
    ? issues
    : issues.filter((i) => i.guard === activeGuard);

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const highCount     = issues.filter((i) => i.severity === "high").length;
  const mediumCount   = issues.filter((i) => i.severity === "medium").length;

  const report = {
    repo:         scan.repo,
    branch:       scan.branch,
    commitHash:   scan.commit_hash,
    status:       scan.status,
    createdAt:    scan.created_at,
    overallScore: scan.overall_score,
    framework:    scan.framework,
    scores: {
      security:     { score: scan.security_score,     label: scan.security_score < 50     ? "Needs Work" : "Good" },
      scalability:  { score: scan.scalability_score,  label: scan.scalability_score < 50  ? "Needs Work" : "Good" },
      monetization: { score: scan.monetization_score, label: scan.monetization_score < 50 ? "Needs Work" : "Good" },
      distribution: { score: scan.distribution_score, label: scan.distribution_score < 50 ? "Needs Work" : "Good" },
    },
  };

  if (scan.status === "pending" || scan.status === "scanning") {
    const fallbackSteps: ProgressStep[] = [
      { key: "queued", label: "Queued", status: scan.status === "pending" ? "active" : "done" },
      { key: "cloning", label: "Cloning repository", status: scan.status === "scanning" ? "active" : "pending" },
      { key: "analysis", label: "Running analysis", status: "pending" },
      { key: "scoring", label: "Calculating scores", status: "pending" },
      { key: "complete", label: "Complete", status: "pending" },
    ];
    const steps = progress?.steps?.length ? progress.steps : fallbackSteps;
    const percent = typeof progress?.percent === "number" ? progress.percent : (scan.status === "pending" ? 8 : 35);
    const visibleSteps = steps.slice(Math.max(0, dismissedStepCount - 1), Math.max(0, dismissedStepCount - 1) + 5);

    return (
      <div className="flex min-h-screen w-full bg-[#FAFAFA] p-4 lg:p-6 gap-6">
        <DashboardSidebar />
        <main className="flex-1 flex flex-col min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-[calc(100vh-3rem)]">
          <style>{progressUiStyles}</style>
          <div className="h-16 flex items-center px-6 border-b" style={{ borderColor: "#E5E7EB", background: "#FFFFFF" }}>
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: "#4B5563", fontFamily: "var(--font-landing-body)" }}
            >
              <ChevronLeft size={15} />
              Dashboard
            </Link>
          </div>

          <div className="flex-1 p-4 md:p-6 overflow-auto">
            <div className="w-full max-w-5xl mx-auto rounded-3xl border border-gray-200 bg-white shadow-sm p-5 md:p-6 lg:p-7 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(48,121,255,0.08),transparent_60%)] pointer-events-none" />

              <div className="relative grid lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-8 items-start">
                <div>
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white border border-blue-100 mb-4 shadow-sm relative">
                    <div className="absolute w-24 h-24 rounded-full border-2 border-blue-200/70 animate-ping" />
                    <div className="absolute w-16 h-16 rounded-full border border-blue-200/60 animate-pulse" />
                    <Image src="/graft.svg" alt="Graft" width={36} height={36} className="relative z-10 h-9 w-auto" />
                  </div>

                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-heading)" }}>
                    {scan.status === "scanning" ? "Scanning in progress" : "Queued for scanning"}
                  </h2>
                  <p className="text-gray-500 font-medium mb-5" style={{ fontFamily: "var(--font-landing-body)" }}>
                    We are analyzing your repository across security, scalability, monetization, and distribution.
                  </p>

                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-2" style={{ fontFamily: "var(--font-landing-body)" }}>
                      <span>Scan Progress</span>
                      <span>{Math.min(100, Math.max(0, percent))}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3079FF] to-[#5B9BFF] transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                      />
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-2 text-sm text-gray-600 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-[#3079FF]/30 border-t-[#3079FF] animate-spin shrink-0" />
                    Auto-refreshing results every 2.5s
                  </div>
                </div>

                <div className="relative">
                  <div className="grid grid-cols-1 gap-2 text-left max-h-[280px] overflow-hidden">
                    {visibleSteps.map((step) => (
                      <div
                        key={step.key}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 transition-all duration-500 animate-[slideIn_.45s_ease]"
                      >
                        {step.status === "done" ? (
                          <CheckCircle size={16} className="text-emerald-600" />
                        ) : step.status === "active" ? (
                          <div className="w-4 h-4 rounded-full border-2 border-[#3079FF]/35 border-t-[#3079FF] animate-spin" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-gray-300 bg-white" />
                        )}
                        <span className={`text-sm ${step.status === "pending" ? "text-gray-500" : "text-gray-800"}`} style={{ fontFamily: "var(--font-landing-body)" }}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white via-white/85 to-transparent" />

                  <div className="inline-flex items-center gap-1.5 text-xs text-gray-400 mt-3" style={{ fontFamily: "var(--font-landing-body)" }}>
                    <ChevronUp size={12} />
                    Completed steps slide away automatically
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-gray-400" style={{ fontFamily: "var(--font-landing-body)" }}>
                If this stays queued for more than 10 minutes, your Trigger worker is likely not dequeuing jobs.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-[#FAFAFA] p-4 lg:p-6 gap-6">
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-[calc(100vh-3rem)]">
        {/* Top bar */}
        <div
          className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0"
          style={{ borderColor: "#E5E7EB", background: "#FFFFFF" }}
        >
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: "#4B5563", fontFamily: "var(--font-landing-body)" }}
            >
              <ChevronLeft size={15} />
              Dashboard
            </Link>
            <span style={{ color: "#D1D5DB", fontSize: "14px" }}>/</span>
            <div className="flex items-center gap-2">
              <Github size={14} style={{ color: "#4B5563" }} />
              <span style={{ fontSize: "14px", color: "#4B5563", fontFamily: "var(--font-landing-body)" }}>
                {report.repo}
              </span>
            </div>
          </div>
          <div />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-4 sm:p-6">

            {/* Report Header */}
            <div
              className="p-6 rounded-3xl mb-6 shadow-sm"
              style={{ background: "#FFFFFF", border: "1px solid #E5E7EB" }}
            >
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "#FFFFFF", border: "1px solid #E5E7EB" }}
                    >
                      <Github size={18} style={{ color: "#4B5563" }} />
                    </div>
                    <div>
                      <h1
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-landing-heading)", letterSpacing: "-0.02em" }}
                      >
                        {report.repo}
                      </h1>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span style={{ fontSize: "12px", color: "#4B5563", fontFamily: "var(--font-landing-body)" }}>
                          {report.branch}
                        </span>
                        {report.commitHash && (
                          <span
                            className="font-mono"
                            style={{ fontSize: "11px", color: "#4B5563", fontFamily: "var(--font-mono)" }}
                          >
                            #{report.commitHash}
                          </span>
                        )}
                        <FrameworkBadge framework={report.framework} />
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: "#ECFDF5",
                            color: "#059669",
                            border: "1px solid rgba(64,200,122,0.3)",
                            fontFamily: "var(--font-landing-body)",
                          }}
                        >
                          Complete
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Issue summary */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {criticalCount > 0 && (
                      <span
                        className="text-xs px-2 py-1 rounded-full border font-semibold"
                        style={{
                          background: "#FEF2F2",
                          color: "#DC2626",
                          borderColor: "#FECACA",
                          fontFamily: "var(--font-landing-body)",
                        }}
                      >
                        {criticalCount} critical
                      </span>
                    )}
                    {highCount > 0 && (
                      <span
                        className="text-xs px-2 py-1 rounded-full border font-semibold"
                        style={{
                          background: "#FFF7ED",
                          color: "#EA580C",
                          borderColor: "#FED7AA",
                          fontFamily: "var(--font-landing-body)",
                        }}
                      >
                        {highCount} high
                      </span>
                    )}
                    {mediumCount > 0 && (
                      <span
                        className="text-xs px-2 py-1 rounded-full border font-semibold"
                        style={{
                          background: "#FFFBEB",
                          color: "#B45309",
                          borderColor: "#FDE68A",
                          fontFamily: "var(--font-landing-body)",
                        }}
                      >
                        {mediumCount} medium
                      </span>
                    )}
                  </div>
                </div>

                {/* Overall score */}
                <div className="flex items-center gap-4">
                  <div>
                    <p style={{ fontSize: "13px", color: "#4B5563", fontFamily: "var(--font-landing-body)", marginBottom: 4, fontWeight: 600 }}>
                      Overall Score
                    </p>
                    <p style={{ fontSize: "18px", color: report.overallScore < 50 ? "#D97706" : "#059669", fontFamily: "var(--font-landing-body)", fontWeight: 700 }}>
                      {report.overallScore < 50 ? "Needs Work" : "Good"}
                    </p>
                  </div>
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm"
                    style={{ background: "rgba(48, 121, 255, 0.1)", border: "1px solid rgba(48, 121, 255, 0.2)" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-landing-heading)",
                        fontSize: "28px",
                        color: "#3079FF",
                        lineHeight: 1,
                      }}
                    >
                      {report.overallScore}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="p-4 rounded-xl mb-6 flex items-start gap-3"
              style={{
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.25)",
              }}
            >
              <TriangleAlert size={18} className="text-amber-600 mt-0.5 shrink-0" />
              <p
                style={{
                  fontSize: "13px",
                  color: "#4B5563",
                  fontFamily: "var(--font-landing-body)",
                  lineHeight: "1.6",
                }}
              >
                Graft can make mistakes. Review important security, legal, and production decisions before applying changes.
              </p>
            </div>

            {/* Guard Score Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {(Object.entries(report.scores) as [Guard, { score: number; label: string }][]).map(([key, val]) => {
                const cfg = guardConfig[key];
                const Icon = cfg.icon;
                const guardIssues = issues.filter(i => i.guard === key);
                const criticals = guardIssues.filter(i => i.severity === "critical").length;
                const highs     = guardIssues.filter(i => i.severity === "high").length;
                const meds      = guardIssues.filter(i => i.severity === "medium").length;
                const breakdown: string[] = [];
                if (criticals > 0) breakdown.push(`${criticals} critical`);
                if (highs > 0)     breakdown.push(`${highs} high`);
                if (meds > 0)      breakdown.push(`${meds} medium`);
                return (
                  <button
                    key={key}
                    onClick={() => setActiveGuard(activeGuard === key ? "all" : key)}
                    className="relative overflow-hidden p-5 rounded-3xl text-left transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
                    style={{
                      background: activeGuard === key ? cfg.glow : "#FFFFFF",
                      border: `1px solid ${activeGuard === key ? cfg.color + "44" : "#E5E7EB"}`,
                    }}
                  >
                    <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(140px 70px at 100% 0%, ${cfg.color}15 0%, transparent 70%)` }} />
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-8 h-8 rounded-lg border flex items-center justify-center" style={{ borderColor: `${cfg.color}33`, background: `${cfg.color}12` }}>
                        <Icon size={15} style={{ color: cfg.color }} />
                      </div>
                      <ScoreRing score={val.score} color={cfg.color} size={52} />
                    </div>
                    <p style={{ fontSize: "16px", fontWeight: 700, color: "#111827", fontFamily: "var(--font-landing-heading)" }}>
                      {cfg.label.split(" ")[0]}
                    </p>
                    <p style={{ fontSize: "13px", color: cfg.color, fontFamily: "var(--font-landing-body)", fontWeight: 600, marginTop: 2 }}>
                      {val.label}
                    </p>
                    {breakdown.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {breakdown.map((item) => (
                          <span
                            key={item}
                            className="text-[11px] px-2 py-1 rounded-full border font-semibold"
                            style={{
                              background: "#FFFFFF",
                              color: "#4B5563",
                              borderColor: "#D1D5DB",
                              fontFamily: "var(--font-landing-body)",
                            }}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                    {breakdown.length === 0 && guardIssues.length === 0 && (
                      <div className="mt-3">
                        <span
                          className="text-[11px] px-2 py-1 rounded-full border font-semibold"
                          style={{
                            background: "#ECFDF5",
                            color: "#059669",
                            borderColor: "#A7F3D0",
                            fontFamily: "var(--font-landing-body)",
                          }}
                        >
                          No issues
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Fix-all Prompt Panel */}
            {(() => {
              const prompt = generateFixPrompt(issues, scan.repo, scan.framework, scan.created_at);
              return (
                <div
                  className="p-6 rounded-3xl mb-6 animate-fade-scale shadow-sm"
                  style={{
                    background: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFF 100%)",
                    border: "1px solid rgba(48, 121, 255, 0.25)",
                  }}
                >
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center">
                        <Wand2 size={15} style={{ color: "#3079FF" }} />
                      </div>
                      <span style={{ fontSize: "16px", fontWeight: 700, fontFamily: "var(--font-landing-heading)", color: "#111827" }}>
                        Fix-all prompt
                      </span>
                      <span style={{ fontSize: "13px", color: "#4B5563", fontFamily: "var(--font-landing-body)" }}>
                        Paste into Claude, Cursor, or any AI tool to fix everything at once
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(prompt);
                        setFixPromptCopied(true);
                        posthog.capture("scan_fix_prompt_copied", { issuesCount: issues.length, scanId: scan.id });
                        setTimeout(() => setFixPromptCopied(false), 2000);
                      }}
                      className="flex items-center gap-1.5 text-xs py-2 px-4 rounded-full transition-all duration-300 hover:scale-105"
                      style={{
                        background: fixPromptCopied ? "#3079FF" : "#EFF6FF",
                        color: fixPromptCopied ? "#FFFFFF" : "#2563EB",
                        border: `1px solid ${fixPromptCopied ? "#3079FF" : "#BFDBFE"}`,
                        fontFamily: "var(--font-landing-heading)",
                        fontWeight: 500,
                      }}
                    >
                      {fixPromptCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                      {fixPromptCopied ? "Copied!" : `Copy prompt (${issues.length} issues)`}
                    </button>
                  </div>
                  <pre
                    className="code-block overflow-auto"
                    style={{
                      fontSize: "12px",
                      color: "#4B5563",
                      maxHeight: "240px",
                      background: "#FFFFFF",
                      border: "1px solid #E5E7EB",
                      borderRadius: "14px",
                      padding: "16px",
                    }}
                  >
                    <code>{prompt || "No issues to fix."}</code>
                  </pre>
                </div>
              );
            })()}

            {/* Issues List */}
            <div>
              {/* Filter tabs */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveGuard("all")}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: activeGuard === "all" ? "#F3F4F6" : "transparent",
                    color: activeGuard === "all" ? "#111827" : "#9CA3AF",
                    border: `1px solid ${activeGuard === "all" ? "#D1D5DB" : "transparent"}`,
                    fontFamily: "var(--font-landing-body)",
                  }}
                >
                  All Issues
                  <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "#E5E7EB", color: "#4B5563" }}>
                    {issues.length}
                  </span>
                </button>
                {(Object.entries(guardConfig) as [Guard, typeof guardConfig[Guard]][]).map(([key, cfg]) => {
                  const count = issues.filter((i) => i.guard === key).length;
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveGuard(key)}
                      className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: activeGuard === key ? cfg.glow : "transparent",
                        color: activeGuard === key ? cfg.color : "#9CA3AF",
                        border: `1px solid ${activeGuard === key ? cfg.color + "44" : "transparent"}`,
                        fontFamily: "var(--font-landing-body)",
                      }}
                    >
                      <Icon size={12} />
                      {cfg.label.split(" ")[0]}
                      <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "#E5E7EB", color: "#4B5563" }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

                <div className="flex flex-col gap-3">
                {filteredIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    repo={scan.repo}
                    branch={scan.branch}
                    commitHash={scan.commit_hash}
                  />
                ))}
              </div>

              {filteredIssues.length === 0 && (
                <div
                  className="text-center py-12 rounded-xl"
                  style={{ background: "#FFFFFF", border: "1px solid #E5E7EB" }}
                >
                  <CheckCircle size={24} className="mx-auto mb-3" style={{ color: "#059669" }} />
                  <p style={{ fontFamily: "var(--font-landing-heading)", fontWeight: 600 }}>No issues found</p>
                  <p style={{ fontSize: "13px", color: "#4B5563", fontFamily: "var(--font-landing-body)" }}>
                    This guard is clean
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
