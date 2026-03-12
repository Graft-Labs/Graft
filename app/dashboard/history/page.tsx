"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Github,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import { formatRelativeTime, getScoreColor } from "@/lib/utils";
import { createClient } from "@/lib/supabase";

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

function StatusIcon({ status }: { status: string }) {
  if (status === "complete") return <CheckCircle size={13} style={{ color: "var(--guard-monetize)" }} />;
  if (status === "failed") return <XCircle size={13} style={{ color: "var(--guard-security)" }} />;
  return <Clock size={13} style={{ color: "var(--accent)" }} />;
}

export default function ScanHistoryPage() {
  const [search, setSearch] = useState("");
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchScans() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        window.location.href = "/auth/login";
        return;
      }

      const { data } = await supabase
        .from("scans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setScans(data || []);
      setLoading(false);
    }

    fetchScans();
  }, []);

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

  const filtered = scans.filter((s) =>
    s.repo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}>
          <h1 className="text-base font-semibold" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
            Scan History
          </h1>
          <Link href="/scan/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}>
            New Scan
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6">
            {/* Search */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-6"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <Search size={15} style={{ color: "var(--text-tertiary)" }} />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search repositories…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }} />
            </div>

            {/* Table */}
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: "var(--surface-3)", borderBottom: "1px solid var(--border)" }}>
                    {["Repository", "Score", "Security", "Monetization", "Issues", "Date", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3"
                        style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((scan, i) => {
                    const scoreColor = getScoreColor(scan.overall_score);
                    return (
                      <tr key={scan.id}
                        className="border-b transition-colors hover:bg-white/[0.02] cursor-pointer"
                        style={{ borderColor: "var(--border)", background: i % 2 === 0 ? "var(--surface-2)" : "var(--obsidian-2)" }}
                        onClick={() => window.location.href = `/scan/${scan.id}`}>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <StatusIcon status={scan.status} />
                            <div>
                              <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.01em" }}>
                                {scan.repo}
                              </p>
                              <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                                {scan.branch}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span style={{ fontFamily: "var(--font-ui)",  fontSize: "20px", color: scoreColor }}>
                            {scan.overall_score || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full" style={{ background: "var(--obsidian-5)" }}>
                              <div style={{ width: `${scan.security_score}%`, height: "100%", background: "var(--guard-security)", borderRadius: "9999px" }} />
                            </div>
                            <span style={{ fontSize: "11px", color: "var(--guard-security)", fontFamily: "var(--font-label)" }}>{scan.security_score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full" style={{ background: "var(--obsidian-5)" }}>
                              <div style={{ width: `${scan.monetization_score}%`, height: "100%", background: "var(--guard-monetize)", borderRadius: "9999px" }} />
                            </div>
                            <span style={{ fontSize: "11px", color: "var(--guard-monetize)", fontFamily: "var(--font-label)" }}>{scan.monetization_score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5">
                            {scan.critical_count > 0 && (
                              <span className="badge-critical text-xs px-1.5 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                                {scan.critical_count}
                              </span>
                            )}
                            {scan.high_count > 0 && (
                              <span className="badge-high text-xs px-1.5 py-0.5 rounded" style={{ fontFamily: "var(--font-label)" }}>
                                {scan.high_count}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                            {formatRelativeTime(scan.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-12" style={{ background: "var(--surface-2)" }}>
                  <p style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>No scans found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
