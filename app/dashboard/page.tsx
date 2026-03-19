"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PlusCircle,
  Github,
  Clock,
  TrendingUp,
  Shield,
  Zap,
  DollarSign,
  Globe,
  CheckCircle,
  XCircle,
  ChevronRight,
  FileText,
} from "lucide-react";
import { formatRelativeTime, getScoreColor } from "@/lib/utils";
import { createClient } from "@/lib/supabase";

// Types for our database data
type Scan = {
  id: string;
  repo: string;
  branch: string;
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

type User = {
  id: string;
  email: string;
  name: string;
  plan: string;
  scans_used: number;
  scans_limit: number;
};

const guards = [
  { key: "security", label: "Security", icon: Shield, color: "#EF4444" },
  { key: "scalability", label: "Scalability", icon: Zap, color: "#3B82F6" },
  { key: "monetization", label: "Monetization", icon: DollarSign, color: "#10B981" },
  { key: "distribution", label: "Distribution", icon: Globe, color: "#8B5CF6" },
];

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs:       "Next.js",
  sveltekit:    "SvelteKit",
  nuxt:         "Nuxt.js",
  "react-vite": "React+Vite",
  express:      "Express",
  nestjs:       "NestJS",
  fastify:      "Fastify",
  react:        "React",
};

function FrameworkPill({ framework }: { framework: string | null }) {
  if (!framework || framework === "unknown") return null;
  const label = FRAMEWORK_LABELS[framework] ?? framework;
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
      style={{
        background: "#F3F4F6",
        color: "#4B5563",
        border: "1px solid #E5E7EB",
        fontFamily: "var(--font-landing-body)",
      }}
    >
      {label}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = getScoreColor(score);
  return (
    <span
      className="text-sm font-bold px-2.5 py-1 rounded-md"
      style={{
        background: `${color}15`,
        color: color,
        fontFamily: "var(--font-landing-heading)",
      }}
    >
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map = {
    complete: { label: "Complete", color: "#10B981", bg: "rgba(16, 185, 129, 0.1)" },
    scanning: { label: "Scanning…", color: "#3079FF", bg: "rgba(48, 121, 255, 0.1)" },
    failed: { label: "Failed", color: "#EF4444", bg: "rgba(239, 68, 68, 0.1)" },
    pending: { label: "Pending", color: "#6B7280", bg: "#F3F4F6" },
  };
  const s = map[status as keyof typeof map] || map.pending;
  return (
    <span
      className="text-xs px-2.5 py-1 rounded-full font-semibold shadow-sm"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}30`, fontFamily: "var(--font-landing-body)" }}
    >
      {s.label}
    </span>
  );
}

export default function Dashboard() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single();
        if (userData) setUser(userData);
      }

      const { data, error } = await supabase
        .from('scans')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && data) {
        setScans(data);
      }
      setLoading(false);
    }

    fetchData();
  }, []);

  const completedScans = scans.filter(s => s.status === 'complete');
  const avgScore = completedScans.length > 0
    ? Math.round(completedScans.reduce((acc, s) => acc + s.overall_score, 0) / completedScans.length)
    : 0;
  const totalIssues = completedScans.reduce((acc, s) => acc + s.critical_count + s.high_count, 0);

  return (
    <div className="flex-1 p-8 lg:p-10 max-w-7xl mx-auto w-full">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
        <div>
          <h1 
            className="text-3xl font-bold tracking-tight text-gray-900 mb-2"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Dashboard
          </h1>
          <p 
            className="text-gray-500 font-medium"
            style={{ fontFamily: "var(--font-landing-body)" }}
          >
            Welcome back. Here is the overview of your recent codebase scans.
          </p>
        </div>
        <Link
          href="/scan/new"
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 shadow-sm hover:shadow-md"
          style={{
            background: "var(--landing-primary)",
            color: "#FFFFFF",
            fontFamily: "var(--font-landing-body)",
          }}
        >
          <PlusCircle size={18} strokeWidth={2.5} />
          New Scan
        </Link>
      </header>

      {/* Quick Stats */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Scans", value: scans.length, icon: FileText, color: "#3079FF", bg: "rgba(48, 121, 255, 0.1)" },
            { label: "Avg. Score", value: avgScore, icon: TrendingUp, color: "#3B82F6", bg: "rgba(59, 130, 246, 0.1)" },
            { label: "Critical Issues", value: totalIssues, icon: XCircle, color: "#EF4444", bg: "rgba(239, 68, 68, 0.1)" },
            { label: "Completed Scans", value: completedScans.length, icon: CheckCircle, color: "#10B981", bg: "rgba(16, 185, 129, 0.1)" },
          ].map((stat, i) => (
            <div 
              key={i} 
              className="p-5 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-start justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block" style={{ fontFamily: "var(--font-landing-body)" }}>
                  {stat.label}
                </span>
                <span className="text-3xl font-bold text-gray-900 tracking-tight" style={{ fontFamily: "var(--font-landing-heading)" }}>
                  {stat.value}
                </span>
              </div>
              <div className="p-2.5 rounded-xl" style={{ background: stat.bg, color: stat.color }}>
                <stat.icon size={22} strokeWidth={2.5} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Scans */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 
            className="text-xl font-bold text-gray-900 tracking-tight"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Recent Scans
          </h2>
          {scans.length > 0 && (
            <Link 
              href="/dashboard/history" 
              className="text-sm font-semibold text-[#3079FF] hover:underline flex items-center gap-1"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              View all
              <ChevronRight size={14} strokeWidth={2.5} />
            </Link>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-white border border-gray-100 shadow-sm animate-pulse" />
            ))}
          </div>
        ) : scans.length === 0 ? (
          <div className="text-center py-20 rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50">
            <div className="w-16 h-16 mx-auto bg-white border border-gray-200 rounded-full flex items-center justify-center mb-4 shadow-sm">
              <PlusCircle size={28} className="text-gray-400" />
            </div>
            <h3 
              className="text-lg font-bold text-gray-900 mb-2"
              style={{ fontFamily: "var(--font-landing-heading)" }}
            >
              No scans yet
            </h3>
            <p 
              className="text-gray-500 mb-6 max-w-sm mx-auto font-medium"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              Connect your GitHub repository to run your first production-readiness scan.
            </p>
            <Link
              href="/scan/new"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 shadow-sm hover:shadow-md"
              style={{ background: "var(--landing-primary)", color: "#FFFFFF", fontFamily: "var(--font-landing-body)" }}
            >
              Start First Scan
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {scans.map((scan) => (
              <Link 
                key={scan.id} 
                href={`/scan/${scan.id}`}
                className="group block bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 hover:shadow-md transition-all duration-200"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Repo info */}
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0">
                      <Github size={24} className="text-gray-700" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h3 className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                          {scan.repo}
                        </h3>
                        <FrameworkPill framework={scan.framework} />
                        {scan.status === 'complete' && <ScorePill score={scan.overall_score} />}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                        <span className="flex items-center gap-1">
                          <Clock size={14} />
                          {formatRelativeTime(scan.created_at)}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                        <span className="truncate max-w-[200px]">Branch: {scan.branch}</span>
                        {scan.status === 'complete' && (scan.critical_count > 0 || scan.high_count > 0) && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-gray-300" />
                            <div className="flex gap-1.5">
                              {scan.critical_count > 0 && (
                                <span className="bg-red-50 text-red-600 px-1.5 rounded font-semibold text-xs border border-red-100">
                                  {scan.critical_count} CRIT
                                </span>
                              )}
                              {scan.high_count > 0 && (
                                <span className="bg-orange-50 text-orange-600 px-1.5 rounded font-semibold text-xs border border-orange-100">
                                  {scan.high_count} HIGH
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status & Chevron */}
                  <div className="flex items-center gap-4 md:ml-auto">
                    <StatusBadge status={scan.status} />
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-50 group-hover:bg-[#3079FF] group-hover:text-white transition-colors text-gray-400">
                      <ChevronRight size={18} strokeWidth={2.5} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>

                {/* Expanded Grid for Complete Scans */}
                {scan.status === 'complete' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
                    {guards.map(g => (
                      <div key={g.key}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>
                            {g.label}
                          </span>
                          <span className="text-xs font-bold" style={{ color: g.color, fontFamily: "var(--font-landing-heading)" }}>
                            {scan[`${g.key}_score` as keyof Scan]}/100
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-1000"
                            style={{ 
                              width: `${scan[`${g.key}_score` as keyof Scan]}%`,
                              background: g.color
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
