"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Github,
  Shield,
  Zap,
  DollarSign,
  Globe,
  ChevronLeft,
  Download,
  Share2,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Lock,
  ExternalLink,
  FileCode,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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
};

type Issue = {
  id: string;
  scan_id: string;
  guard: string;
  severity: string;
  title: string;
  description: string;
  file: string;
  line: number | null;
  fix: string;
};



type Guard = "security" | "scalability" | "monetization" | "distribution";

const guardConfig: Record<Guard, { label: string; icon: typeof Shield; color: string; glow: string }> = {
  security: { label: "Security Guard", icon: Lock, color: "var(--guard-security)", glow: "var(--guard-security-glow)" },
  scalability: { label: "Scalability Guard", icon: Zap, color: "var(--guard-scale)", glow: "var(--guard-scale-glow)" },
  monetization: { label: "Monetization Guard", icon: DollarSign, color: "var(--guard-monetize)", glow: "var(--guard-monetize-glow)" },
  distribution: { label: "Distribution Guard", icon: Globe, color: "var(--guard-distrib)", glow: "var(--guard-distrib-glow)" },
};

function ScoreRing({ score, color, size = 90 }: { score: number; color: string; size?: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
      <circle
        cx="40" cy="40" r={radius} fill="none"
        stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="40" y="46" textAnchor="middle" fill={color} fontSize="18" fontWeight="600"
        fontFamily="'EB Garamond', serif" fontStyle="italic">
        {score}
      </text>
    </svg>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <XCircle size={14} style={{ color: "var(--sev-critical)" }} />;
  if (severity === "high") return <AlertTriangle size={14} style={{ color: "var(--sev-high)" }} />;
  if (severity === "medium") return <AlertTriangle size={14} style={{ color: "var(--sev-medium)" }} />;
  return <Info size={14} style={{ color: "var(--sev-low)" }} />;
}

function IssueCard({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(issue.fix);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${issue.severity === "critical" ? "rgba(232,64,64,0.25)" : "var(--border)"}`,
        background: issue.severity === "critical" ? "rgba(232,64,64,0.04)" : "var(--surface-2)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <SeverityIcon severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-sm font-medium"
              style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.01em" }}
            >
              {issue.title}
            </span>
            <span
              className={cn("text-xs px-1.5 py-0.5 rounded", `badge-${issue.severity}`)}
              style={{ fontFamily: "var(--font-label)" }}
            >
              {issue.severity}
            </span>
          </div>
          {issue.file && (
            <div className="flex items-center gap-1.5">
              <FileCode size={11} style={{ color: "var(--text-tertiary)" }} />
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
                {issue.file}{issue.line ? `:${issue.line}` : ""}
              </span>
            </div>
          )}
        </div>
        <ChevronDown
          size={14}
          style={{
            color: "var(--text-tertiary)",
            transform: expanded ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div
            className="h-px mb-4"
            style={{ background: "var(--border)" }}
          />

          {/* Description */}
          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
          >
            {issue.description}
          </p>

          {/* Fix suggestion */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
              >
                Fix Suggestion
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded transition-all duration-150"
                style={{
                  background: copied ? "var(--guard-monetize-glow)" : "var(--surface-3)",
                  color: copied ? "var(--guard-monetize)" : "var(--text-secondary)",
                  border: `1px solid ${copied ? "rgba(64,200,122,0.3)" : "var(--border)"}`,
                  fontFamily: "var(--font-label)",
                }}
              >
                {copied ? <CheckCircle size={11} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy fix"}
              </button>
            </div>
            <pre
              className="code-block overflow-x-auto"
              style={{ fontSize: "12px", color: "var(--text-secondary)" }}
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

  useEffect(() => {
    async function fetchScanData() {
      const supabase = createClient();
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/auth/login";
        return;
      }

      // Fetch scan by ID
      const { data: scanData } = await supabase
        .from("scans")
        .select("*")
        .eq("id", scanId)
        .eq("user_id", user.id)
        .single();

      // Fetch issues for this scan
      const { data: issuesData } = await supabase
        .from("issues")
        .select("*")
        .eq("scan_id", scanId)
        .order("created_at", { ascending: false });

      setScan(scanData);
      setIssues(issuesData || []);
      setLoading(false);
    }

    fetchScanData();
  }, [scanId]);

  // Show loading
  if (loading) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </main>
      </div>
    );
  }

  // Show empty state if no scan found
  if (!scan) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-ui)" }}>
              Scan not found
            </p>
            <Link href="/dashboard" style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}>
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
  const highCount = issues.filter((i) => i.severity === "high").length;
  const mediumCount = issues.filter((i) => i.severity === "medium").length;

  // Map scan data to the format expected by the UI
  const report = {
    repo: scan.repo,
    branch: scan.branch,
    commitHash: scan.commit_hash,
    status: scan.status,
    createdAt: scan.created_at,
    overallScore: scan.overall_score,
    scores: {
      security: { score: scan.security_score, label: scan.security_score < 50 ? "Needs Work" : "Good" },
      scalability: { score: scan.scalability_score, label: scan.scalability_score < 50 ? "Needs Work" : "Good" },
      monetization: { score: scan.monetization_score, label: scan.monetization_score < 50 ? "Needs Work" : "Good" },
      distribution: { score: scan.distribution_score, label: scan.distribution_score < 50 ? "Needs Work" : "Good" },
    },
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div
          className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0"
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
            <div className="flex items-center gap-2">
              <Github size={14} style={{ color: "var(--text-tertiary)" }} />
              <span style={{ fontSize: "14px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                {report.repo}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-label)",
              }}
            >
              <Share2 size={13} />
              Share
            </button>
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-label)",
              }}
            >
              <Download size={13} />
              Export PDF
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6">

            {/* Report Header */}
            <div
              className="p-6 rounded-2xl mb-6"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--obsidian-3)", border: "1px solid var(--border)" }}
                    >
                      <Github size={18} style={{ color: "var(--text-secondary)" }} />
                    </div>
                    <div>
                      <h1
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}
                      >
                        {report.repo}
                      </h1>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                          {report.branch}
                        </span>
                        <span
                          className="font-mono"
                          style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
                        >
                          #{report.commitHash}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: "var(--guard-monetize-glow)",
                            color: "var(--guard-monetize)",
                            border: "1px solid rgba(64,200,122,0.3)",
                            fontFamily: "var(--font-label)",
                          }}
                        >
                          Complete
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Issue summary */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {criticalCount > 0 && (
                      <span className="badge-critical text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                        {criticalCount} critical
                      </span>
                    )}
                    {highCount > 0 && (
                      <span className="badge-high text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                        {highCount} high
                      </span>
                    )}
                    {mediumCount > 0 && (
                      <span className="badge-medium text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                        {mediumCount} medium
                      </span>
                    )}
                  </div>
                </div>

                {/* Overall score */}
                <div className="flex items-center gap-4">
                  <div>
                    <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginBottom: 2 }}>
                      Overall Score
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--sev-medium)", fontFamily: "var(--font-label)" }}>
                      Needs Work
                    </p>
                  </div>
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-ui)",
                        
                        fontSize: "28px",
                        color: "var(--accent)",
                        lineHeight: 1,
                      }}
                    >
                      {report.overallScore}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Guard Score Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {(Object.entries(report.scores) as [Guard, { score: number; label: string }][]).map(([key, val]) => {
                const cfg = guardConfig[key];
                const Icon = cfg.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveGuard(activeGuard === key ? "all" : key)}
                    className="p-4 rounded-xl text-left transition-all duration-200"
                    style={{
                      background: activeGuard === key ? cfg.glow : "var(--surface-2)",
                      border: `1px solid ${activeGuard === key ? cfg.color + "44" : "var(--border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <Icon size={15} style={{ color: cfg.color }} />
                      <ScoreRing score={val.score} color={cfg.color} size={52} />
                    </div>
                    <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                      {cfg.label.split(" ")[0]}
                    </p>
                    <p style={{ fontSize: "11px", color: cfg.color, fontFamily: "var(--font-label)" }}>
                      {val.label}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Issues List */}
            <div>
              {/* Filter tabs */}
              <div
                className="flex items-center gap-2 mb-4 overflow-x-auto pb-1"
              >
                <button
                  onClick={() => setActiveGuard("all")}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: activeGuard === "all" ? "var(--surface-3)" : "transparent",
                    color: activeGuard === "all" ? "var(--text-primary)" : "var(--text-tertiary)",
                    border: `1px solid ${activeGuard === "all" ? "var(--border-hover)" : "transparent"}`,
                    fontFamily: "var(--font-label)",
                  }}
                >
                  All Issues
                  <span
                    className="px-1.5 py-0.5 rounded text-xs"
                    style={{ background: "var(--obsidian-4)", color: "var(--text-secondary)" }}
                  >
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
                        color: activeGuard === key ? cfg.color : "var(--text-tertiary)",
                        border: `1px solid ${activeGuard === key ? cfg.color + "44" : "transparent"}`,
                        fontFamily: "var(--font-label)",
                      }}
                    >
                      <Icon size={12} />
                      {cfg.label.split(" ")[0]}
                      <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--obsidian-4)", color: "var(--text-secondary)" }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                {filteredIssues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>

              {filteredIssues.length === 0 && (
                <div
                  className="text-center py-12 rounded-xl"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                >
                  <CheckCircle size={24} className="mx-auto mb-3" style={{ color: "var(--guard-monetize)" }} />
                  <p style={{ fontFamily: "var(--font-ui)", fontWeight: 600 }}>No issues found</p>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
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
