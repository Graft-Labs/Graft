"use client";

import { useState } from "react";
import { Github, Link2, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { clearCacheByPrefix } from "@/lib/client-cache";

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

export default function IntegrationsTab({ hasGithubToken }: { hasGithubToken: boolean }) {
  const [busy, setBusy] = useState(false);

  const connectGithub = async () => {
    setBusy(true);

    clearCacheByPrefix("dashboard:");
    clearCacheByPrefix("scan:");

    if (typeof document !== "undefined") {
      document.cookie = "shipguard_next=%2Fdashboard%2Fsettings; Path=/; Max-Age=600; SameSite=Lax";
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: getAuthRedirectUrl(),
        scopes: "repo read:org user:email",
      },
    });

    if (error) {
      setBusy(false);
      alert(error.message);
    }
  };

  const disconnectGithub = async () => {
    setBusy(true);
    try {
      clearCacheByPrefix("dashboard:");
      clearCacheByPrefix("scan:");
      await fetch("/api/github/disconnect", { method: "POST" });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-heading)" }}>
        Integrations
      </h2>
      <p className="text-sm text-gray-500 mb-6 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
        Connect providers to unlock repository scans and richer analysis.
      </p>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
              <Github className="text-gray-800" size={22} />
            </div>
            <div>
              <p className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>GitHub</p>
              <p className="text-sm text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                {hasGithubToken ? "Connected. Repo picker is enabled." : "Connect GitHub to scan repositories."}
              </p>
            </div>
          </div>

          {hasGithubToken ? (
            <button
              onClick={disconnectGithub}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              <Unlink size={16} />
              Disconnect
            </button>
          ) : (
            <button
              onClick={connectGithub}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {busy ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Link2 size={16} />}
              Connect GitHub
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
