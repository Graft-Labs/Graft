"use client";

import { useState, useCallback, useEffect } from "react";
import {
  User,
  Github,
  Bell,
  Shield,
  CreditCard,
  LifeBuoy,
  MessageSquarePlus,
  Trash2,
  CheckCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

type Tab = "profile" | "integrations" | "notifications" | "billing" | "security" | "support";

const tabs: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "integrations", label: "Integrations", icon: Github },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "security", label: "Security", icon: Shield },
  { id: "support", label: "Support", icon: LifeBuoy },
];

interface UserData {
  email: string;
  name: string;
  avatar_url?: string | null;
  plan: string;
  scans_used: number;
  scans_limit: number;
}

type NotificationPrefs = {
  scanComplete: boolean;
  criticalIssues: boolean;
  weeklyDigest: boolean;
  productUpdates: boolean;
};

const defaultNotificationPrefs: NotificationPrefs = {
  scanComplete: true,
  criticalIssues: true,
  weeklyDigest: false,
  productUpdates: false,
};

export default function SettingsPage() {
  const supportFormUrl = process.env.NEXT_PUBLIC_SUPPORT_FORM_URL?.trim();
  const featureRequestFormUrl = process.env.NEXT_PUBLIC_FEATURE_REQUEST_FORM_URL?.trim();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [saved, setSaved] = useState(false);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [profileForm, setProfileForm] = useState({ name: "", email: "" });
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsSaved, setNotificationsSaved] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const supabase = createClient();

  const fetchUserData = useCallback(async () => {
    setLoadingUser(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingUser(false);
        return;
      }

      const { data: userRecord } = await supabase
        .from("users")
        .select("plan, scans_used, scans_limit")
        .eq("id", user.id)
        .single();

      const userData: UserData = {
        email: user.email || "",
        name: user.user_metadata?.full_name || user.user_metadata?.name || "",
        avatar_url: user.user_metadata?.avatar_url || null,
        plan: userRecord?.plan || "free",
        scans_used: userRecord?.scans_used || 0,
        scans_limit: userRecord?.scans_limit || 3,
      };

      const rawPrefs = user.user_metadata?.notification_prefs as Partial<NotificationPrefs> | undefined;
      setNotificationPrefs({
        scanComplete: rawPrefs?.scanComplete ?? defaultNotificationPrefs.scanComplete,
        criticalIssues: rawPrefs?.criticalIssues ?? defaultNotificationPrefs.criticalIssues,
        weeklyDigest: rawPrefs?.weeklyDigest ?? defaultNotificationPrefs.weeklyDigest,
        productUpdates: rawPrefs?.productUpdates ?? defaultNotificationPrefs.productUpdates,
      });

      setUserData(userData);
      setProfileForm({ name: userData.name, email: userData.email });
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
    setLoadingUser(false);
  }, [supabase]);

  useEffect(() => {
    void fetchUserData();
  }, [fetchUserData]);

  const checkGithubStatus = useCallback(async () => {
    setLoadingGithub(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setGithubConnected(false);
        setLoadingGithub(false);
        return;
      }

      const identities = user.identities || [];
      const githubIdentity = identities.find(
        (id: { provider: string }) => id.provider === "github"
      );
      setGithubConnected(!!githubIdentity);
    } catch (error) {
      console.error("Error checking GitHub status:", error);
      setGithubConnected(false);
    }
    setLoadingGithub(false);
  }, [supabase]);

  const handleGithubConnect = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: getAuthRedirectUrl(),
        scopes: "repo read:org user:email",
      },
    });

    if (error) {
      console.error("GitHub OAuth error:", error);
    }
  };

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.auth.updateUser({
        data: { full_name: profileForm.name }
      });

      if (error) {
        console.error("Error updating profile:", error);
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving profile:", error);
    }
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.auth.updateUser({
        data: {
          ...(user.user_metadata || {}),
          notification_prefs: notificationPrefs,
        },
      });

      if (error) {
        console.error("Error saving notification preferences:", error);
        return;
      }

      setNotificationsSaved(true);
      setTimeout(() => setNotificationsSaved(false), 2000);
    } catch (error) {
      console.error("Error saving notification preferences:", error);
    } finally {
      setSavingNotifications(false);
    }
  };

  const handlePasswordUpdate = async () => {
    setPasswordMessage(null);
    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage("Password must be at least 8 characters.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage("Passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) {
        setPasswordMessage(error.message || "Failed to update password.");
        return;
      }

      setPasswordForm({ newPassword: "", confirmPassword: "" });
      setPasswordMessage("Password updated successfully.");
    } catch (error) {
      console.error("Error updating password:", error);
      setPasswordMessage("Failed to update password.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm("This will permanently delete your account and scan history. This action cannot be undone. Continue?");
    if (!confirmed) return;

    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.message || "Failed to delete account.");
        return;
      }

      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("Error deleting account:", error);
      window.alert("Failed to delete account.");
    } finally {
      setDeletingAccount(false);
    }
  };

  const getPlanDisplayName = (plan: string) => {
    switch (plan) {
      case "pro": return "Pro";
      case "unlimited": return "Unlimited";
      case "lifetime": return "Lifetime";
      default: return "Free";
    }
  };

  const getPlanFeatures = (plan: string) => {
    if (userData) {
      if (userData.scans_limit >= 999999) return "Unlimited scans";
      return `${userData.scans_limit} scans / month`;
    }

    switch (plan) {
      case "pro": return "30 scans / month";
      case "unlimited": return "Unlimited scans";
      case "lifetime": return "Unlimited scans (one-time)";
      default: return "3 scans / month";
    }
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-16 flex items-center px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}>
          <h1 className="text-base font-semibold" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
            Settings
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            <div className="flex gap-8">
              {/* Sidebar tabs */}
              <div className="w-48 flex-shrink-0">
                <nav className="flex flex-col gap-0.5">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          if (tab.id === "integrations") {
                            void checkGithubStatus();
                          }
                        }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-all"
                        style={{
                          background: activeTab === tab.id ? "var(--accent-glow)" : "transparent",
                          color: activeTab === tab.id ? "var(--accent)" : "var(--text-secondary)",
                          border: activeTab === tab.id ? "1px solid var(--border-amber)" : "1px solid transparent",
                          fontFamily: "var(--font-label)",
                        }}>
                        <Icon size={15} />
                        {tab.label}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {activeTab === "profile" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Profile Settings
                    </h2>
                    {loadingUser ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-5 p-6 rounded-2xl mb-5"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          {/* Avatar */}
                          <div className="flex items-center gap-4">
                            {userData?.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={userData.avatar_url}
                                alt={profileForm.name || "Profile avatar"}
                                className="w-16 h-16 rounded-2xl object-cover"
                                style={{ border: "1px solid var(--border)" }}
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold"
                                style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)", color: "var(--accent)", fontFamily: "var(--font-ui)" }}>
                                {(profileForm.name || profileForm.email || "U").charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>Profile Picture</p>
                              <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                                {userData?.avatar_url ? "Synced from your auth provider" : "Auto-generated from your initials"}
                              </p>
                            </div>
                          </div>

                          {/* Fields */}
                          <div>
                            <label className="block text-xs font-medium mb-1.5"
                              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              Full Name
                            </label>
                            <input 
                              type="text" 
                              value={profileForm.name}
                              onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Your name" 
                              className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} 
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium mb-1.5"
                              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              Email
                            </label>
                            <input 
                              type="email" 
                              value={profileForm.email}
                              disabled
                              className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm opacity-60"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} 
                            />
                            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginTop: 4 }}>
                              Email cannot be changed
                            </p>
                          </div>
                        </div>

                        <button onClick={handleSave}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
                          style={{ background: saved ? "var(--guard-monetize-glow)" : "var(--accent)", color: saved ? "var(--guard-monetize)" : "var(--obsidian)", border: saved ? "1px solid rgba(64,200,122,0.3)" : "none", fontFamily: "var(--font-ui)" }}>
                          {saved ? <><CheckCircle size={14} /> Saved!</> : "Save Changes"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "integrations" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Integrations
                    </h2>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between p-5 rounded-2xl"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                            style={{ background: "var(--obsidian-3)", border: "1px solid var(--border)" }}>
                            <Github size={18} style={{ color: "var(--text-secondary)" }} />
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>GitHub</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              Connect your GitHub account to scan private repositories
                            </p>
                          </div>
                        </div>
                        {loadingGithub ? (
                          <div className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                            <Loader2 size={14} className="animate-spin" />
                            Checking...
                          </div>
                        ) : githubConnected ? (
                          <button
                            onClick={handleGithubConnect}
                            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                            style={{ background: "var(--guard-monetize-glow)", color: "var(--guard-monetize)", border: "1px solid rgba(64,200,122,0.3)", fontFamily: "var(--font-label)" }}
                          >
                            <CheckCircle size={14} />
                            Connected
                          </button>
                        ) : (
                          <button
                            onClick={handleGithubConnect}
                            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                            style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-label)" }}
                          >
                            Connect
                          </button>
                        )}
                      </div>
                      {!githubConnected && (
                        <div className="p-4 rounded-xl" style={{ background: "var(--obsidian-1)", border: "1px solid var(--border)" }}>
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                            <strong style={{ color: "var(--text-primary)" }}>Why connect GitHub?</strong>
                            <br />
                            • Scan private repositories
                            <br />
                            • Access repository metadata
                            <br />
                            • Enable auto-fix via GitHub PRs (coming soon)
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "billing" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Billing & Plan
                    </h2>

                    {loadingUser ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
                      </div>
                    ) : userData ? (
                      <>
                        {/* Current plan */}
                        <div className="p-6 rounded-2xl mb-5"
                          style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p style={{ fontSize: "12px", color: "var(--accent)", fontFamily: "var(--font-label)", marginBottom: 4 }}>Current Plan</p>
                              <p className="text-2xl" style={{ fontFamily: "var(--font-ui)", color: "var(--accent)" }}>{getPlanDisplayName(userData.plan)}</p>
                              <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>{getPlanFeatures(userData.plan)}</p>
                            </div>
                            {userData.plan !== "unlimited" && userData.plan !== "lifetime" && (
                              <Link href="/pricing"
                                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                                style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}>
                                Upgrade to Pro
                              </Link>
                            )}
                          </div>
                        </div>

                        <div className="p-5 rounded-2xl"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)" }}>Usage this month</p>
                          <div className="flex items-center gap-3 mt-3">
                            <div className="flex-1 h-2 rounded-full" style={{ background: "var(--obsidian-5)" }}>
                              <div style={{ 
                                width: userData.scans_limit === 999999 
                                  ? "100%" 
                                  : `${Math.min((userData.scans_used / userData.scans_limit) * 100, 100)}%`, 
                                height: "100%", 
                                background: userData.scans_used >= userData.scans_limit ? "var(--sev-critical)" : "var(--accent)", 
                                borderRadius: "9999px" 
                              }} />
                            </div>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              {userData.scans_limit === 999999 
                                ? "Unlimited" 
                                : `${userData.scans_used}/${userData.scans_limit} scans`
                              }
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-6 rounded-2xl"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>Unable to load billing info</p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "security" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Security
                    </h2>

                    <div className="flex flex-col gap-4">
                      {/* Change password */}
                      <div className="p-5 rounded-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <p className="text-sm font-medium mb-4" style={{ fontFamily: "var(--font-ui)" }}>Change Password</p>
                        <div className="flex flex-col gap-3">
                          <input
                            type="password"
                            placeholder="New password"
                            value={passwordForm.newPassword}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                            className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm"
                            style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
                          />
                          <input
                            type="password"
                            placeholder="Confirm new password"
                            value={passwordForm.confirmPassword}
                            onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm"
                            style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} />
                        </div>
                        {passwordMessage && (
                          <p style={{ fontSize: "12px", marginTop: 10, color: passwordMessage.includes("success") ? "var(--guard-monetize)" : "var(--sev-high)", fontFamily: "var(--font-label)" }}>
                            {passwordMessage}
                          </p>
                        )}
                        <button
                          onClick={handlePasswordUpdate}
                          disabled={savingPassword}
                          className="mt-4 px-5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
                          style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                          {savingPassword ? "Updating..." : "Update Password"}
                        </button>
                      </div>

                      {/* Danger zone */}
                      <div className="p-5 rounded-2xl" style={{ background: "rgba(232,64,64,0.04)", border: "1px solid rgba(232,64,64,0.2)" }}>
                        <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)", color: "var(--sev-critical)" }}>Danger Zone</p>
                        <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginBottom: 16 }}>
                          Permanently delete your account and all scan data.
                        </p>
                        <button
                          onClick={handleDeleteAccount}
                          disabled={deletingAccount}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
                          style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", color: "var(--sev-critical)", fontFamily: "var(--font-label)" }}>
                          <Trash2 size={13} />
                          {deletingAccount ? "Deleting..." : "Delete Account"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "notifications" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Notification Preferences
                    </h2>
                    <div className="flex flex-col gap-3">
                      {[
                        { key: "scanComplete", label: "Scan complete", desc: "Get notified when a scan finishes" },
                        { key: "criticalIssues", label: "Critical issues found", desc: "Alert when critical severity issues are detected" },
                        { key: "weeklyDigest", label: "Weekly digest", desc: "Weekly summary of your scan history" },
                        { key: "productUpdates", label: "Product updates", desc: "New features and improvements" },
                      ].map((notif) => (
                        <div key={notif.label} className="flex items-center justify-between p-4 rounded-xl"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          <div>
                            <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>{notif.label}</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>{notif.desc}</p>
                          </div>
                          <button
                            onClick={() => setNotificationPrefs((prev) => ({
                              ...prev,
                              [notif.key]: !prev[notif.key as keyof NotificationPrefs],
                            }))}
                            className="w-10 h-6 rounded-full relative transition-colors duration-200 flex-shrink-0"
                            style={{ background: notificationPrefs[notif.key as keyof NotificationPrefs] ? "var(--accent)" : "var(--obsidian-5)" }}>
                            <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200"
                              style={{ transform: notificationPrefs[notif.key as keyof NotificationPrefs] ? "translateX(18px)" : "translateX(2px)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={handleSaveNotifications}
                        disabled={savingNotifications}
                        className="self-start mt-1 px-5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
                        style={{ background: notificationsSaved ? "var(--guard-monetize-glow)" : "var(--accent)", color: notificationsSaved ? "var(--guard-monetize)" : "var(--obsidian)", border: notificationsSaved ? "1px solid rgba(64,200,122,0.3)" : "none", fontFamily: "var(--font-ui)" }}
                      >
                        {savingNotifications ? "Saving..." : notificationsSaved ? "Saved!" : "Save Notification Preferences"}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === "support" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Support & Requests
                    </h2>
                    <div className="flex flex-col gap-4">
                      <div className="p-5 rounded-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)" }}>Get help</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              Need support with scans, billing, or account issues?
                            </p>
                          </div>
                          {supportFormUrl ? (
                            <a
                              href={supportFormUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
                            >
                              Open Support Form
                              <ExternalLink size={13} />
                            </a>
                          ) : (
                            <span
                              className="px-4 py-2 rounded-lg text-xs"
                              style={{ background: "var(--obsidian-1)", border: "1px solid var(--border)", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
                            >
                              Set NEXT_PUBLIC_SUPPORT_FORM_URL
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-5 rounded-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)" }}>Request a feature</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              Share ideas and vote on upcoming improvements.
                            </p>
                          </div>
                          {featureRequestFormUrl ? (
                            <a
                              href={featureRequestFormUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                              style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}
                            >
                              <MessageSquarePlus size={14} />
                              Send Request
                            </a>
                          ) : (
                            <span
                              className="px-4 py-2 rounded-lg text-xs"
                              style={{ background: "var(--obsidian-1)", border: "1px solid var(--border)", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
                            >
                              Set NEXT_PUBLIC_FEATURE_REQUEST_FORM_URL
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", lineHeight: "1.6" }}>
                          ShipGuard AI may occasionally miss issues or produce false positives. Always review critical security and compliance findings before production decisions.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
