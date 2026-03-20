"use client";

import { useState, useEffect } from "react";
import { Github, Link2, Unlink, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { clearCacheByPrefix } from "@/lib/client-cache";
import { useRouter } from "next/navigation";

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

export default function IntegrationsTab({ hasGithubToken }: { hasGithubToken: boolean }) {
  const [busy, setBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('integration_error')
    if (err === 'github_already_linked') {
      setConflictError(
        "This GitHub account is already connected to another ShipGuard account. Please disconnect it from that account first, or use a different GitHub account."
      )
    } else if (err === 'oauth_user_mismatch') {
      setConflictError(
        "GitHub connection failed because the OAuth callback returned a different account session. Please sign in to the intended account and try again."
      )
    } else if (err === 'github_oauth_failed') {
      setConflictError(
        "GitHub connection failed. Please try again. If this keeps happening, sign out and back in before reconnecting GitHub."
      )
    }

    if (err) {
      const clean = new URLSearchParams(window.location.search)
      clean.delete('integration_error')
      if (!clean.get('tab')) {
        clean.set('tab', 'integrations')
      }
      router.replace(`/dashboard/settings?${clean.toString()}`, { scroll: false })
    }
  }, [router])

  const connectGithub = async () => {
    setBusy(true);
    setConflictError(null);

    clearCacheByPrefix("dashboard:");
    clearCacheByPrefix("scan:");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setBusy(false);
      setConflictError("You must be signed in to connect GitHub.");
      return;
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("github_user_id")
      .eq("id", user.id)
      .single();

    if (currentUser?.github_user_id) {
      setBusy(false);
      setConflictError("GitHub is already connected to this account.");
      return;
    }

    if (typeof document !== "undefined") {
      document.cookie = "shipguard_next=%2Fdashboard%2Fsettings%3Ftab%3Dintegrations; Path=/; Max-Age=600; SameSite=Lax";
      document.cookie = "shipguard_connecting_github=1; Path=/; Max-Age=600; SameSite=Lax";
      document.cookie = `shipguard_connecting_user_id=${encodeURIComponent(user.id)}; Path=/; Max-Age=600; SameSite=Lax`;
    }

    const { data, error } = await supabase.auth.linkIdentity({
      provider: "github",
      options: {
        redirectTo: getAuthRedirectUrl(),
        scopes: "repo read:org user:email",
      },
    });

    if (error) {
      setBusy(false);
      setConflictError(error.message);
      return;
    }

    if (data?.url) {
      window.location.assign(data.url);
      return;
    }

    setBusy(false);
    setConflictError("Could not start GitHub connection. Please try again.");
  };

  const disconnectGithub = async () => {
    setBusy(true);
    setConflictError(null);
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

      {conflictError && (
        <div className="mb-4 flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700 font-medium leading-relaxed" style={{ fontFamily: "var(--font-landing-body)" }}>
            {conflictError}
          </p>
        </div>
      )}

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
