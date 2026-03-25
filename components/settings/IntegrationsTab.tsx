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

type IntegrationsTabProps = {
  hasGithubConnected: boolean;
  hasGoogleConnected: boolean;
};

export default function IntegrationsTab({ hasGithubConnected: _hasGithubConnected, hasGoogleConnected: _hasGoogleConnected }: IntegrationsTabProps) {
  const [busy, setBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const router = useRouter();

  // Always fetch fresh from DB - don't rely on props (they may be cached/stale)
  useEffect(() => {
    async function checkConnections() {
      setCheckingConnection(true);
      const supabase = createClient();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCheckingConnection(false);
        return;
      }
      
      // Check current session identities (most reliable)
      const { data: identityData } = await supabase.auth.getUserIdentities();
      const identities = identityData?.identities ?? [];
      const hasGithubIdentity = identities.some((i) => i.provider === "github");
      const hasGoogleIdentity = identities.some((i) => i.provider === "google");
      
      // Check DB for github_user_id only (github_token can be polluted with other OAuth tokens)
      const { data: userData } = await supabase
        .from("users")
        .select("github_user_id")
        .eq("id", user.id)
        .single();
      
      // Connected if: has GitHub identity in session OR github_user_id is set in DB
      // Don't use github_token as it may contain other OAuth providers' tokens
      setGithubConnected(!!(hasGithubIdentity || userData?.github_user_id));
      setGoogleConnected(!!hasGoogleIdentity);
      setCheckingConnection(false);
    }
    
    checkConnections();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('integration_error')
    if (err === 'github_already_linked') {
      setConflictError(
        "This GitHub account is already connected to another Graft account. Please disconnect it from that account first, or use a different GitHub account."
      )
    } else if (err === 'google_already_linked') {
      setConflictError(
        "This Google account is already connected to another Graft account. Please disconnect it from that account first, or use a different Google account."
      )
    } else if (err === 'oauth_user_mismatch') {
      setConflictError(
        "Connection failed because the OAuth callback returned a different account session. Please sign in to the intended account and try again."
      )
    } else if (err === 'github_oauth_failed') {
      setConflictError(
        "GitHub connection failed. Please try again. If this keeps happening, sign out and back in before reconnecting GitHub."
      )
    } else if (err === 'google_oauth_failed') {
      setConflictError(
        "Google connection failed. Please try again. If this keeps happening, sign out and back in before reconnecting Google."
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

  const connectProvider = async (provider: "github" | "google") => {
    setBusy(true);
    setConflictError(null);

    clearCacheByPrefix("dashboard:");
    clearCacheByPrefix("scan:");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setBusy(false);
      setConflictError("You must be signed in to connect an integration.");
      return;
    }

    if (provider === "github" && githubConnected) {
      setBusy(false);
      setConflictError("GitHub is already connected to this account.");
      return;
    }

    if (provider === "google" && googleConnected) {
      setBusy(false);
      setConflictError("Google is already connected to this account.");
      return;
    }

    if (typeof document !== "undefined") {
      document.cookie = "graft_next=%2Fdashboard%2Fsettings%3Ftab%3Dintegrations; Path=/; Max-Age=600; SameSite=Lax";
      document.cookie = `graft_connecting_provider=${provider}; Path=/; Max-Age=600; SameSite=Lax`;
      document.cookie = `graft_connecting_user_id=${encodeURIComponent(user.id)}; Path=/; Max-Age=600; SameSite=Lax`;
      document.cookie = "shipguard_next=%2Fdashboard%2Fsettings%3Ftab%3Dintegrations; Path=/; Max-Age=600; SameSite=Lax";
      document.cookie = `shipguard_connecting_provider=${provider}; Path=/; Max-Age=600; SameSite=Lax`;
      document.cookie = `shipguard_connecting_user_id=${encodeURIComponent(user.id)}; Path=/; Max-Age=600; SameSite=Lax`;
    }

    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: getAuthRedirectUrl(),
        ...(provider === "github" ? { scopes: "repo read:org user:email" } : {}),
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
    setConflictError(`Could not start ${provider === "github" ? "GitHub" : "Google"} connection. Please try again.`);
  };

  const disconnectProvider = async (provider: "github" | "google") => {
    setBusy(true);
    setConflictError(null);
    try {
      clearCacheByPrefix("dashboard:");
      clearCacheByPrefix("scan:");
      const res = await fetch("/api/integrations/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setConflictError(
          body?.message || "Could not disconnect this integration right now. Please try again."
        );
        return;
      }
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

      {checkingConnection ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
              <Github className="text-gray-800" size={22} />
            </div>
            <div>
              <p className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>GitHub</p>
              <p className="text-sm text-gray-400 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                Checking connection...
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
                <Github className="text-gray-800" size={22} />
              </div>
              <div>
                <p className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>GitHub</p>
                <p className="text-sm text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                  {githubConnected ? "Connected. Repo picker is enabled." : "Connect GitHub to scan repositories."}
                </p>
              </div>
            </div>

            {githubConnected ? (
              <button
                onClick={() => disconnectProvider("github")}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                <Unlink size={16} />
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => connectProvider("github")}
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
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm mt-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
              <span className="text-sm font-bold text-gray-700" style={{ fontFamily: "var(--font-landing-body)" }}>G</span>
            </div>
            <div>
              <p className="font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>Google</p>
              <p className="text-sm text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                {googleConnected ? "Connected for sign-in." : "Connect Google as an additional sign-in method."}
              </p>
            </div>
          </div>

          {googleConnected ? (
            <button
              onClick={() => disconnectProvider("google")}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              <Unlink size={16} />
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => connectProvider("google")}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {busy ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Link2 size={16} />}
              Connect Google
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
