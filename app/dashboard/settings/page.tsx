"use client";

import { useCallback, useEffect, useState } from "react";
import {
  User,
  CreditCard,
  CheckCircle,
  Link2,
  AlertTriangle,
  LifeBuoy,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import IntegrationsTab from "@/components/settings/IntegrationsTab";
import { getCached, setCached } from "@/lib/client-cache";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

type UserData = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  plan: string | null;
  scans_used: number | null;
  scans_limit: number | null;
  github_token: string | null;
  github_user_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  customer_id: string | null;
};

type CachedData = {
  user: {
    email?: string;
    app_metadata?: { provider?: string };
    user_metadata?: {
      full_name?: string;
      name?: string;
      avatar_url?: string;
      picture?: string;
    };
    identities?: Array<{ provider?: string }>;
  } | null;
  userData: UserData | null;
  fullName: string;
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("profile");
  const [user, setUser] = useState<{
    email?: string;
    app_metadata?: { provider?: string };
    user_metadata?: {
      full_name?: string;
      name?: string;
      avatar_url?: string;
      picture?: string;
    };
    identities?: Array<{ provider?: string }>;
  } | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);

  // Profile Form State
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(
    null,
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [cancelingSubscription, setCancelingSubscription] = useState(false);
  const [uncancelingSubscription, setUncancelingSubscription] = useState(false);
  const [cancelSubscriptionError, setCancelSubscriptionError] = useState<
    string | null
  >(null);
  const [cancelSubscriptionSuccess, setCancelSubscriptionSuccess] = useState<
    string | null
  >(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const openBillingPortal = async () => {
    const response = await fetch("/api/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.message || data?.error || "Failed to open billing portal",
      );
    }

    if (!data?.url) throw new Error("No portal URL returned.");
    window.location.href = data.url;
  };

  const startCheckout = async (planId: "pro" | "unlimited") => {
    try {
      setCheckoutLoading(planId);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        if (response.status === 409) {
          window.location.href = "/dashboard/settings?tab=billing";
          return;
        }
        throw new Error(data?.message || data?.error || "Failed to start checkout");
      }

      if (data?.isPortal !== true && userData?.subscription_status === "active") {
        throw new Error("Could not open billing portal for your active subscription.");
      }

      if (!data?.url) throw new Error("No checkout URL returned.");
      window.location.href = data.url;
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "Unable to start checkout right now.");
      setCheckoutLoading(null);
    }
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    const integrationError = searchParams.get("integration_error");
    const upgradeSuccess = searchParams.get("upgrade");
    if (upgradeSuccess === "success") {
      setActiveTab("billing");
      async function syncAndShowSuccess() {
        const sleep = (ms: number) =>
          new Promise((resolve) => window.setTimeout(resolve, ms));

        try {
          const supabase = createClient();

          for (let attempt = 0; attempt < 6; attempt += 1) {
            await fetch("/api/subscription/sync", { method: "POST" });

            const {
              data: { user: currentUser },
            } = await supabase.auth.getUser();

            if (currentUser) {
              const { data } = await supabase
                .from("users")
                .select("*")
                .eq("id", currentUser.id)
                .single();

              if (data) {
                setUserData(data);
                setCached(
                  "settings:data",
                  {
                    user: currentUser,
                    userData: data,
                    fullName: data?.name || currentUser?.user_metadata?.full_name || "",
                  },
                  60_000,
                );

                if (data.subscription_id || (data.plan && data.plan !== "free")) {
                  break;
                }
              }
            }

            await sleep(1500);
          }
        } catch (err) {
          console.error("Failed to sync subscription:", err);
        }
        setShowUpgradeSuccess(true);
      }
      syncAndShowSuccess();
      const url = new URL(window.location.href);
      url.searchParams.delete("upgrade");
      window.history.replaceState({}, "", url.pathname + url.search);
    } else if (
      tab &&
      ["profile", "integrations", "support", "billing"].includes(tab)
    ) {
      setActiveTab(tab);
    } else if (integrationError) {
      setActiveTab("integrations");
    }
  }, [searchParams]);

  useEffect(() => {
    if (showUpgradeSuccess) {
      const timer = setTimeout(() => setShowUpgradeSuccess(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [showUpgradeSuccess]);

  useEffect(() => {
    async function loadData() {
      const cached = getCached<CachedData>("settings:data");
      if (cached) {
        setUser(cached.user);
        setUserData(cached.userData);
        setFullName(cached.fullName);
        setLoading(false);
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", user.id)
          .single();

        setUserData(data);
        if (data?.name) setFullName(data.name);
        else if (user?.user_metadata?.full_name)
          setFullName(user.user_metadata.full_name);

        setCached(
          "settings:data",
          {
            user,
            userData: data,
            fullName: data?.name || user?.user_metadata?.full_name || "",
          },
          60_000,
        );
      }
      setLoading(false);
    }
    loadData();
  }, []);

  const loadSubscriptionStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/subscription/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const body = await res.json().catch(() => null);
      if (!res.ok || !body) return;

      const nextStatus =
        typeof body.subscriptionStatus === "string"
          ? body.subscriptionStatus
          : null;
      const periodEnd =
        typeof body.currentPeriodEnd === "string" ? body.currentPeriodEnd : null;

      if (nextStatus) {
        setUserData((prev) =>
          prev
            ? {
                ...prev,
                subscription_status: nextStatus,
              }
            : prev,
        );
      }

      const supabase = createClient();
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (currentUser) {
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", currentUser.id)
          .single();

        if (data) {
          setUserData(data);
          setCached(
            "settings:data",
            {
              user: currentUser,
              userData: data,
              fullName: data?.name || currentUser?.user_metadata?.full_name || "",
            },
            60_000,
          );
        }
      }

      setCurrentPeriodEnd(periodEnd);
    } catch (error) {
      console.error("Failed to load subscription status", error);
    }
  }, []);

  useEffect(() => {
    loadSubscriptionStatus();
  }, [loadSubscriptionStatus]);

  useEffect(() => {
    if (activeTab !== "billing") return;

    loadSubscriptionStatus();

    const intervalId = window.setInterval(() => {
      loadSubscriptionStatus();
    }, 10000);

    const handleFocus = () => {
      loadSubscriptionStatus();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [activeTab, loadSubscriptionStatus]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Update auth metadata
        await supabase.auth.updateUser({
          data: { full_name: fullName },
        });

        // Update users table
        await supabase
          .from("users")
          .update({ name: fullName })
          .eq("id", user.id);

        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error("Error updating profile", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    setDeleteAccountError(null);

    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setDeleteAccountError(
          body?.message ||
            "Could not delete account right now. Please try again.",
        );
        return;
      }

      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.assign("/");
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelingSubscription(true);
    setCancelSubscriptionError(null);
    setCancelSubscriptionSuccess(null);

    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setCancelSubscriptionError(
          body?.message ||
            "Could not cancel your subscription right now. Please try again.",
        );
        return;
      }

      const periodEnd = (body?.currentPeriodEnd ||
        body?.subscription?.current_period_end) as
        | string
        | undefined;
      const nextStatus =
        typeof body?.subscriptionStatus === "string"
          ? body.subscriptionStatus
          : "cancelled";
      const formattedPeriodEnd = periodEnd
        ? new Date(periodEnd).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : null;

      setCancelSubscriptionSuccess(null);
      setCurrentPeriodEnd(periodEnd ?? null);

      setUserData((prev) =>
        prev
          ? {
              ...prev,
              subscription_status: nextStatus,
            }
          : prev,
      );

      loadSubscriptionStatus();
    } finally {
      setCancelingSubscription(false);
    }
  };

  const handleUncancelSubscription = async () => {
    setUncancelingSubscription(true);
    setCancelSubscriptionError(null);
    setCancelSubscriptionSuccess(null);

    try {
      const res = await fetch("/api/subscription/uncancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 500) {
          try {
            await openBillingPortal();
            return;
          } catch {
            // fall through to error message below
          }
        }

        setCancelSubscriptionError(
          body?.message ||
            "Could not keep your subscription active right now. Please try again.",
        );
        return;
      }

      const nextStatus =
        typeof body?.subscriptionStatus === "string"
          ? body.subscriptionStatus
          : "active";

      setCancelSubscriptionSuccess("Cancellation removed. Your plan stays active.");
      setCurrentPeriodEnd(null);

      setUserData((prev) =>
        prev
          ? {
              ...prev,
              subscription_status: nextStatus,
            }
          : prev,
      );

      loadSubscriptionStatus();
    } finally {
      setUncancelingSubscription(false);
    }
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "integrations", label: "Integrations", icon: Link2 },
    { id: "support", label: "Support", icon: LifeBuoy },
    { id: "billing", label: "Billing", icon: CreditCard },
  ];

  const hasGithubIdentity = Boolean(
    user?.app_metadata?.provider === "github" ||
    user?.identities?.some((identity) => identity.provider === "github"),
  );

  const hasGithubConnected = Boolean(
    userData?.github_token || userData?.github_user_id || hasGithubIdentity,
  );

  const hasGoogleConnected = Boolean(
    user?.app_metadata?.provider === "google" ||
    user?.identities?.some((identity) => identity.provider === "google"),
  );

  const cancellationScheduled =
    userData?.subscription_status === "cancelled" ||
    userData?.subscription_status === "canceled";

  const effectivePlan =
    userData?.plan === "pro" || userData?.plan === "unlimited"
      ? userData.plan
      : "free";

  const formattedCurrentPeriodEnd = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto w-full">
      <header className="mb-10">
        <h1
          className="text-3xl font-bold tracking-tight text-gray-900 mb-2"
          style={{ fontFamily: "var(--font-landing-heading)" }}
        >
          Settings
        </h1>
        <p
          className="text-gray-500 font-medium"
          style={{ fontFamily: "var(--font-landing-body)" }}
        >
          Manage your account settings and preferences.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-64 shrink-0">
          <nav className="flex flex-col gap-1.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-left ${
                    isActive
                      ? "bg-white shadow-sm ring-1 ring-gray-900/5 text-gray-900"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                  style={{ fontFamily: "var(--font-landing-body)" }}
                >
                  <Icon
                    size={18}
                    strokeWidth={isActive ? 2.5 : 2}
                    className={isActive ? "text-[#3079FF]" : "text-gray-400"}
                  />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
              <div className="animate-pulse space-y-6">
                <div className="h-6 bg-gray-100 rounded w-1/4"></div>
                <div className="h-10 bg-gray-100 rounded w-full"></div>
                <div className="h-10 bg-gray-100 rounded w-full"></div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* --- PROFILE TAB --- */}
              {activeTab === "profile" && (
                <div className="p-8">
                  <h2
                    className="text-xl font-bold text-gray-900 mb-6"
                    style={{ fontFamily: "var(--font-landing-heading)" }}
                  >
                    Profile Settings
                  </h2>

                  {/* Avatar Section */}
                  <div className="flex items-center gap-6 mb-8 pb-8 border-b border-gray-100">
                    <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 shrink-0 overflow-hidden">
                      {userData?.avatar_url ||
                      user?.user_metadata?.avatar_url ||
                      user?.user_metadata?.picture ? (
                        <Image
                          src={
                            userData?.avatar_url ||
                            user?.user_metadata?.avatar_url ||
                            user?.user_metadata?.picture ||
                            ""
                          }
                          alt="Avatar"
                          width={80}
                          height={80}
                          className="w-full h-full rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <User size={32} />
                      )}
                    </div>
                    <div>
                      <p
                        className="text-sm font-bold text-gray-900"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Profile Picture
                      </p>
                      <p
                        className="text-xs text-gray-500 font-medium mt-1"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Avatar is synced from your login provider.
                      </p>
                    </div>
                  </div>

                  {/* Account ID - under avatar, above name */}
                  {userData?.customer_id && (
                    <div className="mb-6 max-w-md">
                      <p
                        className="text-xs text-gray-500 mb-1"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Account ID
                      </p>
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-700 break-all">
                        {userData.customer_id}
                      </code>
                    </div>
                  )}

                  {/* Email */}
                  {(userData?.email || user?.email) && (
                    <div className="mb-8 max-w-md">
                      <p
                        className="text-xs text-gray-500 mb-1"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Email
                      </p>
                      <p className="text-sm text-gray-700 font-medium">
                        {userData?.email || user?.email}
                      </p>
                    </div>
                  )}

                  {/* Form */}
                  <form
                    onSubmit={handleSaveProfile}
                    className="space-y-6 max-w-md"
                  >
                    <div>
                      <label
                        className="block text-sm font-bold text-gray-900 mb-2"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent transition-shadow shadow-sm font-medium"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      />
                    </div>
                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={saving}
                        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-semibold transition-all duration-200 shadow-sm ${
                          saved
                            ? "bg-green-100 text-green-700"
                            : "bg-black text-white hover:bg-gray-800 hover:-translate-y-0.5 hover:shadow-md"
                        }`}
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        {saving ? (
                          "Saving..."
                        ) : saved ? (
                          <>
                            <CheckCircle size={16} /> Saved
                          </>
                        ) : (
                          "Save Changes"
                        )}
                      </button>
                    </div>
                  </form>

                  <div className="mt-10 pt-8 border-t border-red-100 max-w-md">
                    <h3
                      className="text-base font-bold text-red-700 mb-2"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      Danger Zone
                    </h3>
                    <p
                      className="text-sm text-gray-600 mb-4"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      Permanently delete your account and all associated scans
                      and issues. This action cannot be undone.
                    </p>
                    {deleteAccountError && (
                      <p
                        className="text-sm text-red-600 mb-3"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        {deleteAccountError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteAccountError(null);
                        setDeleteConfirmText("");
                        setShowDeleteDialog(true);
                      }}
                      disabled={deletingAccount}
                      className="inline-flex items-center justify-center px-5 py-2.5 rounded-full border border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      {deletingAccount
                        ? "Deleting Account..."
                        : "Delete Account"}
                    </button>
                  </div>
                </div>
              )}

              {/* --- INTEGRATIONS TAB --- */}
              {activeTab === "integrations" && (
                <IntegrationsTab
                  hasGithubConnected={hasGithubConnected}
                  hasGoogleConnected={hasGoogleConnected}
                />
              )}

              {/* --- BILLING TAB --- */}
              {activeTab === "billing" && (
                <div className="p-8">
                  {showUpgradeSuccess && (
                    <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-2xl flex items-start gap-3">
                      <CheckCircle
                        size={20}
                        className="text-green-600 shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-green-800">
                          Upgrade successful! Welcome to your new plan.
                        </p>
                        <p className="text-xs text-green-700 mt-0.5">
                          Your plan has been updated and your new scan limits
                          are active.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowUpgradeSuccess(false)}
                        className="text-green-600 hover:text-green-800 shrink-0"
                        aria-label="Dismiss"
                      >
                        <span className="text-lg leading-none">&times;</span>
                      </button>
                    </div>
                  )}
                  <h2
                    className="text-xl font-bold text-gray-900 mb-6"
                    style={{ fontFamily: "var(--font-landing-heading)" }}
                  >
                    Billing & Plan
                  </h2>

                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 mb-8 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h3
                            className="text-lg font-bold text-gray-900"
                            style={{
                              fontFamily: "var(--font-landing-heading)",
                            }}
                          >
                            {effectivePlan === "pro"
                              ? "Pro Plan"
                              : effectivePlan === "unlimited"
                                ? "Unlimited Plan"
                                : "Free Plan"}
                          </h3>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-100 text-blue-700 border border-blue-200">
                            Active
                          </span>
                        </div>
                        <p
                          className="text-sm text-gray-500 font-medium"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          You are currently on the {effectivePlan}{" "}
                          plan.
                        </p>
                      </div>
                      {effectivePlan === "free" ? (
                        <div className="w-full md:w-auto grid grid-cols-1 sm:grid-cols-2 gap-2 md:max-w-[26rem]">
                          <button
                            onClick={() => startCheckout("pro")}
                            disabled={checkoutLoading === "pro"}
                            className="inline-flex h-9 w-full items-center justify-center px-4 py-2 bg-black text-white rounded-full text-xs font-semibold hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-70"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            {checkoutLoading === "pro" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Upgrade to Pro
                          </button>
                          <button
                            onClick={() => startCheckout("unlimited")}
                            disabled={checkoutLoading === "unlimited"}
                            className="inline-flex h-9 w-full items-center justify-center px-4 py-2 border border-[#3079FF] text-[#3079FF] rounded-full text-xs font-semibold hover:bg-[#3079FF]/5 transition-colors shadow-sm disabled:opacity-70"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            {checkoutLoading === "unlimited" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Upgrade to Unlimited
                          </button>
                        </div>
                      ) : effectivePlan === "pro" ? (
                        <button
                          onClick={() => startCheckout("unlimited")}
                          disabled={checkoutLoading === "unlimited"}
                          className="inline-flex h-9 px-4 py-2 bg-black text-white rounded-full text-xs font-semibold hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-70"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {checkoutLoading === "unlimited" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                          Upgrade to Unlimited
                        </button>
                      ) : (
                        <span className="inline-flex px-5 py-2.5 text-gray-500 text-sm font-medium">
                          You are on the highest plan
                        </span>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div
                        className="flex justify-between text-sm font-bold text-gray-900 mb-2"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        <span>Scans Used</span>
                        <span>
                          {userData?.scans_used ?? 0} /{" "}
                          {(userData?.scans_limit ?? 3) >= 999999
                            ? "Unlimited"
                            : (userData?.scans_limit ?? 3)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-[#3079FF] rounded-full transition-all duration-1000"
                          style={{
                            width:
                              (userData?.scans_limit ?? 3) >= 999999
                                ? "100%"
                                : `${Math.min(100, ((userData?.scans_used ?? 0) / (userData?.scans_limit ?? 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      {(userData?.scans_limit ?? 3) < 999999 &&
                        (userData?.scans_used ?? 0) >=
                          (userData?.scans_limit ?? 3) && (
                          <p className="text-xs text-red-600 font-bold flex items-center gap-1 mt-2">
                            <AlertTriangle size={12} />
                            You have reached your scan limit. Please upgrade to
                            continue.
                          </p>
                        )}
                    </div>


                  </div>

                  {/* Cancel Subscription */}
                  {(effectivePlan === "pro" || effectivePlan === "unlimited") && (
                    <div className="border border-gray-200 rounded-2xl p-6">
                      <h3
                        className="text-base font-bold text-gray-900 mb-2"
                        style={{ fontFamily: "var(--font-landing-heading)" }}
                      >
                        Cancel Subscription
                      </h3>
                      <p
                        className="text-sm text-gray-500 mb-4"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Need to take a break? You can cancel your subscription
                        anytime. You will keep premium access until the end of your
                        current billing period.
                      </p>

                      {cancellationScheduled && (
                        <p
                          className="text-sm text-amber-700 mb-3"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {formattedCurrentPeriodEnd
                            ? `Cancellation scheduled. Your subscription will end on ${formattedCurrentPeriodEnd}.`
                            : "Cancellation scheduled. Your subscription will end at the close of the current billing period."}
                        </p>
                      )}

                      {cancelSubscriptionError && (
                        <p
                          className="text-sm text-red-600 mb-3"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {cancelSubscriptionError}
                        </p>
                      )}

                      {cancelSubscriptionSuccess && !cancellationScheduled && (
                        <p
                          className="text-sm text-green-700 mb-3"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                        >
                          {cancelSubscriptionSuccess}
                        </p>
                      )}

                      {cancellationScheduled ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className="inline-flex px-5 py-2.5 border border-green-200 text-green-700 bg-green-50 rounded-full text-sm font-semibold"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            Cancellation Scheduled
                          </span>
                          <button
                            type="button"
                            className="inline-flex px-5 py-2.5 border border-gray-200 text-gray-700 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                            onClick={handleUncancelSubscription}
                            disabled={uncancelingSubscription}
                          >
                            {uncancelingSubscription
                              ? "Keeping Active..."
                              : "Keep Subscription Active"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex px-5 py-2.5 border border-gray-200 text-gray-700 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                          onClick={handleCancelSubscription}
                          disabled={cancelingSubscription || uncancelingSubscription}
                        >
                          {cancelingSubscription
                            ? "Cancelling..."
                            : "Cancel Subscription"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* --- SUPPORT TAB --- */}
              {activeTab === "support" && (
                <div className="p-8">
                  <h2
                    className="text-xl font-bold text-gray-900 mb-2"
                    style={{ fontFamily: "var(--font-landing-heading)" }}
                  >
                    Support
                  </h2>
                  <p
                    className="text-sm text-gray-500 mb-6 font-medium"
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  >
                    Need help or want to request a feature? Reach us directly
                    through these forms.
                  </p>

                  <div className="grid md:grid-cols-2 gap-4">
                    <a
                      href={process.env.NEXT_PUBLIC_SUPPORT_FORM_URL || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p
                            className="text-base font-bold text-gray-900"
                            style={{
                              fontFamily: "var(--font-landing-heading)",
                            }}
                          >
                            Contact Support
                          </p>
                          <p
                            className="text-sm text-gray-500 mt-1"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            Report bugs, account issues, billing questions, or
                            scan failures.
                          </p>
                        </div>
                        <ExternalLink
                          size={16}
                          className="text-gray-400 mt-1"
                        />
                      </div>
                    </a>

                    <a
                      href={
                        process.env.NEXT_PUBLIC_FEATURE_REQUEST_FORM_URL || "#"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p
                            className="text-base font-bold text-gray-900"
                            style={{
                              fontFamily: "var(--font-landing-heading)",
                            }}
                          >
                            Request a Feature
                          </p>
                          <p
                            className="text-sm text-gray-500 mt-1"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            Tell us what you want next in Graft.
                          </p>
                        </div>
                        <ExternalLink
                          size={16}
                          className="text-gray-400 mt-1"
                        />
                      </div>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!deletingAccount) setShowDeleteDialog(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-xl">
            <h3
              className="text-lg font-bold text-red-700"
              style={{ fontFamily: "var(--font-landing-heading)" }}
            >
              Delete Account
            </h3>
            <p
              className="mt-2 text-sm text-gray-700"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              This permanently deletes your account and all scans/issues. Type
              <span className="font-bold"> DELETE</span> to continue.
            </p>

            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deletingAccount}
              placeholder="Type DELETE"
              className="mt-4 w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              style={{ fontFamily: "var(--font-landing-body)" }}
            />

            {deleteAccountError && (
              <p
                className="mt-3 text-sm text-red-600"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                {deleteAccountError}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteDialog(false)}
                disabled={deletingAccount}
                className="px-4 py-2 rounded-full border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (deleteConfirmText !== "DELETE") {
                    setDeleteAccountError(
                      "Please type DELETE exactly to confirm.",
                    );
                    return;
                  }
                  await handleDeleteAccount();
                }}
                disabled={deletingAccount}
                className="px-4 py-2 rounded-full bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                {deletingAccount ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
