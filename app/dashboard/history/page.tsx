"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Github, Clock, Search, Filter, Shield, AlertTriangle, Zap, DollarSign, Globe, CheckCircle, XCircle } from "lucide-react";
import { formatRelativeTime, getScoreColor } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { getCached, setCached } from "@/lib/client-cache";

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
      className="text-xs px-2.5 py-1 rounded-full font-semibold shadow-sm inline-flex items-center gap-1.5"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}30`, fontFamily: "var(--font-landing-body)" }}
    >
      {status === 'complete' && <CheckCircle size={12} />}
      {status === 'failed' && <XCircle size={12} />}
      {status === 'scanning' && <span className="w-1.5 h-1.5 rounded-full bg-[#3079FF] animate-pulse" />}
      {s.label}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = getScoreColor(score);
  return (
    <span
      className="text-sm font-bold px-2.5 py-1 rounded-md inline-block min-w-[48px] text-center"
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

export default function ScanHistoryPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    async function fetchHistory() {
      const cached = getCached<Scan[]>("dashboard:history");
      if (cached) {
        setScans(cached);
        setLoading(false);
      }

      const supabase = createClient();
      const { data, error } = await supabase
        .from("scans")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setScans(data);
        setCached("dashboard:history", data, 45_000);
      }
      setLoading(false);
    }
    fetchHistory();
  }, []);

  const filteredScans = scans.filter((scan) => {
    const matchesSearch = scan.repo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || scan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto w-full">
      <header className="mb-10">
        <h1 
          className="text-3xl font-bold tracking-tight text-gray-900 mb-2"
          style={{ fontFamily: "var(--font-landing-heading)" }}
        >
          Scan History
        </h1>
        <p 
          className="text-gray-500 font-medium"
          style={{ fontFamily: "var(--font-landing-body)" }}
        >
          View and filter all your previous codebase scans.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search repositories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent transition-shadow shadow-sm font-medium"
            style={{ fontFamily: "var(--font-landing-body)" }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="text-gray-400" size={18} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent transition-shadow shadow-sm cursor-pointer"
            style={{ fontFamily: "var(--font-landing-body)" }}
          >
            <option value="all">All Statuses</option>
            <option value="complete">Complete</option>
            <option value="scanning">Scanning</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-200">
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>Repository</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>Status</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>Score</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>Issues</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider" style={{ fontFamily: "var(--font-landing-body)" }}>Date</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-5 bg-gray-100 rounded w-3/4"></div></td>
                    <td className="px-6 py-4"><div className="h-6 bg-gray-100 rounded-full w-24"></div></td>
                    <td className="px-6 py-4"><div className="h-8 bg-gray-100 rounded w-12"></div></td>
                    <td className="px-6 py-4"><div className="h-5 bg-gray-100 rounded w-16"></div></td>
                    <td className="px-6 py-4"><div className="h-5 bg-gray-100 rounded w-24"></div></td>
                    <td className="px-6 py-4"></td>
                  </tr>
                ))
              ) : filteredScans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                    No scans found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredScans.map((scan) => (
                  <tr key={scan.id} className="hover:bg-gray-50/50 transition-colors group cursor-pointer" onClick={() => window.location.href = `/scan/${scan.id}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                          <Github size={16} className="text-gray-700" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>{scan.repo}</p>
                          <p className="text-xs text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>{scan.branch}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={scan.status} />
                    </td>
                    <td className="px-6 py-4">
                      {scan.status === 'complete' ? <ScorePill score={scan.overall_score} /> : <span className="text-gray-400 font-medium">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      {scan.status === 'complete' ? (
                        <div className="flex gap-1.5">
                          {scan.critical_count > 0 && (
                            <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-xs font-bold border border-red-100 flex items-center gap-1">
                              {scan.critical_count} <AlertTriangle size={10} />
                            </span>
                          )}
                          {scan.high_count > 0 && (
                            <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded text-xs font-bold border border-orange-100">
                              {scan.high_count}
                            </span>
                          )}
                          {scan.critical_count === 0 && scan.high_count === 0 && (
                            <span className="text-gray-400 font-medium text-sm">None</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 font-medium whitespace-nowrap" style={{ fontFamily: "var(--font-landing-body)" }}>
                      {formatRelativeTime(scan.created_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link 
                        href={`/scan/${scan.id}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-[#3079FF] hover:border-[#3079FF] hover:bg-blue-50 transition-all shadow-sm group-hover:scale-110"
                      >
                        <ChevronRight size={16} strokeWidth={2.5} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
