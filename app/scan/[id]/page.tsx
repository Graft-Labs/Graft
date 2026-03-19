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
  Info,
  ChevronDown,
  Lock,
  ExternalLink,
  FileCode,
  Code,
  Wand2,
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

const guardConfig: Record<Guard, { label: string; icon: typeof Shield; color: string; glow: string }> = {
  security:     { label: "Security Guard",     icon: Lock,       color: "var(--guard-security)", glow: "var(--guard-security-glow)" },
  scalability:  { label: "Scalability Guard",  icon: Zap,        color: "var(--guard-scale)",    glow: "var(--guard-scale-glow)" },
  monetization: { label: "Monetization Guard", icon: DollarSign, color: "var(--guard-monetize)", glow: "var(--guard-monetize-glow)" },
  distribution: { label: "Distribution Guard", icon: Globe,      color: "var(--guard-distrib)",  glow: "var(--guard-distrib-glow)" },
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
    `I need you to fix the following production-readiness issues found in my codebase by ShipGuard AI.`,
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
        background: "var(--primary-glow)",
        color: "var(--primary)",
        border: "1px solid rgba(48, 121, 255, 0.2)",
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
        border: "1px solid var(--border-accent)",
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
    confirmed: { bg: "rgba(64,200,122,0.1)",  color: "var(--guard-monetize)", border: "rgba(64,200,122,0.3)",  label: "confirmed" },
    likely:    { bg: "rgba(251,191,36,0.1)",  color: "var(--landing-primary)",          border: "rgba(251,191,36,0.3)", label: "likely" },
    possible:  { bg: "rgba(107,103,98,0.15)", color: "var(--landing-text-secondary)",   border: "rgba(107,103,98,0.3)", label: "possible" },
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
      <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="7" />
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
  if (severity === "critical") return <XCircle size={14} style={{ color: "var(--sev-critical)" }} />;
  if (severity === "high")     return <AlertTriangle size={14} style={{ color: "var(--sev-high)" }} />;
  if (severity === "medium")   return <AlertTriangle size={14} style={{ color: "var(--sev-medium)" }} />;
  return <Info size={14} style={{ color: "var(--sev-low)" }} />;
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
        border: `1px solid ${issue.severity === "critical" ? "rgba(232,64,64,0.25)" : "var(--border)"}`,
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
        className="w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
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
              <FileCode size={11} style={{ color: "var(--landing-text-secondary)" }} />
              {githubFileUrl ? (
                <a
                  href={githubFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 hover:underline"
                  style={{ fontSize: "11px", color: "var(--landing-primary)", fontFamily: "var(--font-mono)", letterSpacing: 0 }}
                >
                  {issue.file}{issue.line ? `:${issue.line}` : ""}
                  <ExternalLink size={9} />
                </a>
              ) : (
                <span style={{ fontSize: "11px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
                  {issue.file}{issue.line ? `:${issue.line}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
        <ChevronDown
          size={14}
          style={{
            color: "var(--landing-text-secondary)",
            transform: expanded ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="h-px mb-4" style={{ background: "var(--border)" }} />

          {/* Description */}
          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}
          >
            {issue.description}
          </p>

          {/* Code snippet (collapsible) */}
          {issue.code_snippet && (
            <div className="mb-5">
              <button
                onClick={() => setSnippetExpanded(!snippetExpanded)}
                className="flex items-center gap-2 text-xs mb-2 transition-colors"
                style={{ color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}
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
                  style={{ fontSize: "11px", color: "var(--sev-medium)", background: "rgba(251,191,36,0.04)", borderLeft: "2px solid rgba(251,191,36,0.3)" }}
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
                style={{ color: "var(--landing-primary)", fontFamily: "var(--font-landing-body)" }}
              >
                Fix Suggestion
              </p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs py-1 px-2.5 rounded transition-all duration-150"
                style={{
                  background: copied ? "var(--guard-monetize-glow)" : "#F3F4F6",
                  color: copied ? "var(--guard-monetize)" : "var(--landing-text-secondary)",
                  border: `1px solid ${copied ? "rgba(64,200,122,0.3)" : "var(--border)"}`,
                  fontFamily: "var(--font-landing-body)",
                }}
              >
                {copied ? <CheckCircle size={11} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy fix"}
              </button>
            </div>
            <pre
              className="code-block overflow-x-auto"
              style={{ fontSize: "12px", color: "var(--landing-text-secondary)" }}
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

  useEffect(() => {
    async function fetchScanData() {
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

      setLoading(false);
    }

    fetchScanData();
  }, [scanId]);

  if (loading) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--landing-bg)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
        </main>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex min-h-screen" style={{ background: "var(--landing-bg)" }}>
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p style={{ color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-heading)" }}>
              Scan not found
            </p>
            <Link href="/dashboard" style={{ color: "var(--landing-primary)", fontFamily: "var(--font-landing-body)" }}>
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

  return (
    <div className="flex min-h-screen" style={{ background: "var(--landing-bg)" }}>
      <DashboardSidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div
          className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--landing-border)", background: "var(--landing-surface)" }}
        >
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}
            >
              <ChevronLeft size={15} />
              Dashboard
            </Link>
            <span style={{ color: "var(--border)", fontSize: "14px" }}>/</span>
            <div className="flex items-center gap-2">
              <Github size={14} style={{ color: "var(--landing-text-secondary)" }} />
              <span style={{ fontSize: "14px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}>
                {report.repo}
              </span>
            </div>
          </div>
          <div />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6">

            {/* Report Header */}
            <div
              className="p-6 rounded-2xl mb-6"
              style={{ background: "#FFFFFF", border: "1px solid var(--landing-border)" }}
            >
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--landing-surface)", border: "1px solid var(--landing-border)" }}
                    >
                      <Github size={18} style={{ color: "var(--landing-text-secondary)" }} />
                    </div>
                    <div>
                      <h1
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-landing-heading)", letterSpacing: "-0.02em" }}
                      >
                        {report.repo}
                      </h1>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span style={{ fontSize: "12px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}>
                          {report.branch}
                        </span>
                        {report.commitHash && (
                          <span
                            className="font-mono"
                            style={{ fontSize: "11px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-mono)" }}
                          >
                            #{report.commitHash}
                          </span>
                        )}
                        <FrameworkBadge framework={report.framework} />
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: "var(--guard-monetize-glow)",
                            color: "var(--guard-monetize)",
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
                  <div className="flex items-center gap-3 flex-wrap">
                    {criticalCount > 0 && (
                      <span className="badge-critical text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-landing-body)" }}>
                        {criticalCount} critical
                      </span>
                    )}
                    {highCount > 0 && (
                      <span className="badge-high text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-landing-body)" }}>
                        {highCount} high
                      </span>
                    )}
                    {mediumCount > 0 && (
                      <span className="badge-medium text-xs px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-landing-body)" }}>
                        {mediumCount} medium
                      </span>
                    )}
                  </div>
                </div>

                {/* Overall score */}
                <div className="flex items-center gap-4">
                  <div>
                    <p style={{ fontSize: "11px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)", marginBottom: 2 }}>
                      Overall Score
                    </p>
                    <p style={{ fontSize: "11px", color: report.overallScore < 50 ? "var(--sev-medium)" : "var(--guard-monetize)", fontFamily: "var(--font-landing-body)" }}>
                      {report.overallScore < 50 ? "Needs Work" : "Good"}
                    </p>
                  </div>
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ background: "rgba(48, 121, 255, 0.1)", border: "1px solid rgba(48, 121, 255, 0.2)" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-landing-heading)",
                        fontSize: "28px",
                        color: "var(--landing-primary)",
                        lineHeight: 1,
                      }}
                    >
                      {report.overallScore}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Fix-all Prompt Panel */}
            {(() => {
              const prompt = generateFixPrompt(issues, scan.repo, scan.framework, scan.created_at);
              return (
                <div
                  className="p-5 rounded-2xl mb-6 animate-fade-scale"
                  style={{ background: "#FFFFFF", border: "1px solid rgba(48, 121, 255, 0.2)" }}
                >
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Wand2 size={15} style={{ color: "var(--primary)" }} />
                      <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--font-landing-heading)", color: "var(--landing-text)" }}>
                        Fix-all prompt
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}>
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
                      className="flex items-center gap-1.5 text-xs py-1.5 px-4 rounded-lg transition-all duration-300 hover:scale-105"
                      style={{
                        background: fixPromptCopied ? "var(--primary)" : "var(--primary-glow)",
                        color: fixPromptCopied ? "var(--secondary)" : "var(--primary)",
                        border: `1px solid ${fixPromptCopied ? "var(--primary)" : "var(--landing-border)"}`,
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
                      fontSize: "11px",
                      color: "var(--landing-text-secondary)",
                      maxHeight: "240px",
                      background: "var(--landing-surface)",
                      border: "1px solid var(--landing-border)",
                    }}
                  >
                    <code>{prompt || "No issues to fix."}</code>
                  </pre>
                </div>
              );
            })()}

            <div
              className="p-3 rounded-lg mb-6"
              style={{
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.25)",
              }}
            >
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--landing-text-secondary)",
                  fontFamily: "var(--font-landing-body)",
                  lineHeight: "1.6",
                }}
              >
                ShipGuard AI can make mistakes. Review important security, legal, and production decisions before applying changes.
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
                    className="p-4 rounded-xl text-left transition-all duration-200"
                    style={{
                      background: activeGuard === key ? cfg.glow : "#F9FAFB",
                      border: `1px solid ${activeGuard === key ? cfg.color + "44" : "var(--border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <Icon size={15} style={{ color: cfg.color }} />
                      <ScoreRing score={val.score} color={cfg.color} size={52} />
                    </div>
                    <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--landing-text)", fontFamily: "var(--font-landing-body)" }}>
                      {cfg.label.split(" ")[0]}
                    </p>
                    <p style={{ fontSize: "11px", color: cfg.color, fontFamily: "var(--font-landing-body)" }}>
                      {val.label}
                    </p>
                    {breakdown.length > 0 && (
                      <p style={{ fontSize: "10px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)", marginTop: 4 }}>
                        {breakdown.join(" · ")}
                      </p>
                    )}
                    {breakdown.length === 0 && guardIssues.length === 0 && (
                      <p style={{ fontSize: "10px", color: "var(--guard-monetize)", fontFamily: "var(--font-landing-body)", marginTop: 4 }}>
                        No issues
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Issues List */}
            <div>
              {/* Filter tabs */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveGuard("all")}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: activeGuard === "all" ? "#F3F4F6" : "transparent",
                    color: activeGuard === "all" ? "var(--landing-text)" : "#9CA3AF",
                    border: `1px solid ${activeGuard === "all" ? "var(--border-hover)" : "transparent"}`,
                    fontFamily: "var(--font-landing-body)",
                  }}
                >
                  All Issues
                  <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--landing-border)", color: "var(--landing-text-secondary)" }}>
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
                      <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--landing-border)", color: "var(--landing-text-secondary)" }}>
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
                  style={{ background: "#FFFFFF", border: "1px solid var(--landing-border)" }}
                >
                  <CheckCircle size={24} className="mx-auto mb-3" style={{ color: "var(--guard-monetize)" }} />
                  <p style={{ fontFamily: "var(--font-landing-heading)", fontWeight: 600 }}>No issues found</p>
                  <p style={{ fontSize: "13px", color: "var(--landing-text-secondary)", fontFamily: "var(--font-landing-body)" }}>
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
