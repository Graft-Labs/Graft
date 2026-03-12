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
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  FileText,
  Bell,
  LogOut,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
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
  { key: "security", label: "Security", icon: Shield, color: "var(--guard-security)" },
  { key: "scalability", label: "Scalability", icon: Zap, color: "var(--guard-scale)" },
  { key: "monetization", label: "Monetization", icon: DollarSign, color: "var(--guard-monetize)" },
  { key: "distribution", label: "Distribution", icon: Globe, color: "var(--guard-distrib)" },
];

function ScorePill({ score }: { score: number }) {
  const color = getScoreColor(score);
  return (
    <span
      className="text-sm font-semibold px-2 py-0.5 rounded"
      style={{
        background: `${color}18`,
        color: color,
        fontFamily: "var(--font-ui)",
      }}
    >
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map = {
    complete: { label: "Complete", color: "var(--guard-monetize)", bg: "var(--guard-monetize-glow)" },
    scanning: { label: "Scanning…", color: "var(--accent)", bg: "var(--accent-glow)" },
    failed: { label: "Failed", color: "var(--guard-security)", bg: "var(--guard-security-glow)" },
    pending: { label: "Pending", color: "var(--text-tertiary)", bg: "rgba(107,103,98,0.12)" },
  };
  const s = map[status as keyof typeof map] || map.pending;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}33`, fontFamily: "var(--font-label)" }}
    >
      {s.label}
    </span>
  );
}

export default function DashboardPage() {
  // State to hold our data
  const [user, setUser] = useState<User | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);

  // This runs when the page loads
  useEffect(() => {
    // Function to fetch data from Supabase
    async function loadData() {
      // Create Supabase client
      const supabase = createClient();

      // Get the currently logged-in user
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        // If not logged in, redirect to login
        window.location.href = "/auth/login";
        return;
      }

      // Fetch user profile from our users table
      const { data: userData } = await supabase
        .from("users")
        .select("*")
        .eq("id", currentUser.id)
        .single();

      // Fetch scans for this user, ordered by newest first
      const { data: scansData } = await supabase
        .from("scans")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false });

      // Update our state with the data we got
      setUser(userData);
      setScans(scansData || []);
      setLoading(false);
    }

    loadData();
  }, []);

  // Calculate stats from the real data
  const totalIssues = scans.reduce((acc, s) => acc + (s.critical_count || 0) + (s.high_count || 0), 0);
  const avgScore = scans.length > 0 
    ? Math.round(scans.reduce((acc, s) => acc + (s.overall_score || 0), 0) / scans.length)
    : 0;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div
          className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
        >
          <div>
            <h1
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}
            >
              Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="relative p-2 rounded-lg transition-colors"
              style={{ color: "var(--text-tertiary)" }}
            >
              <Bell size={17} />
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            </button>
            <Link
              href="/scan/new"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5"
              style={{
                background: "var(--accent)",
                color: "var(--obsidian)",
                fontFamily: "var(--font-ui)",
              }}
            >
              <PlusCircle size={15} />
              New Scan
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-6">

            {/* Welcome banner */}
            <div
              className="flex items-center justify-between p-6 rounded-2xl mb-6"
              style={{
                background: "linear-gradient(135deg, var(--accent-glow) 0%, var(--surface-2) 60%)",
                border: "1px solid var(--border-amber)",
              }}
            >
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
                >
                  Free Plan
                </p>
                <h2
                  className="text-2xl mb-1"
                  style={{ fontFamily: "var(--font-ui)",  }}
                >
                  Good morning, Builder
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                  You have 1 free scan remaining this month.
                </p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-2">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--obsidian-2)", border: "1px solid var(--border)" }}
                >
                  <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                    Scans used
                  </span>
                  <span style={{ fontSize: "18px", color: "var(--accent)", fontFamily: "var(--font-ui)",  }}>
                    0/1
                  </span>
                </div>
                <Link
                  href="/pricing"
                  className="text-xs font-medium"
                  style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
                >
                  Upgrade for unlimited →
                </Link>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: "Total Scans", value: scans.length, icon: FileText, color: "var(--accent)" },
                { label: "Avg. Score", value: avgScore, icon: TrendingUp, color: "var(--guard-scale)" },
                { label: "Critical Issues", value: totalIssues, icon: XCircle, color: "var(--guard-security)" },
                { label: "Issues Fixed", value: 7, icon: CheckCircle, color: "var(--guard-monetize)" },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="p-5 rounded-xl"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                        {stat.label}
                      </span>
                      <Icon size={14} style={{ color: stat.color }} />
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        
                        fontSize: "32px",
                        color: stat.color,
                        lineHeight: 1,
                      }}
                    >
                      {stat.value}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent scans */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-base font-semibold"
                  style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}
                >
                  Recent Scans
                </h2>
                <Link
                  href="/dashboard/history"
                  className="text-xs"
                  style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
                >
                  View all
                </Link>
              </div>

              <div className="flex flex-col gap-3">
                {scans.map((scan) => (
                  <Link
                    key={scan.id}
                    href={`/scan/${scan.id}`}
                    className="block group"
                  >
                    <div
                      className="p-5 rounded-xl transition-all duration-200 group-hover:border-amber-500/30"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: "var(--obsidian-3)", border: "1px solid var(--border)" }}
                          >
                            <Github size={16} style={{ color: "var(--text-tertiary)" }} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p
                                className="font-medium text-sm truncate"
                                style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.01em" }}
                              >
                                {scan.repo}
                              </p>
                              <StatusBadge status={scan.status} />
                            </div>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              {scan.branch} · {formatRelativeTime(scan.created_at)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0">
                          {/* Issue counts */}
                          <div className="hidden sm:flex items-center gap-2">
                            {(scan.critical_count || 0) > 0 && (
                              <span className="badge-critical text-xs px-1.5 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                                {scan.critical_count} critical
                              </span>
                            )}
                            {(scan.high_count || 0) > 0 && (
                              <span className="badge-high text-xs px-1.5 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                                {scan.high_count} high
                              </span>
                            )}
                          </div>

                          <ScorePill score={scan.overall_score || 0} />
                          <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} className="group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>

                      {/* Guard score bars */}
                      <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                        {guards.map((g) => {
                          // Map guard keys to database column names
                          const scoreMap: Record<string, number> = {
                            security: scan.security_score || 0,
                            scalability: scan.scalability_score || 0,
                            monetization: scan.monetization_score || 0,
                            distribution: scan.distribution_score || 0,
                          };
                          const score = scoreMap[g.key];
                          return (
                            <div key={g.key}>
                              <div className="flex items-center justify-between mb-1">
                                <span style={{ fontSize: "10px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                                  {g.label}
                                </span>
                                <span style={{ fontSize: "10px", color: g.color, fontFamily: "var(--font-ui)",  }}>
                                  {score}
                                </span>
                              </div>
                              <div className="h-1 rounded-full" style={{ background: "var(--obsidian-5)" }}>
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${score}%`, background: g.color }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Empty state CTA */}
            <div
              className="p-8 rounded-2xl text-center border-dashed"
              style={{ border: "2px dashed var(--border)", background: "var(--obsidian-1)" }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}
              >
                <PlusCircle size={22} style={{ color: "var(--accent)" }} />
              </div>
              <p
                className="font-medium mb-1"
                style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.01em" }}
              >
                Scan a new repository
              </p>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
              >
                Paste any GitHub URL and get a full production-readiness report
              </p>
              <Link
                href="/scan/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}
              >
                <Github size={15} />
                Start a scan
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
