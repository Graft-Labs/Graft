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
  X,
  ArrowRight,
  ArrowDown,
  Sparkles,
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
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Plan change modal state
  const [showPlanChangeModal, setShowPlanChangeModal] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState<string | null>(null);
  const [planChangeLoading, setPlanChangeLoading] = useState(false);
  const [planChangeResult, setPlanChangeResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const parseBool = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      return normalized === "true" || normalized === "1" || normalized === "yes";
    }
    return false;
  };

  const isSubscriptionActive = (status: string | null | undefined): boolean => {
    const normalized = (status || "").toLowerCase();
    return normalized === "active" || normalized === "trialing";
  };

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
      setCheckoutError(null);
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
        if (response.status === 409 && data?.shouldOpenPortal) {
          try {
            await openBillingPortal();
            return;
          } catch {
            setCheckoutError(
              "You already have an active subscription. Open Billing Portal from this page to manage your plan.",
            );
            setCheckoutLoading(null);
            return;
          }
        }
        if (response.status === 409) {
          window.location.href = "/dashboard/settings?tab=billing";
          return;
        }
        setCheckoutError(data?.message || data?.error || "Failed to start checkout");
        setCheckoutLoading(null);
        return;
      }

      // If the backend updated the subscription directly (no checkout needed)
      if (data?.success && data?.action === "updated") {
        if (userData) {
          setUserData({
            ...userData,
            plan: data.plan,
            scans_limit: data.scansLimit,
            subscription_status: "active",
            scans_used: userData.scans_used ?? 0,
          });
        }
        await loadSubscriptionStatus();
        window.dispatchEvent(new CustomEvent("plan-changed"));
        setShowUpgradeSuccess(true);
        setCheckoutLoading(null);
        return;
      }

      if (!data?.url) {
        setCheckoutError("No checkout URL returned. Please try again.");
        setCheckoutLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch (error: unknown) {
      setCheckoutError(
        error instanceof Error ? error.message : "Unable to start checkout right now.",
      );
      setCheckoutLoading(null);
    }
  };

  const initiatePlanChange = (targetPlan: string) => {
    setPendingPlanChange(targetPlan);
    setPlanChangeResult(null);
    setShowPlanChangeModal(true);
  };

  const executePlanChange = async () => {
    if (!pendingPlanChange) return;

    setPlanChangeLoading(true);
    setPlanChangeResult(null);

    try {
      const response = await fetch("/api/subscription/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan: pendingPlanChange }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPlanChangeResult({
          type: "error",
          message: data?.message || data?.error || "Failed to change plan.",
        });
        setPlanChangeLoading(false);
        return;
      }

      // Handle redirect for checkout (free → paid)
      if (data.action === "checkout" && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }

      // Instant plan change succeeded
      setPlanChangeResult({
        type: "success",
        message: data.message || "Plan changed successfully!",
      });

      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent("plan-changed"));

      // Refresh user data
      const supabase = createClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const { data: freshData } = await supabase
          .from("users")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (freshData) {
          setUserData(freshData);
          setCached(
            "settings:data",
            {
              user: currentUser,
              userData: freshData,
              fullName: freshData?.name || currentUser?.user_metadata?.full_name || "",
            },
            60_000,
          );
        }
      }

      // Also re-sync subscription status
      loadSubscriptionStatus();

      // Auto-close modal after a short delay on success
      setTimeout(() => {
        setShowPlanChangeModal(false);
        setPendingPlanChange(null);
        setPlanChangeResult(null);
      }, 2500);
    } catch (err: unknown) {
      setPlanChangeResult({
        type: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setPlanChangeLoading(false);
    }
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    const integrationError = searchParams.get("integration_error");
    const upgradeSuccess = searchParams.get("upgrade");
    const targetPlan = searchParams.get("target_plan");
    const checkoutId = searchParams.get("checkout_id");
    const customerSessionToken = searchParams.get("customer_session_token");

    if (upgradeSuccess === "success" || customerSessionToken) {
      setActiveTab("billing");
      async function syncAndShowSuccess() {
        const sleep = (ms: number) =>
          new Promise((resolve) => window.setTimeout(resolve, ms));

        let confirmedUpgrade = false;

        try {
          const supabase = createClient();

          for (let attempt = 0; attempt < 6; attempt += 1) {
            const syncResponse = await fetch("/api/subscription/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checkoutId }),
            });

            const syncBody = await syncResponse.json().catch(() => null);
            const syncPlan =
              typeof syncBody?.plan === "string" ? syncBody.plan : null;
            const syncStatus =
              typeof syncBody?.subscriptionStatus === "string"
                ? syncBody.subscriptionStatus
                : null;
            const syncActive =
              parseBool(syncBody?.success) && isSubscriptionActive(syncStatus);

            if (!targetPlan) {
              confirmedUpgrade = syncActive && syncPlan !== "free";
            } else {
              confirmedUpgrade = syncActive && syncPlan === targetPlan;
            }

            if (confirmedUpgrade) {
              // Keep looping disabled and fetch latest row once below
            }

            const {
              data: { user: currentUser },
            } = await supabase.auth.getUser();

            if (currentUser) {
              const { data } = await supabase
                .from("users")
                .select("*")
                .eq("id", currentUser.id)
                .maybeSingle();

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

                const dbActive = isSubscriptionActive(data.subscription_status);
                const dbPlan = data.plan || "free";

                if (!targetPlan) {
                  if (dbActive && dbPlan !== "free") {
                    confirmedUpgrade = true;
                    break;
                  }
                } else if (dbActive && dbPlan === targetPlan) {
                  confirmedUpgrade = true;
                  break;
                }
              }
            }

            if (confirmedUpgrade) {
              break;
            }

            await sleep(1500);
          }
        } catch (err) {
          console.error("Failed to sync subscription:", err);
        }

        if (upgradeSuccess === "success" && confirmedUpgrade) {
          setShowUpgradeSuccess(true);
          window.dispatchEvent(new CustomEvent("plan-changed"));
        }
      }
      syncAndShowSuccess();
      const url = new URL(window.location.href);
      url.searchParams.delete("upgrade");
      url.searchParams.delete("target_plan");
      url.searchParams.delete("checkout_id");
      url.searchParams.delete("customer_session_token");
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

  const loadSubscriptionStatus = useCallback(async () => {
    try {
      // Step 1: call status endpoint — this syncs plan from Polar into DB
      const res = await fetch("/api/subscription/status", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const body = await res.json().catch(() => null);
      if (!res.ok || !body) return;

      setCurrentPeriodEnd(
        typeof body.currentPeriodEnd === "string" ? body.currentPeriodEnd : null,
      );

      // Step 2: use the plan from the API response directly (synced from Polar)
      const supabase = createClient();
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (currentUser) {
        // Get latest user data but override with API response plan
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle();

        if (data) {
          // Merge API plan into user data
          const mergedData = {
            ...data,
            plan: body.plan || data.plan || "free",
            scans_limit: body.scansLimit ?? data.scans_limit ?? 3,
            subscription_status: body.subscriptionStatus || data.subscription_status,
            subscription_id: body.subscriptionId || data.subscription_id,
            customer_id: body.customerId || data.customer_id,
          };
          
          setUserData(mergedData);
          setCached(
            "settings:data",
            {
              user: currentUser,
              userData: mergedData,
              fullName: data?.name || currentUser?.user_metadata?.full_name || "",
            },
            60_000,
          );
        }
      }
    } catch (error) {
      console.error("Failed to load subscription status", error);
    }
  }, []);

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
          .maybeSingle();

        setUserData(data);
        if (data?.name) setFullName(data.name);
        else if (user?.user_metadata?.full_name)
          setFullName(user.user_metadata.full_name);

        // Only cache this raw DB snapshot when loadSubscriptionStatus hasn't
        // already written a better (Polar-synced) entry for this session.
        const existingCached = getCached<CachedData>("settings:data");
        const existingPlan = existingCached?.userData?.plan;
        const hasBetterCachedPlan =
          existingPlan === "pro" || existingPlan === "unlimited";
        if (!hasBetterCachedPlan) {
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
      }
      setLoading(false);
      await loadSubscriptionStatus();
    }
    loadData();
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
      window.dispatchEvent(new CustomEvent("plan-changed"));
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
      window.dispatchEvent(new CustomEvent("plan-changed"));
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

                  {/* Cancellation notice */}
                  {cancellationScheduled && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                      <AlertTriangle
                        size={20}
                        className="text-amber-600 shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-amber-800">
                          Cancellation scheduled
                        </p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          {formattedCurrentPeriodEnd
                            ? `Your subscription will end on ${formattedCurrentPeriodEnd}. You keep full access until then.`
                            : "Your subscription will end at the close of the current billing period."}
                        </p>
                      </div>
                      <button
                        onClick={handleUncancelSubscription}
                        disabled={uncancelingSubscription}
                        className="shrink-0 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-semibold rounded-full transition-colors disabled:opacity-60"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        {uncancelingSubscription ? "Restoring..." : "Keep Active"}
                      </button>
                    </div>
                  )}

                  {cancelSubscriptionError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-sm text-red-700" style={{ fontFamily: "var(--font-landing-body)" }}>
                        {cancelSubscriptionError}
                      </p>
                    </div>
                  )}

                  {cancelSubscriptionSuccess && !cancellationScheduled && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl">
                      <p className="text-sm text-green-700" style={{ fontFamily: "var(--font-landing-body)" }}>
                        {cancelSubscriptionSuccess}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2
                        className="text-xl font-bold text-gray-900"
                        style={{ fontFamily: "var(--font-landing-heading)" }}
                      >
                        Plan & Billing
                      </h2>
                      <p
                        className="text-sm text-gray-500 mt-1 font-medium"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Choose the plan that works best for you. Changes take effect immediately.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
                    <div className="xl:col-span-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <h3
                          className="text-sm font-bold text-gray-900"
                          style={{ fontFamily: "var(--font-landing-heading)" }}
                        >
                          Usage This Cycle
                        </h3>
                        <span className="text-xs font-semibold text-gray-600">
                          {userData?.scans_used ?? 0} / {((userData?.scans_limit ?? 3) >= 999999) ? "Unlimited" : (userData?.scans_limit ?? 3)}
                        </span>
                      </div>

                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden mb-3">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#3079FF] to-[#77adff] transition-all duration-700"
                          style={{
                            width:
                              (userData?.scans_limit ?? 3) >= 999999
                                ? "100%"
                                : `${Math.min(100, ((userData?.scans_used ?? 0) / Math.max((userData?.scans_limit ?? 1), 1)) * 100)}%`,
                          }}
                        />
                      </div>

                      {(userData?.scans_limit ?? 3) < 999999 &&
                        (userData?.scans_used ?? 0) >= (userData?.scans_limit ?? 3) && (
                          <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-1">
                            <AlertTriangle size={12} />
                            You have reached your scan limit. Upgrade to continue scanning.
                          </p>
                        )}
                    </div>

                    <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-5 shadow-sm">
                      <h3
                        className="text-sm font-bold text-gray-900 mb-1"
                        style={{ fontFamily: "var(--font-landing-heading)" }}
                      >
                        Billing Portal
                      </h3>
                      <p
                        className="text-xs text-gray-500 mb-4"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Manage invoices, payment method, and subscription details in Polar.
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await openBillingPortal();
                          } catch (err: unknown) {
                            setCheckoutError(
                              err instanceof Error ? err.message : "Could not open billing portal."
                            );
                          }
                        }}
                        disabled={effectivePlan === "free"}
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white text-gray-800 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Manage Billing
                        <ExternalLink size={12} />
                      </button>
                      {effectivePlan === "free" ? (
                        <p className="text-[11px] text-gray-500 mt-2">
                          Available after upgrading to a paid plan.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {effectivePlan === "free" && (
                    <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50">
                      <p className="text-sm font-semibold text-amber-800 mb-1">Plan not showing correctly?</p>
                      <p className="text-xs text-amber-700 mb-3">If you have paid but your plan still shows Free, click below to sync from Polar.</p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/subscription/repair", { method: "POST" });
                            const data = await res.json();
                            if (data.success) {
                              alert(`Fixed! Your plan is now: ${data.plan}. Refreshing...`);
                              window.location.reload();
                            } else {
                              alert(data.message || data.error || "Could not find a subscription on Polar for your account.");
                            }
                          } catch {
                            alert("Repair failed. Please contact support.");
                          }
                        }}
                        className="text-xs font-semibold px-4 py-2 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-800 transition-colors border border-amber-300"
                      >
                        Sync subscription from Polar
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                    {[
                      {
                        id: "free",
                        name: "Free",
                        price: "$0",
                        subtitle: "Great for trial runs",
                        features: ["3 scans/month", "Basic checks", "Community support"],
                      },
                      {
                        id: "pro",
                        name: "Pro",
                        price: "$15",
                        subtitle: "For growing engineering teams",
                        features: ["50 scans/month", "Deep analysis", "Priority processing"],
                      },
                      {
                        id: "unlimited",
                        name: "Unlimited",
                        price: "$39",
                        subtitle: "Scale without scan limits",
                        features: ["Unlimited scans", "Everything in Pro", "Priority support"],
                      },
                    ].map((plan) => {
                      const isCurrent = effectivePlan === plan.id;
                      const canUpgrade =
                        (effectivePlan === "free" && (plan.id === "pro" || plan.id === "unlimited")) ||
                        (effectivePlan === "pro" && plan.id === "unlimited");
                      const canDowngradeToFree = effectivePlan !== "free" && plan.id === "free";
                      const isLoading = checkoutLoading === plan.id;

                      return (
                        <div
                          key={plan.id}
                          className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 ${
                            isCurrent
                              ? "border-[#3079FF] bg-gradient-to-b from-[#3079FF]/10 to-white shadow-md"
                              : "border-gray-200 bg-white shadow-sm hover:shadow-md"
                          }`}
                        >
                          {plan.id === "pro" && !isCurrent ? (
                            <span className="absolute top-3 right-3 rounded-full bg-gray-900 text-white text-[10px] px-2.5 py-1 tracking-wide uppercase font-semibold">
                              Popular
                            </span>
                          ) : null}

                          <div className="flex items-center justify-between gap-2 mb-2">
                            <h3
                              className="text-base font-bold text-gray-900"
                              style={{ fontFamily: "var(--font-landing-heading)" }}
                            >
                              {plan.name}
                            </h3>
                            {isCurrent ? (
                              <span className="rounded-full border border-[#3079FF]/30 bg-[#3079FF]/10 text-[#1b5fdb] text-[10px] font-bold px-2.5 py-1 uppercase tracking-wide">
                                Current
                              </span>
                            ) : null}
                          </div>

                          <p className="text-2xl font-bold text-gray-900">
                            {plan.price}
                            <span className="text-sm font-medium text-gray-500">/mo</span>
                          </p>
                          <p
                            className="text-xs text-gray-500 mt-1 mb-4"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            {plan.subtitle}
                          </p>

                          <ul className="space-y-2 mb-5">
                            {plan.features.map((feature) => (
                              <li
                                key={feature}
                                className="text-xs text-gray-700 flex items-center gap-2"
                                style={{ fontFamily: "var(--font-landing-body)" }}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-[#3079FF]" />
                                {feature}
                              </li>
                            ))}
                          </ul>

                          {isCurrent ? (
                            <button
                              type="button"
                              disabled
                              className="inline-flex h-9 w-full items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 text-xs font-semibold"
                              style={{ fontFamily: "var(--font-landing-body)" }}
                            >
                              Current Plan
                            </button>
                          ) : canUpgrade ? (
                            <button
                              type="button"
                              onClick={() => startCheckout(plan.id as "pro" | "unlimited")}
                              disabled={isLoading}
                              className="inline-flex h-9 w-full items-center justify-center rounded-full bg-gray-900 text-white text-xs font-semibold hover:bg-black transition-colors disabled:opacity-70"
                              style={{ fontFamily: "var(--font-landing-body)" }}
                            >
                              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                              {plan.id === "pro" ? "Upgrade to Pro" : "Upgrade to Unlimited"}
                            </button>
                          ) : canDowngradeToFree ? (
                            <button
                              type="button"
                              onClick={() => initiatePlanChange("free")}
                              className="inline-flex h-9 w-full items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors"
                              style={{ fontFamily: "var(--font-landing-body)" }}
                            >
                              Switch to Free
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={openBillingPortal}
                              className="inline-flex h-9 w-full items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors"
                              style={{ fontFamily: "var(--font-landing-body)" }}
                            >
                              Manage in Billing
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(effectivePlan === "pro" || effectivePlan === "unlimited") && (
                    <div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-sm">
                      <h3
                        className="text-base font-bold text-gray-900 mb-2"
                        style={{ fontFamily: "var(--font-landing-heading)" }}
                      >
                        Subscription Controls
                      </h3>
                      <p
                        className="text-sm text-gray-500 mb-4"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        You can cancel anytime. Access stays active until the end of your current billing cycle.
                      </p>

                      {cancellationScheduled ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className="inline-flex px-4 py-2 border border-amber-200 text-amber-700 bg-amber-50 rounded-full text-xs font-semibold"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                          >
                            Cancellation Scheduled
                          </span>
                          <button
                            type="button"
                            className="inline-flex px-4 py-2 border border-gray-200 text-gray-700 rounded-full text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ fontFamily: "var(--font-landing-body)" }}
                            onClick={handleUncancelSubscription}
                            disabled={uncancelingSubscription}
                          >
                            {uncancelingSubscription ? "Keeping Active..." : "Keep Subscription Active"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex px-4 py-2 border border-gray-200 text-gray-700 rounded-full text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                          style={{ fontFamily: "var(--font-landing-body)" }}
                          onClick={handleCancelSubscription}
                          disabled={cancelingSubscription || uncancelingSubscription}
                        >
                          {cancelingSubscription ? "Cancelling..." : "Cancel Subscription"}
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

      {checkoutError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setCheckoutError(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={20} className="text-red-500 shrink-0" />
                <h3
                  className="text-base font-bold text-gray-900"
                  style={{ fontFamily: "var(--font-landing-heading)" }}
                >
                  Unable to Complete
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutError(null)}
                className="text-gray-400 hover:text-gray-600 shrink-0"
                aria-label="Dismiss"
              >
                <X size={18} />
              </button>
            </div>
            <p
              className="text-sm text-gray-700"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {checkoutError}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCheckoutError(null)}
                className="px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plan Change Confirmation Modal */}
      {showPlanChangeModal && pendingPlanChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              if (!planChangeLoading) {
                setShowPlanChangeModal(false);
                setPendingPlanChange(null);
                setPlanChangeResult(null);
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            {planChangeResult ? (
              /* Result state */
              <div className="text-center py-2">
                {planChangeResult.type === "success" ? (
                  <>
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle size={24} className="text-green-600" />
                    </div>
                    <h3
                      className="text-lg font-bold text-gray-900 mb-2"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      Plan Changed!
                    </h3>
                    <p
                      className="text-sm text-gray-600"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      {planChangeResult.message}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                      <AlertTriangle size={24} className="text-red-600" />
                    </div>
                    <h3
                      className="text-lg font-bold text-gray-900 mb-2"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      Something went wrong
                    </h3>
                    <p
                      className="text-sm text-gray-600 mb-4"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      {planChangeResult.message}
                    </p>
                    <button
                      onClick={() => {
                        setShowPlanChangeModal(false);
                        setPendingPlanChange(null);
                        setPlanChangeResult(null);
                      }}
                      className="px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition-colors"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* Confirmation state */
              <>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    {pendingPlanChange === "free" ? (
                      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                        <ArrowDown size={16} className="text-amber-700" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Sparkles size={16} className="text-[#3079FF]" />
                      </div>
                    )}
                    <h3
                      className="text-base font-bold text-gray-900"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      {pendingPlanChange === "free"
                        ? "Downgrade to Free?"
                        : (() => {
                            const from = effectivePlan;
                            const to = pendingPlanChange;
                            const isUpgrade =
                              (from === "free") ||
                              (from === "pro" && to === "unlimited");
                            return isUpgrade
                              ? `Upgrade to ${to.charAt(0).toUpperCase() + to.slice(1)}?`
                              : `Switch to ${to.charAt(0).toUpperCase() + to.slice(1)}?`;
                          })()}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlanChangeModal(false);
                      setPendingPlanChange(null);
                    }}
                    className="text-gray-400 hover:text-gray-600 shrink-0"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      Current
                    </span>
                    <span className="text-xs font-semibold text-gray-500" style={{ fontFamily: "var(--font-landing-body)" }}>
                      →
                    </span>
                    <span
                      className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-landing-body)" }}
                    >
                      New
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-sm font-bold text-gray-900"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      {effectivePlan.charAt(0).toUpperCase() + effectivePlan.slice(1)}
                    </span>
                    <ArrowRight size={14} className="text-gray-400" />
                    <span
                      className="text-sm font-bold text-gray-900"
                      style={{ fontFamily: "var(--font-landing-heading)" }}
                    >
                      {pendingPlanChange.charAt(0).toUpperCase() + pendingPlanChange.slice(1)}
                    </span>
                  </div>
                </div>

                <p
                  className="text-xs text-gray-500 mb-5"
                  style={{ fontFamily: "var(--font-landing-body)" }}
                >
                  {pendingPlanChange === "free"
                    ? "Your subscription will be cancelled at the end of the current billing period. You keep full access until then."
                    : effectivePlan === "free"
                      ? "You will be taken to a secure checkout to complete payment."
                      : "The plan change will take effect immediately. Any price difference will be prorated."}
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowPlanChangeModal(false);
                      setPendingPlanChange(null);
                    }}
                    disabled={planChangeLoading}
                    className="flex-1 py-2.5 rounded-full border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executePlanChange}
                    disabled={planChangeLoading}
                    className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-70 ${
                      pendingPlanChange === "free"
                        ? "bg-amber-600 text-white hover:bg-amber-700"
                        : "bg-[#3079FF] text-white hover:bg-blue-600"
                    }`}
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  >
                    {planChangeLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : pendingPlanChange === "free" ? (
                      "Confirm Downgrade"
                    ) : effectivePlan === "free" ? (
                      "Continue to Checkout"
                    ) : (
                      "Confirm Change"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
